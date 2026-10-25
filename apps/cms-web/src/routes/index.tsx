import { createFileRoute, redirect } from '@tanstack/react-router'
import { LANDING } from '../features/auth/landing'

/** `/` is the landing page (`/units` until the dashboard ships, P6). The `_app` layout decides about a missing session. */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ href: LANDING })
  },
})
