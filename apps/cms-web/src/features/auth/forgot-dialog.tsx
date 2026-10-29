import { classify } from '@rms/client-core'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { api } from '../../api/client'
import { apiErrorOf, unwrap } from '../../api/errors'
import { Banner } from '../../components/ui/banner'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { TextField } from '../../components/ui/text-field'
import { errorText, useI18n } from '../../lib/i18n'

/** `?dialog=forgot` of `W-Login` (DR-210): asks E-06; the answer is the same for every email, so success always goes to the sent page. */
export function ForgotDialog({
  open,
  email: initial,
  onClose,
}: {
  open: boolean
  email: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [email, setEmail] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ banner?: string; field?: string } | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      unwrap(await api.auth.staff['password-reset'].post({ email: email.trim() }))
      // The email travels in router state only, never in the URL (DOC-64 `W-Forgot-Sent` §2).
      await navigate({ to: '/forgot/sent', state: { email: email.trim() }, replace: true })
    } catch (thrown) {
      const failure = apiErrorOf(thrown)
      if (classify(failure).kind === 'validation') setError({ field: errorText(t, failure) })
      else if (failure.status === 429)
        setError({
          banner: `${t('error.rate_limited')} ${t('common.retry-in', { seconds: failure.retryAfter ?? 60 })}`,
        })
      else setError({ banner: t('error.service_unavailable') })
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t('web.login.dialog.forgot.title')}
      description={t('web.login.dialog.forgot.body')}
    >
      <form id="forgot-form" onSubmit={submit} className="flex flex-col gap-4 py-2" noValidate>
        {error?.banner && <Banner tone="warning">{error.banner}</Banner>}
        <TextField
          type="email"
          autoComplete="username"
          label={t('web.login.field.email.label')}
          placeholder={t('web.login.field.email.placeholder')}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error?.field}
        />
      </form>
      <div className="mt-4 flex justify-end gap-3 pb-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {t('common.action.cancel')}
        </Button>
        <Button type="submit" form="forgot-form" loading={pending} disabled={email.trim() === ''}>
          {t('web.login.dialog.forgot.confirm')}
        </Button>
      </div>
    </Dialog>
  )
}
