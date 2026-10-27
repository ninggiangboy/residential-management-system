import type { Capability } from '@rms/shared-types'
import { type Actor, isResident, isStaff, MEMBER_OF_U1, STAFF_ROLE_OF } from './actors'
import type { RouteRecord } from './route-records'

/** `own` and `foreign` of DOC-39 §4.3. */
export type Scope = 'own' | 'foreign'

export type Expected =
  | 'ALLOW'
  | '401 unauthenticated'
  | '403 forbidden'
  | '403 membership_inactive'
  | '403 terms_required'
  | '403 step_up_required'
  | '401 invalid_signature'
  | '404 not_found'

/**
 * A hand-typed copy of the policy table of DOC-27 §3.2, **not** the production function: a wrong production table is a failure,
 * and the copy is compared with the document by a reviewer at each change of the table (EXP-10 §10, mutant M8).
 */
const CAPABILITY_TABLE: Record<
  Capability,
  { owner: boolean; family: boolean; tenantNoPay: boolean; tenantPay: boolean; helper: boolean }
> = {
  broadcast_notices: {
    owner: true,
    family: true,
    tenantNoPay: true,
    tenantPay: true,
    helper: true,
  },
  personal_notifications: {
    owner: true,
    family: true,
    tenantNoPay: true,
    tenantPay: true,
    helper: false,
  },
  view_fees: { owner: true, family: true, tenantNoPay: true, tenantPay: true, helper: false },
  pay: { owner: true, family: true, tenantNoPay: false, tenantPay: true, helper: false },
  tickets: { owner: true, family: true, tenantNoPay: true, tenantPay: true, helper: false },
  vehicles: { owner: true, family: true, tenantNoPay: true, tenantPay: true, helper: false },
  library: { owner: true, family: true, tenantNoPay: true, tenantPay: true, helper: false },
  manage_members: {
    owner: true,
    family: false,
    tenantNoPay: false,
    tenantPay: false,
    helper: false,
  },
}

/** Whether a member of U1 may use `capability`, from the hand-typed table. */
function mayUse(actor: Actor, capability: string): boolean {
  const member = MEMBER_OF_U1[actor]
  const row = CAPABILITY_TABLE[capability as Capability]
  if (!member || !row) return false
  if (member.memberType === 'tenant') return member.canPay ? row.tenantPay : row.tenantNoPay
  return row[member.memberType]
}

/** The building an object of `scope` lies in, and the building an actor works in (DOC-39 §4.3). */
const objectBuilding = (scope: Scope) => (scope === 'own' ? 'B1' : 'B2')
const actorBuilding = (actor: Actor) => (actor === 'staff.admin_b2' ? 'B2' : 'B1')

/** Routes whose terms gate does not apply (DOC-50 §7): none in the first version. */
const EXEMPT_FROM_TERMS = new Set<string>()

/**
 * `expected(route, actor, scope)` of DOC-39 §4.4: a pure function of the metadata. The step-up answer is not here: a route with
 * `stepUp` is `ALLOW` at the gate for the listed roles, and the step-up cases of EXP-10 §7.1 decide what a request with and
 * without a proof gets.
 *
 * A token of the wrong kind is a 401, not a 403 (the `staff` guard checks `kind = staff`, the resident guards `kind = resident`;
 * RM-03): DOC-39 §4.4 said 403 and is corrected with this task.
 */
export function expected(route: RouteRecord, actor: Actor, scope: Scope): Expected {
  const { audience } = route
  if (audience.kind === 'public') return 'ALLOW'
  if (audience.kind === 'webhook') return '401 invalid_signature'
  const anonymous = actor === 'anon' || actor === 'tok.expired'
  if (anonymous) return '401 unauthenticated'

  if (audience.kind === 'staff') {
    if (isResident(actor)) return '401 unauthenticated'
    if (actor === 'staff.disabled') return '401 unauthenticated'
    const role = STAFF_ROLE_OF[actor]
    if (!role || !audience.roles.includes(role)) return '403 forbidden'
    if (route.scopeOfObject === 'building' && route.objectParams.length > 0)
      return objectBuilding(scope) === actorBuilding(actor) ? 'ALLOW' : '404 not_found'
    // Both buildings of the matrix are real ones, so a route reserved for the demo building does not exist for them (DOC-36 §10.4).
    if (DEMO_ONLY.has(route.endpointId)) return '404 not_found'
    return ALWAYS_STEP_UP.has(route.endpointId) && role === 'admin'
      ? '403 step_up_required'
      : 'ALLOW'
  }

  // audience.kind === 'resident'
  if (isStaff(actor)) return '401 unauthenticated'
  if (!audience.capability) {
    if (route.scopeOfObject === 'account' && scope === 'foreign') return '404 not_found'
    return 'ALLOW'
  }
  if (actor === 'res.stranger' || actor === 'res.locked') return '403 membership_inactive'
  if (actor === 'res.terms_pending' && !EXEMPT_FROM_TERMS.has(route.endpointId))
    return '403 terms_required'
  if (!mayUse(actor, audience.capability)) return '403 forbidden'
  if (scope === 'foreign' && route.objectParams.length > 0) return '404 not_found'
  return 'ALLOW'
}

/**
 * Routes whose step-up is demanded by every call of the minimal request: an Admin without a proof is told `step_up_required`
 * (DOC-39 §4.4). E-40 and E-42 demand it only for the body that makes an Admin or changes an email, which the minimal
 * request of the matrix is not (the step-up pass of EXP-10 §7.1 sends those).
 */
const ALWAYS_STEP_UP = new Set(['E-50'])

/**
 * Routes that exist only for a demo building: for a building that is not one the answer is 404, not 403, so the endpoint does not
 * reveal itself (E-56). The world of the matrix has no demo building; `tests/integration/demo.integration.test.ts` runs the route
 * on one (BD-42).
 */
const DEMO_ONLY = new Set(['E-56'])

/** The actors whose `foreign` cell exists: those that pass the gate of the route (DOC-39 §4.3). */
export function hasForeignCell(route: RouteRecord, actor: Actor): boolean {
  if (route.scopeOfObject === 'none') return false
  // A route without a path object has a foreign cell only when it is a list: the leak scan is its check.
  if (route.objectParams.length === 0 && route.method !== 'GET') return false
  const own = expected(route, actor, 'own')
  return own === 'ALLOW' || own === '404 not_found' || own === '403 step_up_required'
}

export const isAllow = (e: Expected) => e === 'ALLOW'
export const statusOf = (e: Expected) => (e === 'ALLOW' ? 0 : Number(e.slice(0, 3)))
export const codeOf = (e: Expected) => (e === 'ALLOW' ? null : e.slice(4))
