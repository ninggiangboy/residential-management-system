import { requestContext } from '@core/context'
import { ForbiddenError, UnauthorizedError, ValidationError } from '@core/kernel'
import type { AccessTokenVerifier, IdentityApi, StaffDto } from '@mod/identity/contracts'
import { can, type ResidencyApi } from '@mod/residency/contracts'
import type {
  BuildingId,
  Capability,
  GuardContext,
  Guards,
  MembershipId,
  ResidentAccountId,
  ResidentSession,
  StaffId,
  StaffRole,
  StaffSession,
  UnitContext,
  UnitId,
} from '@rms/shared-types'
import type { TermsGate } from './terms-gate'

/** What the guards read from `identity`; the container passes forwarders because `identity` is installed with the routes that use them. */
export interface GuardDeps {
  verifier: Pick<AccessTokenVerifier, 'verify'>
  identity: Pick<IdentityApi, 'getStaff'>
  residency: Pick<ResidencyApi, 'getMembership'>
  /** The terms gate of DOC-35 §9.2, which the `unit(capability)` guard runs once it knows the building. */
  termsGate: TermsGate
}

const BEARER = 'Bearer '
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unauthenticated = () => new UnauthorizedError('unauthenticated', 'Please sign in again')

/** Puts who the request acts for on the request context, where the log line and the audit row read it (DOC-42 §8.1). */
function recordActor(row: StaffDto): void {
  const request = requestContext.get()
  if (!request) return
  request.accountKind = 'staff'
  request.accountId = row.staffId
  request.role = row.role
  request.buildingId = row.buildingId
}

/** The same for a resident: only the account and the kind, never a role or a building (a resident token holds none). */
function recordResident(accountId: string, buildingId?: string): void {
  const request = requestContext.get()
  if (!request) return
  request.accountKind = 'resident'
  request.accountId = accountId
  if (buildingId) request.buildingId = buildingId
}

/**
 * The guards of DOC-12 §5.3, built from the contracts and handed to every module (DR-99). Each is a `transform` hook, so a
 * request without a valid credential never receives a validation answer (DR-247, AG-04).
 *
 * `staff(roles)` verifies the token (`kind = staff`), reads role and status from the database on every request (FR-14.4), and
 * checks the role: a changed role or a lock applies at once, although the access token lives for 15 minutes. A token of an
 * account that is no longer `active`, or of another building than the row's, is 401; a role that is not listed is 403.
 *
 * `resident()` verifies the token (`kind = resident`) and loads nothing else: a resident token carries no building and no unit, and
 * what the resident may do is read from the membership by `unit(capability)`. A staff token is 401 here, as a resident token is on
 * a staff route, whatever the role (FR-16.4, AU-41).
 *
 * `unit(capability)` (DOC-27 §3.1) runs after the same proof and then, on every request and with nothing cached (FR-16.3): reads
 * `X-Unit-Id` (400 when missing or not a UUID), loads the membership of `(account, unit)`, answers 403 `membership_inactive` for
 * no row and for a locked one alike (so a caller learns nothing about a unit that is not theirs), runs the terms gate now that the
 * building is known, and asks the policy table for `capability` (403 `forbidden`).
 */
export function createGuards({ verifier, identity, residency, termsGate }: GuardDeps): Guards {
  /** The staff row a valid staff token names, or 401. */
  async function prove(header: string | null): Promise<{ row: StaffDto; sessionId: string }> {
    if (!header?.startsWith(BEARER)) throw unauthenticated()
    const claims = await verifier.verify(header.slice(BEARER.length))
    if (claims.kind !== 'staff') throw unauthenticated()
    const [row] = await identity.getStaff([claims.sub])
    if (!row || row.status !== 'active' || row.buildingId !== claims.bid) throw unauthenticated()
    return { row, sessionId: claims.sid }
  }

  /** The resident a valid resident token names, or 401; stored on the context and the request log. */
  async function proveResident(context: GuardContext): Promise<ResidentSession> {
    const header = context.request.headers.get('authorization')
    if (!header?.startsWith(BEARER)) throw unauthenticated()
    const claims = await verifier.verify(header.slice(BEARER.length))
    if (claims.kind !== 'resident') throw unauthenticated()
    const resident: ResidentSession = {
      accountId: claims.sub as ResidentAccountId,
      sessionId: claims.sid,
    }
    context.resident = resident
    recordResident(claims.sub)
    return resident
  }

  return {
    resident: () => ({
      transform: async (context: GuardContext) => {
        await proveResident(context)
      },
    }),
    unit: (capability: Capability) => ({
      transform: async (context: GuardContext) => {
        const { accountId } = await proveResident(context)
        const unitId = context.request.headers.get('x-unit-id')
        if (!unitId || !UUID.test(unitId))
          throw new ValidationError([
            { path: 'header.X-Unit-Id', code: 'required', message: 'X-Unit-Id is required' },
          ])
        const membership = await residency.getMembership(accountId, unitId)
        if (membership?.status !== 'active')
          throw new ForbiddenError('membership_inactive', 'You no longer have access to this home.')
        await termsGate(accountId, membership.buildingId)
        const buildingId = membership.buildingId as BuildingId
        const unit: UnitContext = {
          buildingId,
          unitId: membership.unitId as UnitId,
          membershipId: membership.membershipId as MembershipId,
          accountId,
          memberType: membership.memberType,
          canPay: membership.canPay,
          startedAt: new Date(membership.startedAt),
          scope: { buildingId },
        }
        if (!can(unit, capability)) throw new ForbiddenError()
        context.unit = unit
        recordResident(accountId, buildingId)
      },
    }),
    staff: (roles: readonly StaffRole[]) => ({
      transform: async (context: GuardContext) => {
        const { row, sessionId } = await prove(context.request.headers.get('authorization'))
        if (!roles.includes(row.role)) throw new ForbiddenError()
        const buildingId = row.buildingId as BuildingId
        const staff: StaffSession = {
          buildingId,
          staffId: row.staffId as StaffId,
          role: row.role,
          scope: { buildingId },
          sessionId,
        }
        context.staff = staff
        recordActor(row)
      },
    }),
  }
}
