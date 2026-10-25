import { NotFoundError, requireRole } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import type { BuildingId, StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffDto } from '../../contracts'
import type { StaffAccountRecord } from '../../domain/staff-account'
import type { StaffAccountRepository, StaffSearch } from '../../domain/staff-account-repository'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import { toStaffDto } from '../staff-dto'
import { type StaffMeView, toStaffMeView } from '../staff-me-view'

/** Every staff role reads its own profile (DOC-26 §7). The route reads this list for its `audience`. */
export const GET_STAFF_ME_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

/** A Manager reads the whole list, read only (DR-147). The routes read this list for their `audience`. */
export const LIST_STAFF_ACCOUNTS_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]
export const GET_STAFF_ACCOUNT_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** The page of E-39: `page` from 1, `pageSize` 1…50. */
export interface StaffAccountPage {
  items: StaffAccountView[]
  page: number
  pageSize: number
  total: number
}

const DEFAULT_PAGE = 100
const MAX_PAGE = 500

/** The reads of staff accounts: the profile behind `GET /staff/me` and the two calls of `IdentityApi` (DOC-09 §7.3). */
export class StaffQueries {
  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly files: Pick<FilesApi, 'signedUrl'>,
  ) {}

  /** E-30: the row of this request, not the token's claims (DOC-26 §3.1); `role` and `status` are current. */
  async me(staff: StaffContext): Promise<StaffMeView> {
    requireRole(staff, GET_STAFF_ME_ROLES)
    const record = await this.staffAccounts.findById(staff.staffId)
    if (!record) throw new NotFoundError()
    return this.meView(record)
  }

  /** The thumbnail of the avatar when it exists (DOC-37 §8); a deleted or unknown file gives no URL. */
  async meView(record: StaffAccountRecord): Promise<StaffMeView> {
    const url = record.avatarKey
      ? await this.files.signedUrl(record.avatarKey, { variant: 'thumb' })
      : null
    return toStaffMeView(record, url)
  }

  async list(
    staff: StaffContext,
    query: StaffSearch & { page: number; pageSize: number },
  ): Promise<StaffAccountPage> {
    requireRole(staff, LIST_STAFF_ACCOUNTS_ROLES)
    const { page, pageSize, ...filter } = query
    const { rows, total } = await this.staffAccounts.search(
      staff.scope,
      filter,
      (page - 1) * pageSize,
      pageSize,
    )
    return { items: rows.map(toStaffAccountView), page, pageSize, total }
  }

  /** An id of another building is 404, never 403 (DOC-12 §7). */
  async get(staff: StaffContext, id: string): Promise<StaffAccountView> {
    requireRole(staff, GET_STAFF_ACCOUNT_ROLES)
    const record = await this.staffAccounts.findScoped(staff.scope, id)
    if (!record) throw new NotFoundError()
    return toStaffAccountView(record)
  }

  async getStaff(ids: readonly string[]): Promise<StaffDto[]> {
    return (await this.staffAccounts.findByIds(ids)).map(toStaffDto)
  }

  async listActive(
    buildingId: string,
    roles: readonly StaffRole[],
    page: { after?: string; limit?: number } = {},
  ): Promise<{ items: StaffDto[]; next: string | null }> {
    const limit = Math.min(page.limit ?? DEFAULT_PAGE, MAX_PAGE)
    const scope = { buildingId: buildingId as BuildingId }
    const rows = await this.staffAccounts.listActive(scope, roles, page.after, limit)
    const items = rows.slice(0, limit).map(toStaffDto)
    return { items, next: rows.length > limit ? (items.at(-1)?.staffId ?? null) : null }
  }
}
