import { requireRole } from '@core/kernel'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { UnitTypeStatus } from '../../domain/unit-type'
import type { UnitTypeReader } from '../../domain/unit-type-reader'
import { unitTypeBody } from '../unit-type-body'

/** The Manager's and the Admin's alone (DOC-27 §4.3). The routes read the same list for their guard and audience. */
export const UNIT_TYPE_READ_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/** The reads of E-180 (DOC-27 §4.3 rule 8): the types with their unit counts and the summary of the building. */
export class UnitTypeQueries {
  constructor(private readonly reader: UnitTypeReader) {}

  async list(staff: StaffContext, status: UnitTypeStatus | undefined) {
    requireRole(staff, UNIT_TYPE_READ_ROLES)
    const { scope } = staff
    const [rows, byStatus, withoutType] = await Promise.all([
      this.reader.list(scope, status),
      this.reader.countByStatus(scope),
      this.reader.countWithoutType(scope),
    ])
    return {
      items: rows.map((row) => unitTypeBody(row.unitType, row.unitCount)),
      summary: {
        total: byStatus.active + byStatus.archived,
        active: byStatus.active,
        archived: byStatus.archived,
        withoutType,
      },
    }
  }
}
