import { NotFoundError, requireRole } from '@core/kernel'
import type { IdentityApi } from '@mod/identity/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { planLookup } from '../../domain/lookup-plan'
import type { MembershipRecord } from '../../domain/membership'
import type { MembershipRepository } from '../../domain/membership-repository'
import type { ResidentReader } from '../../domain/resident-reader'
import type {
  HistoryCursor,
  HistoryRow,
  UnitCursor,
  UnitListFilter,
  UnitReader,
  UnitRow,
  UnitSummary,
} from '../../domain/unit-reader'
import type { UnitRepository } from '../../domain/unit-repository'
import { unitBody } from '../unit-body'

/** The Manager's and the Admin's alone (DOC-27 §3.3). The routes read the same list for their guard and audience. */
export const UNIT_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

const SEARCH_CAP = 20

export interface UnitListQuery extends UnitListFilter {
  q?: string
  after?: UnitCursor
  limit: number
}

export interface OwnerView {
  membershipId: string
  accountId: string
  fullName: string | null
  phone: string
}

export interface UnitListItem extends ReturnType<typeof unitBody> {
  memberCount: number
  owner: OwnerView | null
}

export interface MemberView {
  membershipId: string
  accountId: string
  fullName: string | null
  phone: string
  memberType: MembershipRecord['memberType']
  canPay: boolean
  status: 'active' | 'locked'
  lockedBy: MembershipRecord['lockedBy']
  startedAt: string
}

export interface UnitDetail extends ReturnType<typeof unitBody> {
  owner: OwnerView | null
  members: MemberView[]
  /** Until `finance` exists (P2) nothing is owed (DOC-51 §10). */
  debt: { openChargeCount: number; openAmount: number; oldestDueDate: string | null }
}

export interface HistoryItem {
  id: string
  kind: HistoryRow['kind']
  actor: { kind: HistoryRow['actorKind']; name: string | null }
  details: Record<string, unknown>
  at: string
}

/**
 * The reads of the unit routes (E-57, E-59, E-62; DOC-27 §4.2, §10): the list and search, the detail with its members and the
 * history. Names come from the profiles and phones from `IdentityApi` (one call per page); a unit of another building is 404.
 */
export class UnitQueries {
  constructor(
    private readonly units: UnitRepository,
    private readonly reader: UnitReader,
    private readonly memberships: MembershipRepository,
    private readonly residents: ResidentReader,
    private readonly identity: Pick<IdentityApi, 'getResidentAccounts' | 'getStaff'>,
  ) {}

  /**
   * E-57. With `q` the answer is the code search of DOC-27 §11.1 (at least 2 characters, the exact match first, at most 20, no
   * cursor); one character finds nothing.
   */
  async list(
    staff: StaffContext,
    query: UnitListQuery,
  ): Promise<{ items: UnitListItem[]; next: UnitCursor | null; summary: UnitSummary }> {
    requireRole(staff, UNIT_READ_ROLES)
    const { scope } = staff
    const summary = await this.reader.summary(scope)
    if (query.q !== undefined) {
      const plan = planLookup(query.q)
      const rows =
        plan.unitCode === null
          ? []
          : await this.reader.searchByCode(scope, plan.unitCode, SEARCH_CAP)
      return { items: await this.items(staff, rows), next: null, summary }
    }
    const rows = await this.reader.list(scope, query, query.after, query.limit + 1)
    const page = rows.slice(0, query.limit)
    const last = page.at(-1)
    return {
      items: await this.items(staff, page),
      next: rows.length > query.limit && last ? { code: last.unit.code, id: last.unit.id } : null,
      summary,
    }
  }

  /** E-59: the unit, its owner, its members (oldest first) and its debt. `version` is the `ETag`. */
  async get(staff: StaffContext, unitId: string): Promise<UnitDetail> {
    requireRole(staff, UNIT_READ_ROLES)
    const { scope } = staff
    const unit = await this.units.find(scope, unitId)
    if (!unit) throw new NotFoundError()
    const rows = await this.memberships.listOfUnit(scope, unitId)
    const ids = rows.map((row) => row.accountId)
    const [names, accounts] = await Promise.all([
      this.residents.namesOf(scope, ids),
      ids.length === 0 ? [] : this.identity.getResidentAccounts(ids),
    ])
    const phone = new Map(accounts.map((account) => [account.accountId, account.phone]))
    const view = (row: MembershipRecord) => ({
      membershipId: row.id,
      accountId: row.accountId,
      fullName: names.get(row.accountId) ?? null,
      phone: phone.get(row.accountId) ?? '',
    })
    const [owner] = rows.filter((row) => row.memberType === 'owner')
    return {
      ...unitBody(unit),
      owner: owner ? view(owner) : null,
      members: rows
        .filter((row) => row.memberType !== 'owner')
        .map((row) => ({
          ...view(row),
          memberType: row.memberType,
          canPay: row.canPay,
          status: row.status as 'active' | 'locked',
          lockedBy: row.lockedBy,
          startedAt: row.createdAt.toISOString(),
        })),
      debt: { openChargeCount: 0, openAmount: 0, oldestDueDate: null },
    }
  }

  /** E-62: newest first. The actor is shown by name, never a phone; a `system` actor has none. */
  async history(
    staff: StaffContext,
    unitId: string,
    page: { after?: HistoryCursor; limit: number },
  ): Promise<{ items: HistoryItem[]; next: HistoryCursor | null }> {
    requireRole(staff, UNIT_READ_ROLES)
    if (!(await this.units.find(staff.scope, unitId))) throw new NotFoundError()
    const rows = await this.reader.history(staff.scope, unitId, page.after, page.limit + 1)
    const shown = rows.slice(0, page.limit)
    const staffIds = shown.flatMap((r) => (r.actorKind === 'staff' && r.actorId ? [r.actorId] : []))
    const residentIds = shown.flatMap((r) =>
      r.actorKind === 'resident' && r.actorId ? [r.actorId] : [],
    )
    const [staffNames, residentNames] = await Promise.all([
      staffIds.length === 0 ? [] : this.identity.getStaff([...new Set(staffIds)]),
      residentIds.length === 0 ? [] : this.identity.getResidentAccounts([...new Set(residentIds)]),
    ])
    const names = new Map<string, string | null>([
      ...staffNames.map((s) => [s.staffId, s.fullName] as const),
      ...residentNames.map((a) => [a.accountId, a.displayName] as const),
    ])
    const last = shown.at(-1)
    return {
      items: shown.map((row) => ({
        id: row.id,
        kind: row.kind,
        actor: { kind: row.actorKind, name: row.actorId ? (names.get(row.actorId) ?? null) : null },
        details: row.details,
        at: row.at.toISOString(),
      })),
      next: rows.length > page.limit && last ? { at: last.at, id: last.id } : null,
    }
  }

  /** The owner's name from the profile and phone from the account, one call for the whole page. */
  private async items(staff: StaffContext, rows: UnitRow[]): Promise<UnitListItem[]> {
    const ownerIds = rows.flatMap((row) => (row.ownerAccountId ? [row.ownerAccountId] : []))
    const [names, accounts] = await Promise.all([
      this.residents.namesOf(staff.scope, ownerIds),
      ownerIds.length === 0 ? [] : this.identity.getResidentAccounts(ownerIds),
    ])
    const phone = new Map(accounts.map((account) => [account.accountId, account.phone]))
    return rows.map((row) => ({
      ...unitBody(row.unit),
      memberCount: row.memberCount,
      owner:
        row.ownerMembershipId && row.ownerAccountId
          ? {
              membershipId: row.ownerMembershipId,
              accountId: row.ownerAccountId,
              fullName: names.get(row.ownerAccountId) ?? null,
              phone: phone.get(row.ownerAccountId) ?? '',
            }
          : null,
    }))
  }
}
