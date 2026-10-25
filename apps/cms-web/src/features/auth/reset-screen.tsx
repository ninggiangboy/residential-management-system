import { classify } from '@rms/client-core'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { apiErrorOf, unwrap } from '../../api/errors'
import { PublicLayout } from '../../components/layout/public-layout'
import { Banner } from '../../components/ui/banner'
import { Button, buttonStyles } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Icon } from '../../components/ui/icon'
import { TextField } from '../../components/ui/text-field'
import { useI18n } from '../../lib/i18n'

/** The rules of DOC-26 §4.2, checked first on the device: 8 to 128 characters, a letter and a digit, both fields equal. */
export function passwordRules(password: string, confirm: string) {
  return {
    length: password.length >= 8 && password.length <= 128,
    mix: /\p{L}/u.test(password) && /\d/.test(password),
    match: password !== '' && password === confirm,
  }
}

/** Reset links must not leak through the `Referer` header (DR-209): the page opts out for as long as it is shown. */
function useNoReferrer() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.append(meta)
    return () => meta.remove()
  }, [])
}

/** `W-Reset` for both routes: `/reset` (30 minutes) and `/invite` (24 hours) (DOC-64 §2). The token is the only parameter. */
export function ResetScreen({
  kind,
  token,
}: {
  kind: 'reset' | 'invite'
  token: string | undefined
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  useNoReferrer()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [weak, setWeak] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(token === undefined || token === '')
  const invite = kind === 'invite'
  const rules = passwordRules(password, confirm)
  const ok = rules.length && rules.mix && rules.match

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ok || pending || !token) return
    setPending(true)
    setBanner(null)
    setWeak(null)
    try {
      unwrap(await api.auth.staff.password.post({ token, password }))
      await navigate({ to: '/login', search: { reason: 'password_set' } })
    } catch (thrown) {
      const failure = apiErrorOf(thrown)
      if (failure.code === 'token_invalid') setInvalid(true)
      else if (classify(failure).kind === 'validation') setWeak(t('error.password_weak'))
      else if (failure.status === 429)
        setBanner(
          `${t('error.rate_limited')} ${t('common.retry-in', { seconds: failure.retryAfter ?? 60 })}`,
        )
      else setBanner(t('web.reset.banner.network'))
    } finally {
      setPending(false)
    }
  }

  if (invalid)
    return (
      <PublicLayout>
        <Card className="flex flex-col items-center gap-5 p-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-lamp-soft text-on-lamp-soft">
            <Icon name="warning" size="lg" weight="fill" />
          </span>
          <h1 className="text-title-1 text-ink">{t('web.reset.invalid.title')}</h1>
          <p className="text-body text-ink-muted">
            {t(invite ? 'web.reset.invalid.body_invite' : 'web.reset.invalid.body')}
          </p>
          {!invite && (
            <Link
              to="/login"
              search={{ dialog: 'forgot' }}
              className={buttonStyles({ size: 'lg', block: true })}
            >
              {t('web.reset.invalid.cta')}
            </Link>
          )}
          <Link
            to="/login"
            search={{}}
            className={buttonStyles({
              variant: invite ? 'primary' : 'ghost',
              size: 'lg',
              block: true,
            })}
          >
            {t('web.forgot-sent.action.back')}
          </Link>
        </Card>
      </PublicLayout>
    )

  return (
    <PublicLayout>
      <Card className="p-8">
        <h1 className="text-title-1 text-ink">
          {t(invite ? 'web.reset.title_invite' : 'web.reset.title')}
        </h1>
        <p className="mt-1 text-secondary text-ink-muted">
          {t(invite ? 'web.reset.subtitle_invite' : 'web.reset.subtitle')}
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
          {banner && <Banner tone="warning">{banner}</Banner>}
          <TextField
            type="password"
            autoComplete="new-password"
            label={t('web.reset.field.password.label')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={weak}
          />
          <TextField
            type="password"
            autoComplete="new-password"
            label={t('web.reset.field.confirm.label')}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <ul className="flex flex-col gap-1.5" aria-label={t('web.reset.title')}>
            {(['length', 'mix', 'match'] as const).map((rule) => (
              <li key={rule} className="flex items-center gap-2 text-secondary text-ink-muted">
                <Icon
                  name="check-circle"
                  size="sm"
                  weight={rules[rule] ? 'fill' : 'regular'}
                  className={rules[rule] ? 'text-success' : undefined}
                />
                {t(`web.reset.rule.${rule}`)}
                <span className="sr-only">
                  {t(rules[rule] ? 'web.reset.rule.met' : 'web.reset.rule.unmet')}
                </span>
              </li>
            ))}
          </ul>
          <Button type="submit" size="lg" block loading={pending} disabled={!ok}>
            {t('web.reset.cta')}
          </Button>
          <p className="text-caption text-ink-muted">{t('web.reset.hint')}</p>
        </form>
      </Card>
    </PublicLayout>
  )
}
