import { NotFoundError, requireRole } from '@core/kernel'
import type { BuildingId, StaffContext, StaffRole } from '@rms/shared-types'
import type { StaffDto } from '../../contracts'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffProfile, toStaffDto, toStaffProfile } from '../staff-dto'

/** Every staff role reads its own profile (DOC-26 §7). The route reads this list for its `audience`. */
export const GET_STAFF_ME_ROLES = [
  'admin',
  'manager',
  'technician',
  'guard',
] as const satisfies readonly StaffRole[]

const DEFAULT_PAGE = 100
const MAX_PAGE = 500

/** The reads of staff accounts: the profile behind `GET /staff/me` and the two calls of `IdentityApi` (DOC-09 §7.3). */
export class StaffQueries {
  constructor(private readonly staffAccounts: StaffAccountRepository) {}

  async me(staff: StaffContext): Promise<StaffProfile> {
    requireRole(staff, GET_STAFF_ME_ROLES)
    const record = await this.staffAccounts.findById(staff.staffId)
    if (!record) throw new NotFoundError()
    return toStaffProfile(record)
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
