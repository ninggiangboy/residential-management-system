import type { BuildingId, BuildingScope, StaffId } from './ids'
import type { StaffRole } from './people'

/**
 * The request context of a staff call, built by the `staff(...roles)` guard from the verified token and the account row
 * (DOC-12 §5.3, §11.1). It lives here, not in `identity`, because `audit` and `building` take it as an argument and a module
 * may import another's contracts only: `identity` re-uses this type in its own contract.
 */
export interface StaffContext {
  readonly buildingId: BuildingId
  readonly staffId: StaffId
  readonly role: StaffRole
  readonly scope: BuildingScope
}

/** A staff request after the `staff` guard: the context of a use case plus the session (`sid`) the access token names. */
export interface StaffSession extends StaffContext {
  readonly sessionId: string
}

/** What a guard needs of an Elysia context; structural, so this leaf package imports no framework. */
export interface GuardContext {
  readonly request: { readonly headers: { get(name: string): string | null } }
  [key: string]: unknown
}

/**
 * A route option that Elysia runs as a `transform` hook, before the body is validated: a request without a valid credential never
 * receives a validation answer (DOC-50 §7, DR-247). The guard stores what it proved on the context under `staff`.
 */
export interface RouteGuard {
  readonly transform: (context: GuardContext) => Promise<void>
}

/**
 * The guards `apps/api` builds from the contracts of `identity` and `residency` and hands to every module (DOC-12 §5.3, DR-99).
 * `staff(roles)` verifies the token, reads role and status from the database on every request, and checks the role: 401 for no
 * or a bad credential or an account that may no longer act, 403 for a role that is not listed.
 */
export interface Guards {
  staff(roles: readonly StaffRole[]): RouteGuard
}

/** The staff member a `staff` guard proved, read by the handler of a route that carries it. */
export function staffOf(context: object): StaffSession {
  const staff = (context as { staff?: StaffSession }).staff
  if (!staff) throw new Error('staffOf: the route has no staff guard')
  return staff
}
