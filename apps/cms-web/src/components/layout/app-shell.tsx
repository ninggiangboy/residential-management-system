import type { IconName } from '@rms/design-tokens'
import type { MessageKey } from '@rms/i18n-catalog'
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
import { cn } from '../../lib/utils'
import { Avatar } from '../ui/avatar'
import { IconButton } from '../ui/button'
import { Icon } from '../ui/icon'
import { Tooltip } from '../ui/menu'
import { toast } from '../ui/toaster'
import { useBreadcrumbTail } from './breadcrumb'
import { LanguageSwitch } from './language-switch'
import { useBrand } from './public-layout'

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
    <aside className="sticky top-0 flex h-screen w-[72px] shrink-0 flex-col border-r border-line bg-surface lg:w-[248px]">
      <div className="px-4 py-5 lg:px-6">
        <p className="hidden text-title-3 text-ink lg:block">{brand.name}</p>
        <p className="hidden text-secondary text-ink-muted lg:block">
          {t('web.shell.brand.subtitle')}
        </p>
        <span className="flex justify-center text-teal lg:hidden" aria-hidden="true">
          <Icon name="buildings" size="lg" weight="fill" />
        </span>
      </div>
      <nav aria-label={t('web.shell.nav.label')} className="flex-1 overflow-y-auto px-3">
        {NAV.map((group) => {
          const items = group.items.filter((item) => item.roles.includes(role))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="mb-4">
              <p className="mb-1 hidden px-3 text-caption text-ink-muted lg:block">
                {t(group.label)}
              </p>
              <ul className="flex flex-col gap-1">
                {items.map((item) => (
                  <li key={item.to}>
                    <Tooltip text={t(item.label)}>
                      <Link
                        to={item.to}
                        search={{}}
                        className="flex h-control-sm items-center justify-center gap-3 rounded-control px-3 text-label text-ink outline-offset-2 hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus lg:justify-start"
                        activeProps={{
                          className: 'bg-teal-soft !text-on-teal-soft hover:!bg-teal-soft',
                          'aria-current': 'page',
                        }}
                      >
                        {({ isActive }: { isActive: boolean }) => (
                          <>
                            <Icon name={item.icon} weight={isActive ? 'fill' : 'regular'} />
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
        <div className="m-3 flex items-center gap-2 rounded-card bg-fill p-2">
          <Link
            to="/profile"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-control p-1 outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Avatar name={me.fullName} src={me.avatarUrl} size="sm" />
            <span className="sr-only lg:hidden">{t('web.shell.user.open-profile')}</span>
            <span className="hidden min-w-0 lg:block">
              <span className="block truncate text-label text-ink">{me.fullName}</span>
              <span className="block truncate text-caption text-ink-muted">
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
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-8">
      <nav aria-label={t('web.shell.breadcrumb.label')}>
        <ol className="flex items-center gap-2 text-secondary text-ink-muted">
          {crumbs?.map((key, index) => (
            <li key={key} className="flex items-center gap-2">
              {index > 0 && <span aria-hidden="true">/</span>}
              <span className={cn(index === crumbs.length - 1 && !tail && 'text-ink')}>
                {t(key as MessageKey)}
              </span>
            </li>
          ))}
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
      <div className="flex items-center gap-3">
        {env.appEnv !== 'production' && (
          <span className="rounded-full bg-lamp-soft px-3 py-1 text-caption text-on-lamp-soft">
            {env.appEnv}
          </span>
        )}
        <LanguageSwitch
          disabled={language.pending}
          onChange={me ? (next) => language.change(me, next) : undefined}
        />
      </div>
    </header>
  )
}

/**
 * Every `W-` screen after sign-in sits in this shell (DOC-64 shell): sidebar 248 px, top bar 64 px, page area 28 × 32 px. Between
 * 768 and 1023 px the sidebar is a 72 px icon rail; below 768 px there is only the notice (DR-178, DR-186).
 */
export function AppShell({ role, children }: { role: StaffRole; children: ReactNode }) {
  const { t } = useI18n()
  const online = useOnline()
  return (
    <>
      <div className="flex min-h-screen items-center justify-center p-8 text-center md:hidden">
        <p className="max-w-sm text-body text-ink-muted">{t('web.shell.unsupported')}</p>
      </div>
      <div className="hidden min-h-screen md:flex">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
        >
          {t('web.shell.skip')}
        </a>
        <Sidebar role={role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          {!online && (
            <div role="status" className="bg-lamp-soft px-8 py-2 text-secondary text-on-lamp-soft">
              {t('web.shell.offline')}
            </div>
          )}
          <main id="main" className="min-w-0 flex-1 px-8 pb-10 pt-7">
            {children}
          </main>
        </div>
      </div>
    </>
  )
}
