import { InvariantError } from '@core/kernel'
import type { CAPABILITIES, MemberType } from '@rms/shared-types'
import {
  type ActiveMembershipDto,
  can,
  type MembershipDto,
  type NoticeRecipientDto,
  type Page,
  type PageRequest,
  type RecipientDto,
  type ScanMembershipDto,
  type UnitContext,
  type UnitDto,
} from '../../contracts'
import type {
  MembershipReader,
  MembershipView,
  RecipientFilter,
} from '../../domain/membership-reader'

/** A resident has a handful of memberships: more than this is a data defect, and the call says so instead of truncating (DOC-27 §2.1). */
const MAX_MEMBERSHIPS = 500
const DEFAULT_PAGE = 100
const MAX_PAGE = 500
const MEMBER_TYPES: readonly MemberType[] = ['owner', 'family', 'tenant', 'helper']

type Capability = (typeof CAPABILITIES)[number]

/** A context that holds only what the policy table reads; the table is the single place that says who may do what. */
const probe = (memberType: MemberType, canPay: boolean) => ({ memberType, canPay }) as UnitContext

/** The types that hold a capability always, and those that hold it only with `can_pay` (DOC-27 §3.2). */
export function recipientFilter(capability: Capability): RecipientFilter {
  const always = MEMBER_TYPES.filter((type) => can(probe(type, false), capability))
  const whenCanPay = MEMBER_TYPES.filter(
    (type) => !always.includes(type) && can(probe(type, true), capability),
  )
  return { always, whenCanPay }
}

const toDto = (row: MembershipView): MembershipDto => {
  if (row.status === 'removed') throw new InvariantError('a removed membership reached the guard')
  return {
    membershipId: row.id,
    buildingId: row.buildingId,
    unitId: row.unitId,
    accountId: row.accountId,
    memberType: row.memberType,
    canPay: row.canPay,
    status: row.status,
    startedAt: row.createdAt.toISOString(),
  }
}

const pageLimit = (limit: number | undefined) =>
  Math.min(Math.max(limit ?? DEFAULT_PAGE, 1), MAX_PAGE)

/** The reads of `ResidencyApi` (DOC-27 §2.1, DOC-09 §7.2): no state change, no transaction, no rule of its own beyond the policy table. */
export class MembershipQueries {
  constructor(private readonly reader: MembershipReader) {}

  async membership(accountId: string, unitId: string): Promise<MembershipDto | null> {
    const row = await this.reader.findByAccountAndUnit(accountId, unitId)
    return row ? toDto(row) : null
  }

  async recipients(
    unitId: string,
    capability: Capability,
    page: PageRequest = {},
  ): Promise<Page<RecipientDto>> {
    const limit = pageLimit(page.limit)
    const rows = await this.reader.listRecipients(
      unitId,
      recipientFilter(capability),
      page.after ?? null,
      limit + 1,
    )
    const items = rows.slice(0, limit)
    return { items, next: rows.length > limit ? (items.at(-1)?.membershipId ?? null) : null }
  }

  async noticeRecipients(
    buildingId: string,
    cursor: string | null,
    limit: number,
  ): Promise<Page<NoticeRecipientDto>> {
    const size = pageLimit(limit)
    const accounts = await this.reader.listNoticeAccounts(buildingId, cursor, size + 1)
    const items = accounts.slice(0, size).map((accountId) => ({ accountId }))
    return { items, next: accounts.length > size ? (items.at(-1)?.accountId ?? null) : null }
  }

  async activeUnitIds(accountId: string): Promise<string[]> {
    const ids = await this.reader.activeUnitIds(accountId, MAX_MEMBERSHIPS + 1)
    if (ids.length > MAX_MEMBERSHIPS)
      throw new InvariantError('an account has more than 500 memberships')
    return ids
  }

  async units(ids: string[]): Promise<UnitDto[]> {
    if (ids.length > MAX_PAGE) throw new InvariantError('getUnits takes at most 500 ids')
    return (await this.reader.findUnits(ids)).map((row) => ({
      unitId: row.id,
      code: row.code,
      floor: row.floor,
      occupancy: row.occupancy,
    }))
  }

  async forScan(membershipId: string): Promise<ScanMembershipDto | null> {
    const row = await this.reader.findById(membershipId)
    return row
      ? {
          membershipId: row.id,
          buildingId: row.buildingId,
          unitId: row.unitId,
          accountId: row.accountId,
          memberType: row.memberType,
          status: row.status,
          credentialVersion: row.credentialVersion,
        }
      : null
  }

  ownedUnitIds(accountId: string): Promise<string[]> {
    return this.reader.ownedUnitIds(accountId)
  }

  async listActive(accountId: string): Promise<ActiveMembershipDto[]> {
    const rows = await this.reader.listActive(accountId, MAX_MEMBERSHIPS + 1)
    if (rows.length > MAX_MEMBERSHIPS)
      throw new InvariantError('an account has more than 500 memberships')
    return rows.map((row) => ({ ...row }))
  }

  async buildingIdsOfAccounts(
    accountIds: string[],
  ): Promise<Array<{ accountId: string; buildingId: string }>> {
    if (accountIds.length > MAX_PAGE) throw new InvariantError('at most 500 accounts per call')
    return this.reader.buildingIdsOfAccounts(accountIds)
  }
}
