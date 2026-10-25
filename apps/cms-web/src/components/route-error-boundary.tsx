import { lazy, Suspense } from 'react'

// The boundary loads when a page fails, not with the first load (the budget of DOC-55 §3). A chunk that is gone after a deploy
// reloads the page once through `vite:preloadError` (`main.tsx`).
const RouteError = lazy(() =>
  import('./route-error').then((module) => ({ default: module.RouteError })),
)

export function RouteErrorBoundary({ error }: { error: unknown }) {
  return (
    <Suspense fallback={null}>
      <RouteError error={error} />
    </Suspense>
  )
}
