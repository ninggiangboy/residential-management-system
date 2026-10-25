import { useQuery } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react'
import { api } from '../api/client'
import { apiErrorOf, unwrapEmpty } from '../api/errors'
import { staffMeQuery } from '../api/hooks/staff-me'
import { Banner } from '../components/ui/banner'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { OtpInput } from '../components/ui/otp-input'
import { TextField } from '../components/ui/text-field'
import { toast } from '../components/ui/toaster'
import { useI18n } from '../lib/i18n'
import { useCanWrite } from '../lib/online'
import { useCountdown } from '../lib/use-countdown'

export type StepUpAction = 'admin_change' | 'staff_email' | 'gateway_config'
export interface Proof {
  password: string
  code: string
}
export const CANCELLED = Symbol('step-up cancelled')

interface StepUp {
  /**
   * Opens `W-Step-Up` for `action` and calls `attempt(proof)` with what the Admin typed. The dialog stays open while the call runs.
   * A `step_up_failed` answer keeps it open with the message; any other answer closes it (the screen shows the error) (DR-216).
   * Resolves `CANCELLED` when the Admin gives up.
   */
  run<T>(action: StepUpAction, attempt: (proof: Proof) => Promise<T>): Promise<T | typeof CANCELLED>
}

const Context = createContext<StepUp | null>(null)

export function useStepUp(): StepUp {
  const value = useContext(Context)
  if (!value) throw new Error('StepUpProvider is missing')
  return value
}

/**
 * A sensitive request, the way every screen sends it (DOC-67 `W-Step-Up` §1): proactively when the form knows its action, and
 * reactively on a 403 `step_up_required`. `send` builds the request each time, so each proof attempt has a new `Idempotency-Key`.
 */
export async function withStepUp<T>(
  stepUp: StepUp,
  action: StepUpAction | null,
  send: (proof: Proof | undefined) => Promise<T>,
): Promise<T | typeof CANCELLED> {
  if (action) return stepUp.run(action, (proof) => send(proof))
  try {
    return await send(undefined)
  } catch (thrown) {
    const failure = apiErrorOf(thrown)
    const named = (failure.details as { action?: StepUpAction } | undefined)?.action
    if (failure.code === 'step_up_required' && named)
      return stepUp.run(named, (proof) => send(proof))
    throw thrown
  }
}

interface Open {
  action: StepUpAction
  attempt: (proof: Proof) => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

const RESEND_SECONDS = 30
const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const canWrite = useCanWrite()
  const me = useQuery(staffMeQuery()).data
  const [open, setOpen] = useState<Open | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null)
  const [busy, setBusy] = useState<'send' | 'confirm' | null>(null)
  const resend = useCountdown(0)
  const issuedAt = useRef<number | null>(null)

  const close = useCallback(() => {
    setOpen(null)
    setStep(1)
    setPassword('')
    setCode('')
    setBanner(null)
    setFieldError(null)
    setAttemptsLeft(null)
    setBusy(null)
    issuedAt.current = null
  }, [])

  const run = useCallback<StepUp['run']>(
    (action, attempt) =>
      new Promise((resolve, reject) => {
        setOpen({
          action,
          attempt: attempt as Open['attempt'],
          resolve: resolve as Open['resolve'],
          reject,
        })
      }),
    [],
  )

  const masked = me ? maskEmail(me.email) : ''

  const sendCode = async () => {
    if (!open) return
    setBusy('send')
    setBanner(null)
    try {
      unwrapEmpty(await api.staff['step-up'].post({ action: open.action }))
      issuedAt.current = performance.now()
      setStep(2)
      setCode('')
      setAttemptsLeft(null)
      resend.start(RESEND_SECONDS)
      toast.success(t('web.step-up.toast.sent', { maskedEmail: masked }))
    } catch (thrown) {
      const failure = apiErrorOf(thrown)
      if (failure.status === 429) {
        const minutes = Math.max(1, Math.ceil((failure.retryAfter ?? 60) / 60))
        setBanner({ tone: 'warning', text: t('web.step-up.banner.rate-limited', { minutes }) })
      } else if (failure.code === 'forbidden') {
        const dialog = open
        close()
        dialog.reject(thrown)
      } else {
        setBanner({ tone: 'danger', text: t('error.service_unavailable') })
      }
    } finally {
      setBusy(null)
    }
  }

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!open || busy) return
    // The server decides; the device only notices a code it knows is older than 10 minutes (DOC-67 §6).
    if (issuedAt.current !== null && performance.now() - issuedAt.current > 10 * 60_000) {
      setStep(1)
      setBanner({ tone: 'warning', text: t('web.step-up.banner.code-expired') })
      return
    }
    setBusy('confirm')
    setBanner(null)
    setFieldError(null)
    const dialog = open
    try {
      const value = await dialog.attempt({ password, code })
      close()
      toast.success(t('web.step-up.toast.done'))
      dialog.resolve(value)
    } catch (thrown) {
      const failure = apiErrorOf(thrown)
      if (failure.code === 'step_up_failed') {
        const left = Number(
          (failure.details as { attemptsLeft?: number } | undefined)?.attemptsLeft ?? NaN,
        )
        setCode('')
        setBusy(null)
        if (left === 0) {
          setStep(1)
          setBanner({ tone: 'warning', text: t('web.step-up.banner.code-spent') })
        } else {
          setFieldError(t('error.step_up_failed'))
          setAttemptsLeft(Number.isFinite(left) ? left : null)
        }
        return
      }
      // Any other answer is the action's own error: the dialog closes and the form behind it shows it.
      close()
      dialog.reject(thrown)
    }
  }

  const cancel = () => {
    if (!open || busy === 'confirm') return
    const dialog = open
    close()
    dialog.resolve(CANCELLED)
  }

  return (
    <Context.Provider value={{ run }}>
      {children}
      <Dialog
        open={open !== null}
        onOpenChange={(next) => !next && cancel()}
        dismissible={busy !== 'confirm'}
        title={t('web.step-up.title')}
        description={open ? t(`web.step-up.action.${open.action}`) : undefined}
      >
        {open && step === 1 && (
          <div className="flex flex-col gap-4 py-2">
            {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
            <p className="text-body text-ink-muted">
              {t('web.step-up.step1.body', { maskedEmail: masked })}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={cancel}>
                {t('web.step-up.cta.cancel')}
              </Button>
              <Button loading={busy === 'send'} disabled={!canWrite} onClick={sendCode}>
                {t('web.step-up.cta.send')}
              </Button>
            </div>
          </div>
        )}
        {open && step === 2 && (
          <form onSubmit={confirm} className="flex flex-col gap-4 py-2" noValidate>
            {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
            <TextField
              type="password"
              autoComplete="current-password"
              label={t('web.step-up.field.password.label')}
              value={password}
              disabled={busy === 'confirm'}
              onChange={(event) => setPassword(event.target.value)}
            />
            <OtpInput
              label={t('web.step-up.field.code.label')}
              hint={t('web.step-up.field.code.hint')}
              value={code}
              disabled={busy === 'confirm'}
              onChange={setCode}
              error={
                fieldError
                  ? attemptsLeft === null
                    ? fieldError
                    : `${fieldError} ${t('web.step-up.field.code.attempts', { attemptsLeft })}`
                  : undefined
              }
            />
            <p className="text-caption text-ink-muted">{t('web.step-up.hint.lockout')}</p>
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={resend.secondsLeft > 0 || busy !== null || !canWrite}
                onClick={sendCode}
              >
                {resend.secondsLeft > 0
                  ? t('web.step-up.cta.resend-wait', { seconds: resend.secondsLeft })
                  : t('web.step-up.cta.resend')}
              </Button>
              <div className="flex gap-3">
                <Button variant="ghost" onClick={cancel} disabled={busy === 'confirm'}>
                  {t('web.step-up.cta.cancel')}
                </Button>
                <Button
                  type="submit"
                  loading={busy === 'confirm'}
                  disabled={password === '' || code.length !== 6 || !canWrite}
                >
                  {t('web.step-up.cta')}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Dialog>
    </Context.Provider>
  )
}
