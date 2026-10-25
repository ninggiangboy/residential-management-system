import { RESEND_AFTER_SECONDS } from '@rms/client-core'
import { createFileRoute, Link, redirect, useLocation } from '@tanstack/react-router'
import { type ReactElement, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { apiErrorOf, unwrap } from '../api/errors'
import { PublicLayout } from '../components/layout/public-layout'
import { Banner } from '../components/ui/banner'
import { Button, buttonStyles } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Icon } from '../components/ui/icon'
import { toast } from '../components/ui/toaster'
import { useI18n } from '../lib/i18n'
import { clock, useCountdown } from '../lib/use-countdown'

export const Route = createFileRoute('/forgot/sent')({
  // A reload or a pasted link has no router state and goes back to the request dialog (UIWO-14).
  beforeLoad: ({ location }) => {
    if (!location.state.email) throw redirect({ to: '/login', search: { dialog: 'forgot' } })
  },
  component: ForgotSent,
})

function ForgotSent(): ReactElement {
  const { t } = useI18n()
  const email = useLocation().state.email ?? ''
  const heading = useRef<HTMLHeadingElement>(null)
  const { secondsLeft, start } = useCountdown(RESEND_AFTER_SECONDS)
  const [pending, setPending] = useState(false)
  const [rateLimited, setRateLimited] = useState<string | null>(null)

  // The `h1` takes the focus on arrival so a screen reader announces it (DOC-64 `W-Forgot-Sent` §4).
  useEffect(() => heading.current?.focus(), [])

  const resend = async () => {
    setPending(true)
    setRateLimited(null)
    try {
      unwrap(await api.auth.staff['password-reset'].post({ email }))
      toast.success(t('web.forgot-sent.toast.resent'))
      start(RESEND_AFTER_SECONDS)
    } catch (thrown) {
      const failure = apiErrorOf(thrown)
      if (failure.status === 429) {
        // The longer wait replaces the 45 s countdown.
        const seconds = failure.retryAfter ?? RESEND_AFTER_SECONDS
        start(seconds)
        setRateLimited(`${t('error.rate_limited')} ${t('common.retry-in', { seconds })}`)
      } else {
        toast.error(t('error.service_unavailable'))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <PublicLayout>
      <Card className="flex flex-col items-center gap-5 p-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-teal-soft text-on-teal-soft">
          <Icon name="check-circle" size="lg" weight="fill" />
        </span>
        <h1 ref={heading} tabIndex={-1} className="text-title-1 text-ink outline-none">
          {t('web.forgot-sent.title')}
        </h1>
        <p className="text-body text-ink-muted">{t('web.forgot-sent.body', { email })}</p>
        <ul className="w-full rounded-control bg-fill p-4 text-left text-secondary text-ink">
          <li className="flex items-center gap-3 py-1">
            <Icon name="clock" size="sm" /> {t('web.forgot-sent.info.validity')}
          </li>
          <li className="flex items-center gap-3 py-1">
            <Icon name="phone" size="sm" /> {t('web.forgot-sent.info.device')}
          </li>
        </ul>
        {rateLimited && (
          <Banner tone="warning" className="w-full text-left">
            {rateLimited}
          </Banner>
        )}
        <Button
          variant="outline"
          size="lg"
          block
          loading={pending}
          disabled={secondsLeft > 0}
          onClick={resend}
        >
          {secondsLeft > 0
            ? t('web.forgot-sent.cta.resend_wait', { time: clock(secondsLeft) })
            : t('web.forgot-sent.cta.resend')}
        </Button>
        <Link
          to="/login"
          search={{}}
          className={buttonStyles({ variant: 'ghost', size: 'lg', block: true })}
        >
          <Icon name="caret-left" size="sm" /> {t('web.forgot-sent.action.back')}
        </Link>
        <p className="text-caption text-ink-muted">{t('web.forgot-sent.hint')}</p>
      </Card>
    </PublicLayout>
  )
}
