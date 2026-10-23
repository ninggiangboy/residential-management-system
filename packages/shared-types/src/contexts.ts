import type {
  BuildingId,
  BuildingScope,
  MembershipId,
  ResidentAccountId,
  StaffId,
  UnitId,
} from './ids'
import type { Capability, MemberType, StaffRole } from './people'

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

/**
 * A resident request after the `resident` guard: the account the token names and its session (`sid`). It carries no building and
 * no unit: those come from the selected membership (ADR-0010, FR-16.3).
 */
export interface ResidentSession {
  readonly accountId: ResidentAccountId
  readonly sessionId: string
}

/**
 * The context of a resident request after the `unit(capability)` guard (DOC-12 §11.1, DOC-27 §3.1): built from the membership
 * row of `(account, unit)` on every request, so a lock or a removal applies to the very next one (FR-16.1). The policy function
 * `can` is `@mod/residency`'s; the type lives here because the guards and the other modules take it as an argument.
 */
export interface UnitContext {
  readonly buildingId: BuildingId
  readonly unitId: UnitId
  readonly membershipId: MembershipId
  readonly accountId: ResidentAccountId
  readonly memberType: MemberType
  readonly canPay: boolean
  /** `membership.created_at`: finance shows paid history only from this instant on (DR-40). */
  readonly startedAt: Date
  readonly scope: BuildingScope
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
  /**
   * Verifies the token (`kind = resident`) and that the account may still act (`active` or `deletion_requested`): 401 otherwise.
   * It loads nothing else. The `unit(capability)` guard of P1-12 builds on it and adds the membership and the terms gate.
   */
  resident(): RouteGuard
  /**
   * After `resident`: reads `X-Unit-Id`, loads the membership on every request, runs the terms gate and asks the policy for
   * `capability` (DOC-27 §3.1): 400 for a missing or malformed header, 403 `membership_inactive`, `terms_required` or `forbidden`.
   */
  unit(capability: Capability): RouteGuard
}

/** The staff member a `staff` guard proved, read by the handler of a route that carries it. */
export function staffOf(context: object): StaffSession {
  const staff = (context as { staff?: StaffSession }).staff
  if (!staff) throw new Error('staffOf: the route has no staff guard')
  return staff
}

/** The resident a `resident` guard proved, read by the handler of a route that carries it. */
export function residentOf(context: object): ResidentSession {
  const resident = (context as { resident?: ResidentSession }).resident
  if (!resident) throw new Error('residentOf: the route has no resident guard')
  return resident
}

/** The unit context a `unit(capability)` guard built, read by the handler of a route that carries it. */
export function unitOf(context: object): UnitContext {
  const unit = (context as { unit?: UnitContext }).unit
  if (!unit) throw new Error('unitOf: the route has no unit guard')
  return unit
}
