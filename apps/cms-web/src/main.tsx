import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setSignedOutHandler } from './api/client'
import { createQueryClient } from './api/query-client'
import { listenToOtherTabs } from './auth/refresh'
import { endSessionLocally, setLoginRedirect } from './auth/session'
import { RouteErrorBoundary } from './components/route-error-boundary'
import { I18nProvider } from './lib/i18n'
import { routeTree } from './routeTree.gen'
import './styles.css'

const queryClient = createQueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultErrorComponent: ({ error }) => <RouteErrorBoundary error={error} />,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  interface HistoryState {
    /** The address a reset link was asked for: it travels in router state only, never in the URL (DR-209). */
    email?: string
  }
  interface StaticDataRouteOption {
    /** Catalog keys of the breadcrumb "Group / Page" (DOC-64 shell). */
    crumbs?: readonly [string, string]
  }
}

// A refused refresh, a revoked session and a sign-out in another tab all end here (DOC-55 §5.4).
setLoginRedirect((reason) => {
  const search =
    reason === 'user' ? { reason: 'signed_out' as const } : { reason: 'expired' as const }
  void router.navigate({ to: '/login', search })
})
setSignedOutHandler((reason) =>
  endSessionLocally(queryClient, reason === 'user' ? 'user' : 'refresh_failed'),
)
listenToOtherTabs(() => endSessionLocally(queryClient, 'revoked'))

// `window.onerror` and unhandled rejections (DOC-55 §15). A chunk that no longer exists after a deploy reloads the page once (§16, DR-192).
void import('./lib/report-error').then((module) => module.installErrorReporting(router))
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  if (sessionStorage.getItem('rms.chunk-reload') === null) {
    sessionStorage.setItem('rms.chunk-reload', '1')
    window.location.reload()
  }
})

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing in index.html')
createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
)
