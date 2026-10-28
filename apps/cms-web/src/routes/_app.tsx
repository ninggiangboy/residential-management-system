import { ApiException } from '@rms/client-core'
import type { StaffRole } from '@rms/shared-types'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect, useMatches, useRouter } from '@tanstack/react-router'
import { apiErrorOf } from '../api/errors'
import { staffMeQuery } from '../api/hooks/staff-me'
import { ensureSession } from '../auth/session'
import { StepUpProvider } from '../auth/step-up'
import { AppShell } from '../components/layout/app-shell'
import { BreadcrumbProvider } from '../components/layout/breadcrumb'
import { ShellSkeleton } from '../components/layout/shell-skeleton'
import { RouteErrorBoundary } from '../components/route-error-boundary'
import { ErrorState, ForbiddenState } from '../components/ui/empty-state'
import { isWebRole } from '../features/auth/landing'
import { useUsageRecording } from '../lib/usage'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The roles that may open the route; any other role gets the Forbidden state, not a redirect (UX-07). */
    roles?: readonly StaffRole[]
  }
}

export const Route = createFileRoute('/_app')({
  // The boot of DOC-55 §5.1: the refresh before anything renders, so there is no flash of the sign-in page (CL-20).
  beforeLoad: async ({ context, location }) => {
    const me = await ensureSession(context.queryClient)
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } })
    if (!isWebRole(me.role)) throw redirect({ to: '/wrong-app' })
  },
  // The shell's frame appears after 150 ms (a restored session usually answers sooner) and stays at least 200 ms, so a slow
  // boot shows one calm placeholder instead of a blank page followed by a jump.
  pendingMs: 150,
  pendingMinMs: 200,
  pendingComponent: ShellSkeleton,
  // A failed call keeps the shell and offers a retry; anything else is a render error of the page (reported, DOC-55 §15).
  errorComponent: ({ error }) => {
    const router = useRouter()
    if (!(error instanceof ApiException)) return <RouteErrorBoundary error={error} />
    return (
      <main className="mx-auto max-w-xl p-8">
        <ErrorState requestId={apiErrorOf(error).requestId} onRetry={() => router.invalidate()} />
      </main>
    )
  },
  component: AppLayout,
})

function AppLayout() {
  const me = useQuery(staffMeQuery()).data
  const matches = useMatches()
  useUsageRecording(matches.at(-1)?.fullPath)
  if (!me) return null
  const roles = [...matches].reverse().find((match) => match.staticData?.roles)?.staticData?.roles
  const allowed = !roles || roles.includes(me.role)
  return (
    <BreadcrumbProvider>
      <StepUpProvider>
        <AppShell role={me.role}>{allowed ? <Outlet /> : <ForbiddenState />}</AppShell>
      </StepUpProvider>
    </BreadcrumbProvider>
  )
}
