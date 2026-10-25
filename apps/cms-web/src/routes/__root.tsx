import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { buttonStyles } from '../components/ui/button'
import { EmptyState } from '../components/ui/empty-state'
import { Toaster } from '../components/ui/toaster'
import { useT } from '../lib/i18n'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <>
      <Outlet />
      <Toaster />
    </>
  ),
  notFoundComponent: NotFound,
})

/** An unknown path renders `NotFound` with a link to the landing page (DOC-53 §4 rule 7). */
function NotFound() {
  const t = useT()
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center justify-center p-6">
      <EmptyState
        icon="magnifying-glass"
        title={t('common.not-found.title')}
        body={t('common.not-found.body')}
        actions={
          <Link to="/units" search={{}} className={buttonStyles({ variant: 'primary' })}>
            {t('web.shell.not-found.cta')}
          </Link>
        }
      />
    </main>
  )
}
