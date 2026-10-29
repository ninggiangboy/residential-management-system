import type { IconName } from '@rms/design-tokens'
import type { MessageKey } from '@rms/i18n-catalog/web'
import type { StaffRole } from '@rms/shared-types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useMatches } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { staffMeQuery } from '../../api/hooks/staff-me'
import { useChangeLanguage } from '../../api/hooks/staff-me-mutations'
import { signOut } from '../../auth/session'
import { env } from '../../env'
import { useI18n } from '../../lib/i18n'
import { useOnline } from '../../lib/online'
import { Avatar } from '../ui/avatar'
import { IconButton } from '../ui/button'
import { Icon } from '../ui/icon'
import { Tooltip } from '../ui/menu'
import { Skeleton } from '../ui/skeleton'
import { toast } from '../ui/toaster'
import { BrandMark } from './brand-mark'
import { useBreadcrumbTail } from './breadcrumb'
import { LanguageSwitch } from './language-switch'
import { useBrand } from './public-layout'
import { ThemeSwitch } from './theme-switch'

interface NavItem {
  to: '/units' | '/residents' | '/staff' | '/building'
  label: MessageKey
  icon: IconName
  roles: readonly StaffRole[]
}
interface NavGroup {
  label: MessageKey
  items: readonly NavItem[]
}

const BOTH = ['admin', 'manager'] as const

/**
 * The sidebar of DOC-53 §3.4: an entry exists only when the role has the route (UX-07) and its phase has shipped (DR-174). The
 * list is a constant of the build, not a server flag. Groups with no entry for the role are not drawn.
 */
const NAV: readonly NavGroup[] = [
  {
    label: 'web.shell.nav.group.residents',
    items: [
      { to: '/units', label: 'web.shell.nav.units', icon: 'buildings', roles: BOTH },
      { to: '/residents', label: 'web.shell.nav.residents', icon: 'users-three', roles: BOTH },
    ],
  },
  {
    label: 'web.shell.nav.group.system',
    items: [
      { to: '/staff', label: 'web.shell.nav.staff', icon: 'user-circle', roles: BOTH },
      { to: '/building', label: 'web.shell.nav.building', icon: 'gear', roles: ['admin'] },
    ],
  },
]

function Sidebar({ role }: { role: StaffRole }) {
  const { t } = useI18n()
  const brand = useBrand()
  const queryClient = useQueryClient()
  const me = useQuery(staffMeQuery()).data
  return (
    // The sidebar is clear over the page's `ground` with the top bar, without a border: the cards of the page are
    // the only white that rises from it, and the active entry rises the same way (DR-311).
    <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col lg:w-[248px]">
      <div className="flex items-center justify-center gap-3 px-4 py-4 lg:justify-start lg:px-5">
        <BrandMark />
        <div className="hidden min-w-0 lg:block">
          {/* The name arrives with E-03; its line keeps its height meanwhile, so the navigation below does not move. */}
          {brand.loading ? (
            <div className="flex h-5.5 items-center">
              <Skeleton className="h-4 w-32" />
            </div>
          ) : (
            <p className="truncate text-title-3 text-ink">{brand.name}</p>
          )}
          <p className="text-secondary text-ink-muted">{t('web.shell.brand.subtitle')}</p>
        </div>
      </div>
      <nav aria-label={t('web.shell.nav.label')} className="flex-1 overflow-y-auto px-3 pt-2">
        {NAV.map((group) => {
          const items = group.items.filter((item) => item.roles.includes(role))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="mb-4">
              <p className="mb-1.5 hidden px-2.5 text-caption text-ink-muted lg:block">
                {t(group.label)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <Tooltip text={t(item.label)}>
                      <Link
                        to={item.to}
                        search={{}}
                        className="flex h-control-md items-center justify-center gap-2.5 rounded-control px-2.5 text-label text-ink-muted outline-offset-2 transition-[color,background-color,box-shadow] duration-150 hover:text-ink hover:bg-fill/70 focus-visible:outline-2 focus-visible:outline-focus lg:justify-start"
                        activeProps={{
                          className:
                            'bg-surface !text-ink font-semibold shadow-panel hover:!bg-surface',
                          'aria-current': 'page',
                        }}
                      >
                        {({ isActive }: { isActive: boolean }) => (
                          <>
                            <Icon
                              name={item.icon}
                              weight={isActive ? 'fill' : 'regular'}
                              className={isActive ? 'text-teal' : undefined}
                            />
                            <span className="hidden lg:inline">{t(item.label)}</span>
                            <span className="sr-only lg:hidden">{t(item.label)}</span>
                          </>
                        )}
                      </Link>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </nav>
      {me && (
        <div className="m-3 flex items-center gap-2 rounded-card border border-line bg-surface p-1.5 shadow-panel">
          <Link
            to="/profile"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-plate p-0.5 outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Avatar name={me.fullName} src={me.avatarUrl} size="sm" />
            <span className="sr-only lg:hidden">{t('web.shell.user.open-profile')}</span>
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate text-label text-ink">{me.fullName}</span>
              <span className="block truncate text-secondary text-ink-muted">
                {t(`common.staff-role.${me.role}`)}
              </span>
            </span>
          </Link>
          <IconButton
            icon="sign-out"
            label={t('common.action.sign-out')}
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => void signOut(queryClient, 'user')}
          />
        </div>
      )}
      {me && (
        <IconButton
          icon="sign-out"
          label={t('common.action.sign-out')}
          size="sm"
          className="mx-auto mb-3 lg:hidden"
          onClick={() => void signOut(queryClient, 'user')}
        />
      )}
    </aside>
  )
}

function TopBar() {
  const { t } = useI18n()
  const matches = useMatches()
  const crumbs = [...matches].reverse().find((match) => match.staticData?.crumbs)
    ?.staticData?.crumbs
  const tail = useBreadcrumbTail()
  const me = useQuery(staffMeQuery()).data
  const language = useChangeLanguage(() => toast.error(t('web.shell.language.failed')))
  return (
    // Clear over the page's `ground` like the sidebar; its bottom edge shows only once the page scrolls under it
    // (`edge-on-scroll`, DR-311).
    <header className="edge-on-scroll gutter-stable flex h-14 shrink-0 items-center justify-between gap-4 overflow-hidden border-b px-8">
      <nav aria-label={t('web.shell.breadcrumb.label')}>
        <ol className="flex items-center gap-2 text-secondary text-ink-muted">
          {crumbs?.map((crumb, index) => {
            const current = index === crumbs.length - 1 && !tail
            return (
              <li key={crumb.label} className="flex items-center gap-2">
                {index > 0 && <span aria-hidden="true">/</span>}
                {current ? (
                  <span className="text-ink" aria-current="page">
                    {t(crumb.label as MessageKey)}
                  </span>
                ) : (
                  <Link
                    to={crumb.to}
                    search={{}}
                    className="rounded-plate outline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    {t(crumb.label as MessageKey)}
                  </Link>
                )}
              </li>
            )
          })}
          {tail && (
            <li className="flex items-center gap-2">
              <span aria-hidden="true">/</span>
              <span className="text-ink" aria-current="page">
                {tail}
              </span>
            </li>
          )}
        </ol>
      </nav>
      <div className="flex items-center gap-2">
        {env.appEnv !== 'production' && (
          <span className="rounded-full bg-lamp-soft px-2 py-0.5 text-caption text-on-lamp-soft">
            {env.appEnv}
          </span>
        )}
        <ThemeSwitch />
        <LanguageSwitch
          disabled={language.pending}
          onChange={me ? (next) => language.change(me, next) : undefined}
        />
      </div>
    </header>
  )
}

/**
 * Every `W-` screen after sign-in sits in this shell (DOC-64 shell): sidebar 248 px, top bar 56 px, page area 24 × 32 px. Between
 * 768 and 1023 px the sidebar is a 72 px icon rail; below 768 px there is only the notice (DR-178, DR-186).
 */
export function AppShell({ role, children }: { role: StaffRole; children: ReactNode }) {
  const { t } = useI18n()
  const online = useOnline()
  const pageKey = useMatches().find((match) => match.routeId.startsWith('/_app/'))?.routeId
  return (
    <>
      <div className="flex min-h-screen items-center justify-center p-8 text-center md:hidden">
        <p className="max-w-sm text-body text-ink-muted">{t('web.shell.unsupported')}</p>
      </div>
      {/*
        Clipped: the page area rises 4 px as it arrives (`motion-page`), and without the clip those 4 px overflow the window and
        flash a window scrollbar that narrows the whole shell for the length of the animation (DOC-54 §17.5).
      */}
      <div className="hidden h-screen overflow-clip md:flex">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
        >
          {t('web.shell.skip')}
        </a>
        <Sidebar role={role} />
        <div className="timeline-main flex min-w-0 flex-1 flex-col">
          <TopBar />
          {!online && (
            <div role="status" className="bg-lamp-soft px-8 py-2 text-secondary text-on-lamp-soft">
              {t('web.shell.offline')}
            </div>
          )}
          {/*
            Keyed by the page route (not its dialogs, not its search), so a new page fades in and a filter does not. The page
            area scrolls, not the window: the top bar stays, and a `ListPage` can end its table at the bottom of the window.
            It keeps its scrollbar's room (`gutter-stable`, like the top bar and the loading frames), so a page growing past
            the window does not shift sideways.
          */}
          <main
            key={pageKey}
            id="main"
            data-scroll-restoration-id="main"
            className="motion-page scroll-main gutter-stable min-h-0 min-w-0 flex-1 overflow-y-auto px-8 pb-10 pt-6"
          >
            {children}
          </main>
        </div>
      </div>
    </>
  )
}
