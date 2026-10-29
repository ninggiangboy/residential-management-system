import { classify } from '@rms/client-core'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { lazy, type ReactElement, Suspense, useEffect, useRef, useState } from 'react'
import { apiErrorOf } from '../api/errors'
import { pick } from '../api/hooks/public-config'
import { ensureSession, signInWithPassword } from '../auth/session'
import { LanguageSwitch } from '../components/layout/language-switch'
import { useBrand } from '../components/layout/public-layout'
import { ThemeSwitch } from '../components/layout/theme-switch'
import { Banner } from '../components/ui/banner'
import { Button } from '../components/ui/button'
import { Icon } from '../components/ui/icon'
import { Skeleton } from '../components/ui/skeleton'
import { TextField } from '../components/ui/text-field'
import { landingFor } from '../features/auth/landing'
import { errorText, useI18n } from '../lib/i18n'
import { f, safeRedirect, searchParser } from '../lib/search'
import type { RouterContext } from './__root'

// The dialog is fetched when it is asked for: the first load of the page does not carry it (DOC-53 §8).
const ForgotDialog = lazy(() =>
  import('../features/auth/forgot-dialog').then((module) => ({ default: module.ForgotDialog })),
)

const SearchShape = {
  redirect: f.string(),
  reason: f.oneOf('expired', 'signed_out', 'password_set'),
  dialog: f.oneOf('forgot'),
}

/** `beforeLoad` annotates its parameters: a context-sensitive callback that reads `search` makes the inferred search type collapse to `{}`. */
type LoginSearch = ReturnType<typeof loginSearch>

const loginSearch = searchParser(SearchShape)

export const Route = createFileRoute('/login')({
  validateSearch: loginSearch,
  // Cookie mode: one refresh on arrival; a valid session skips the form (DOC-64 `W-Login` §5, CL-20).
  beforeLoad: async ({
    context,
    search,
  }: {
    context: RouterContext
    search: LoginSearch
  }): Promise<void> => {
    const me = await ensureSession(context.queryClient).catch(() => null)
    if (me) throw redirect({ href: landingFor(me.role, safeRedirect(search.redirect)) })
  },
  component: LoginPage,
})

function LoginPage(): ReactElement {
  const { t, lang } = useI18n()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()
  const brand = useBrand()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [failure, setFailure] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const [pending, setPending] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  // The lock ends by the monotonic clock of the device, not by the wall clock (DOC-64 `W-Login` §6).
  useEffect(() => {
    if (lockedUntil === null) return
    const left = lockedUntil - performance.now()
    if (left <= 0) {
      setLocked(false)
      return
    }
    setLocked(true)
    const timer = setTimeout(() => {
      setLocked(false)
      setLockedUntil(null)
    }, left)
    return () => clearTimeout(timer)
  }, [lockedUntil])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pending || locked) return
    setPending(true)
    setFailure(null)
    setFieldError(null)
    try {
      const me = await signInWithPassword(queryClient, { email: email.trim(), password })
      router.history.push(landingFor(me.role, safeRedirect(search.redirect)))
    } catch (thrown) {
      const error = apiErrorOf(thrown)
      const action = classify(error)
      if (error.code === 'invalid_credentials') {
        setPassword('')
        passwordRef.current?.focus()
        setFailure({ tone: 'danger', text: errorText(t, error) })
      } else if (action.kind === 'locked') {
        const seconds = Number(
          (error.details as { retryAfter?: number } | undefined)?.retryAfter ?? 60,
        )
        setLockedUntil(performance.now() + seconds * 1000)
        setFailure({ tone: 'warning', text: errorText(t, error) })
      } else if (action.kind === 'rate_limited') {
        const seconds = error.retryAfter ?? 60
        setFailure({
          tone: 'warning',
          text: `${t('error.rate_limited')} ${t('common.retry-in', { seconds })}`,
        })
      } else if (action.kind === 'validation') {
        setFieldError(errorText(t, error))
      } else {
        setFailure({ tone: 'danger', text: t('error.service_unavailable') })
      }
    } finally {
      setPending(false)
    }
  }

  const reasonBanner =
    search.reason === 'expired'
      ? t('auth.signed_out')
      : search.reason === 'password_set'
        ? t('web.login.banner.password_set')
        : null

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="hidden flex-col justify-between bg-gradient-to-br from-hero-from to-hero-to p-12 text-on-hero lg:flex">
        {/* As tall as the name and the hotline line while E-03 loads, so the text below does not move when they arrive
            (DR-306); `#boot` of `index.html` draws the same two bars before the scripts run. */}
        <div className="min-h-[60px]">
          {brand.loading ? (
            <>
              <Skeleton immediate className="h-8 w-64 bg-on-hero/20" />
              <Skeleton immediate className="mt-2 h-5 w-80 bg-on-hero/20" />
            </>
          ) : (
            <p className="text-title-1">{brand.name}</p>
          )}
          {brand.contact?.hotline && (
            <p className="mt-2 text-secondary text-on-hero-muted">
              {t('web.login.hero.hotline', {
                hotline: brand.contact.hotline,
                hours: pick(brand.contact.workingHours, lang),
              })}
            </p>
          )}
        </div>
        <div className="motion-fade max-w-md">
          <h2 className="text-display">{t('web.login.hero.subtitle')}</h2>
          <ul className="mt-8 flex flex-col gap-4">
            {(['point1', 'point2', 'point3'] as const).map((point, index) => (
              <li key={point} className="flex items-center gap-3 text-body">
                <span className="flex size-10 items-center justify-center rounded-control bg-on-hero/15">
                  <Icon name={(['note-pencil', 'buildings', 'wallet'] as const)[index] ?? 'info'} />
                </span>
                {t(`web.login.hero.${point}`)}
              </li>
            ))}
          </ul>
        </div>
        <span />
      </aside>
      {/* The text fades in over the frame `#boot` drew (the panel itself stays still, DR-306). */}
      <main id="main" className="motion-fade flex flex-col px-6 py-6 sm:px-12">
        <div className="flex justify-end gap-3">
          <ThemeSwitch />
          <LanguageSwitch />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center gap-6">
          <div>
            <h1 className="text-title-1 text-ink">{t('web.login.title')}</h1>
            <p className="mt-1 text-secondary text-ink-muted">{t('web.login.subtitle')}</p>
          </div>
          {failure && <Banner tone={failure.tone}>{failure.text}</Banner>}
          {!failure && reasonBanner && <Banner tone="info">{reasonBanner}</Banner>}
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <TextField
              type="email"
              name="email"
              autoComplete="username"
              label={t('web.login.field.email.label')}
              placeholder={t('web.login.field.email.placeholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={fieldError}
            />
            <TextField
              ref={passwordRef}
              type="password"
              name="password"
              autoComplete="current-password"
              label={t('web.login.field.password.label')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void navigate({ to: '/login', search: { ...search, dialog: 'forgot' } })
                }
              >
                {t('web.login.action.forgot')}
              </Button>
            </div>
            <Button
              type="submit"
              size="lg"
              block
              loading={pending}
              disabled={locked || email.trim() === '' || password === ''}
            >
              {t('web.login.cta')}
            </Button>
          </form>
          <p className="text-secondary text-ink-muted">{t('web.login.hint.apps')}</p>
          <p className="text-caption text-ink-muted">{t('web.login.footer')}</p>
        </div>
      </main>
      {search.dialog === 'forgot' && (
        <Suspense fallback={null}>
          <ForgotDialog
            open={search.dialog === 'forgot'}
            email={email}
            onClose={() =>
              void navigate({ to: '/login', search: { ...search, dialog: undefined } })
            }
          />
        </Suspense>
      )}
    </div>
  )
}
