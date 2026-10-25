import { NotFoundError, requireRole, type SecretBox, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi } from '@mod/building/contracts'
import type { DeletionRequestDto, IdentityApi, ResidentAccountDto } from '@mod/identity/contracts'
import type { BuildingScope, MemberType, StaffContext, StaffRole } from '@rms/shared-types'
import { cccdAad } from '../../domain/resident-profile'
import type {
  MembershipOfAccount,
  ProfileListFilter,
  ProfileRow,
  ResidentReader,
} from '../../domain/resident-reader'
import type { LookupQueries } from './lookup-queries'

/** The Manager's and the Admin's alone (DOC-27 §3.3). The routes read the same list for their guard and audience. */
export const RESIDENT_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

const SEARCH_CAP = 20
/** The pending deletion requests are few; this many pages of 500 is far more than a building has. */
const DELETION_PAGES = 10

export interface ResidentListQuery {
  q?: string
  unitId?: string
  memberType?: MemberType
  status?: 'active' | 'locked'
  deletion?: 'requested'
  neverSignedIn?: boolean
  after?: string
  limit: number
}

export interface Deletion {
  requestedAt: string | null
  approvedAt: string | null
}

/** The detail adds the earliest execution, which the Manager reads after the approval (E-68). */
export interface DetailDeletion extends Deletion {
  executeAfter: string | null
}

export interface ResidentListItem {
  accountId: string
  fullName: string | null
  phone: string
  cccdMasked: string | null
  accountStatus: ResidentAccountDto['status']
  lastAppOpenAt: string | null
  memberships: Array<{
    membershipId: string
    unitId: string
    unitCode: string
    memberType: MemberType
    status: 'active' | 'locked'
  }>
  deletion: Deletion
}

export interface ResidentDetail {
  accountId: string
  phone: string
  accountStatus: 'active' | 'deletion_requested'
  profile: {
    fullName: string | null
    email: string | null
    cccd: string | null
    dateOfBirth: string | null
    note: string | null
    version: number
  }
  memberships: Array<{
    membershipId: string
    unitId: string
    unitCode: string
    memberType: MemberType
    status: 'active' | 'locked'
    startedAt: string
  }>
  deletion: DetailDeletion
}

const NO_DELETION: Deletion = { requestedAt: null, approvedAt: null }

/** `•••• 1234`: the only form of the ID number a list shows (DOC-35 §6). */
const maskedCccd = (last4: string | null) => (last4 === null ? null : `•••• ${last4}`)

/**
 * The reads of the resident routes (E-63, E-65; DOC-27 §5.3, §11): the list and search, and the detail, which is the one `pii.read`
 * view because it returns the full ID number and the date of birth. An account with no profile in the building is 404 (DR-136).
 */
export class ResidentQueries {
  private readonly auditedDetail: ReturnType<ResidentQueries['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly residents: ResidentReader,
    private readonly lookups: LookupQueries,
    private readonly identity: Pick<IdentityApi, 'getResidentAccounts' | 'listDeletionRequests'>,
    private readonly building: Pick<BuildingApi, 'getSettings'>,
    private readonly pii: () => SecretBox,
    audited: Audited,
  ) {
    this.auditedDetail = this.buildAudited(audited)
  }

  /**
   * E-63. A `q` makes the page the search of §11.1 (at most 20, no cursor); `deletion` and `neverSignedIn` come from `identity`
   * and narrow the page. The list shows the full phone and the masked ID number and never a date of birth, so it writes no `pii.read`.
   */
  async list(
    staff: StaffContext,
    query: ResidentListQuery,
  ): Promise<{ items: ResidentListItem[]; next: string | null; total: number }> {
    requireRole(staff, RESIDENT_READ_ROLES)
    const { scope } = staff
    const total = await this.residents.total(scope)
    const deletions = await this.deletionRequests()
    const restrict = await this.restriction(scope, query, deletions)
    if (restrict !== undefined && restrict.length === 0) return { items: [], next: null, total }

    const filter: ProfileListFilter = {
      unitId: query.unitId,
      memberType: query.memberType,
      status: query.status,
      accountIds: restrict,
    }
    const limit = query.q === undefined ? query.limit : Math.min(query.limit, SEARCH_CAP)
    const after = query.q === undefined ? query.after : undefined
    const { rows, more } = await this.page(
      scope,
      filter,
      after,
      limit,
      query.neverSignedIn === true,
    )
    const items = await this.items(
      scope,
      rows.map((r) => r.row),
      deletions,
    )
    return { items, next: more ? (rows.at(-1)?.row.accountId ?? null) : null, total }
  }

  /**
   * E-65: the profile with the full ID number and date of birth. The audit row `pii.read` is written in the same transaction as the
   * read, so a failed insert answers 500 and returns no data (DOC-35 §6).
   */
  async get(staff: StaffContext, accountId: string): Promise<ResidentDetail> {
    requireRole(staff, RESIDENT_READ_ROLES)
    return this.uow.run(() => this.auditedDetail(staff, accountId))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'pii.read',
        object: (detail: ResidentDetail) => ({ type: 'resident_profile', id: detail.accountId }),
        details: () => ({ view: 'detail', fields: ['cccd', 'dateOfBirth'] }),
      },
      async (staff: StaffContext, accountId: string) => ({
        result: await this.read(staff, accountId),
        changes: [],
      }),
    )
  }

  private async read(staff: StaffContext, accountId: string): Promise<ResidentDetail> {
    const { scope } = staff
    const profile = await this.residents.detail(scope, accountId)
    if (!profile) throw new NotFoundError()
    const [account] = await this.identity.getResidentAccounts([accountId])
    if (!account || account.status === 'deleted') throw new NotFoundError()
    const [memberships, deletions, settings] = await Promise.all([
      this.residents.membershipsOf(scope, [accountId]),
      this.deletionRequests(),
      this.building.getSettings(staff.buildingId),
    ])
    const deletion = deletions.get(accountId) ?? NO_DELETION
    const cccd =
      profile.cccdEnc === null
        ? null
        : await this.pii().open(cccdAad(staff.buildingId, accountId), profile.cccdEnc)
    return {
      accountId,
      phone: account.phone,
      accountStatus: account.status,
      profile: {
        fullName: profile.fullName,
        email: profile.email,
        cccd,
        dateOfBirth: profile.dateOfBirth,
        note: profile.note,
        version: profile.version,
      },
      memberships: memberships.map((m) => ({
        membershipId: m.membershipId,
        unitId: m.unitId,
        unitCode: m.unitCode,
        memberType: m.memberType,
        status: m.status,
        startedAt: m.startedAt.toISOString(),
      })),
      deletion: {
        ...deletion,
        executeAfter:
          deletion.approvedAt === null
            ? null
            : new Date(
                Date.parse(deletion.approvedAt) + settings.accountDeletionDays * 86_400_000,
              ).toISOString(),
      },
    }
  }

  /** The accounts the page is restricted to, from the search and the deletion requests; `undefined` is no restriction. */
  private async restriction(
    scope: BuildingScope,
    query: ResidentListQuery,
    deletions: Map<string, Deletion>,
  ): Promise<string[] | undefined> {
    let ids: string[] | undefined
    if (query.q !== undefined)
      ids = (await this.lookups.findResidents(scope, query.q, SEARCH_CAP)).map((r) => r.accountId)
    if (query.deletion === 'requested') {
      const asked = [...deletions.keys()]
      ids = ids === undefined ? asked : ids.filter((id) => asked.includes(id))
    }
    return ids
  }

  /**
   * One page of profiles. `neverSignedIn` is the account's `last_app_open_at`, which only `identity` knows, so the page is filled
   * by reading further chunks until `limit` people qualify or the building is read out.
   */
  private async page(
    scope: BuildingScope,
    filter: ProfileListFilter,
    after: string | undefined,
    limit: number,
    neverSignedIn: boolean,
  ): Promise<{ rows: Array<{ row: ProfileRow }>; more: boolean }> {
    if (!neverSignedIn) {
      const rows = await this.residents.list(scope, filter, after, limit + 1)
      return { rows: rows.slice(0, limit).map((row) => ({ row })), more: rows.length > limit }
    }
    const chunk = Math.max(limit * 2, 100)
    const kept: Array<{ row: ProfileRow }> = []
    let cursor = after
    for (;;) {
      const rows = await this.residents.list(scope, filter, cursor, chunk)
      if (rows.length === 0) return { rows: kept, more: false }
      const accounts = await this.identity.getResidentAccounts(rows.map((r) => r.accountId))
      const never = new Set(
        accounts.filter((a) => a.lastAppOpenAt === null).map((a) => a.accountId),
      )
      for (const [index, row] of rows.entries()) {
        if (!never.has(row.accountId)) continue
        kept.push({ row })
        if (kept.length === limit)
          return { rows: kept, more: index < rows.length - 1 || rows.length === chunk }
      }
      if (rows.length < chunk) return { rows: kept, more: false }
      cursor = rows[rows.length - 1]?.accountId
    }
  }

  private async items(
    scope: BuildingScope,
    rows: ProfileRow[],
    deletions: Map<string, Deletion>,
  ): Promise<ResidentListItem[]> {
    const ids = rows.map((row) => row.accountId)
    if (ids.length === 0) return []
    const [accounts, memberships] = await Promise.all([
      this.identity.getResidentAccounts(ids),
      this.residents.membershipsOf(scope, ids),
    ])
    const account = new Map(accounts.map((a) => [a.accountId, a]))
    const byAccount = Map.groupBy(memberships, (m: MembershipOfAccount) => m.accountId)
    return rows.flatMap((row) => {
      const found = account.get(row.accountId)
      if (!found || found.status === 'deleted') return []
      return [
        {
          accountId: row.accountId,
          fullName: row.fullName,
          phone: found.phone,
          cccdMasked: maskedCccd(row.cccdLast4),
          accountStatus: found.status,
          lastAppOpenAt: found.lastAppOpenAt,
          memberships: (byAccount.get(row.accountId) ?? []).map((m) => ({
            membershipId: m.membershipId,
            unitId: m.unitId,
            unitCode: m.unitCode,
            memberType: m.memberType,
            status: m.status,
          })),
          deletion: deletions.get(row.accountId) ?? NO_DELETION,
        },
      ]
    })
  }

  /** Every account in `deletion_requested` (DOC-35 §10.2): few, so the keyset pages are read in full. */
  private async deletionRequests(): Promise<Map<string, Deletion>> {
    const found = new Map<string, Deletion>()
    let after: string | undefined
    for (let page = 0; page < DELETION_PAGES; page++) {
      const { items, next }: { items: DeletionRequestDto[]; next: string | null } =
        await this.identity.listDeletionRequests({ after, limit: 500 })
      for (const item of items)
        found.set(item.accountId, { requestedAt: item.requestedAt, approvedAt: item.approvedAt })
      if (next === null) break
      after = next
    }
    return found
  }
}
