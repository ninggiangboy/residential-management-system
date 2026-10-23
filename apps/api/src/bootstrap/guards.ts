import { requestContext } from '@core/context'
import { ForbiddenError, UnauthorizedError } from '@core/kernel'
import type { AccessTokenVerifier, IdentityApi, StaffDto } from '@mod/identity/contracts'
import type {
  BuildingId,
  GuardContext,
  Guards,
  ResidentAccountId,
  ResidentSession,
  StaffId,
  StaffRole,
  StaffSession,
} from '@rms/shared-types'

/** What the guards read from `identity`; the container passes forwarders because `identity` is installed with the routes that use them. */
export interface GuardDeps {
  verifier: Pick<AccessTokenVerifier, 'verify'>
  identity: Pick<IdentityApi, 'getStaff'>
}

const BEARER = 'Bearer '
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
function recordResident(accountId: string): void {
  const request = requestContext.get()
  if (!request) return
  request.accountKind = 'resident'
  request.accountId = accountId
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
 * what the resident may do is read from the membership by the `unit(capability)` guard of P1-12. A staff token is 401 here, as a
 * resident token is on a staff route, whatever the role (FR-16.4, AU-41).
 */
export function createGuards({ verifier, identity }: GuardDeps): Guards {
  /** The staff row a valid staff token names, or 401. */
  async function prove(header: string | null): Promise<{ row: StaffDto; sessionId: string }> {
    if (!header?.startsWith(BEARER)) throw unauthenticated()
    const claims = await verifier.verify(header.slice(BEARER.length))
    if (claims.kind !== 'staff') throw unauthenticated()
    const [row] = await identity.getStaff([claims.sub])
    if (!row || row.status !== 'active' || row.buildingId !== claims.bid) throw unauthenticated()
    return { row, sessionId: claims.sid }
  }

  return {
    resident: () => ({
      transform: async (context: GuardContext) => {
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
