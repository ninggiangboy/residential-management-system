import type { StaffRole } from '@rms/shared-types'

/** The page a staff member lands on (DOC-53 §3.4): `/units` until the dashboard ships (P6); Technician and Guard meet `/wrong-app`. */
export const LANDING = '/units'

export const WEB_ROLES: readonly StaffRole[] = ['admin', 'manager']
export const isWebRole = (role: StaffRole) => WEB_ROLES.includes(role)

export function landingFor(role: StaffRole, redirect: string | undefined): string {
  if (!isWebRole(role)) return '/wrong-app'
  return redirect ?? LANDING
}
