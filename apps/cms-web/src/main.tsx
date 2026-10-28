import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setSignedOutHandler } from './api/client'
import { publicConfigQuery } from './api/hooks/public-config'
import { createQueryClient } from './api/query-client'
import { listenToOtherTabs } from './auth/refresh'
import { endSessionLocally, setLoginRedirect } from './auth/session'
import type { Crumb } from './components/layout/breadcrumb'
import { RouteErrorBoundary } from './components/route-error-boundary'
import { I18nProvider } from './lib/i18n'
import { routeTree } from './routeTree.gen'

const queryClient = createQueryClient()
// The brand (E-03, public) is asked for now, beside the session refresh, not after the first page has drawn: the sign-in hero
// and the sidebar then usually open with the building name instead of a placeholder that is replaced (DR-306).
void queryClient.prefetchQuery(publicConfigQuery())

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
    /** The breadcrumb "Group / Page" (DOC-64 shell): a catalog key and the page a click opens (a group opens its first page). */
    crumbs?: readonly [Crumb, Crumb]
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

// The static frame of `index.html` stays until the first page is in #root: every page, its skeleton and the error pages have a
// `main`, so the frame is never removed onto a blank screen (DR-306). Ten seconds is a backstop for a page that never draws.
const boot = document.getElementById('boot')
if (boot) {
  const observer = new MutationObserver(() => {
    if (root.querySelector('main')) done()
  })
  const done = () => {
    observer.disconnect()
    boot.remove()
  }
  observer.observe(root, { childList: true, subtree: true })
  window.setTimeout(done, 10_000)
}
createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
)
