import { ForbiddenError } from '@core/kernel'
import type { StaffContext } from '@rms/shared-types'

/** The settings, the gateway and the terms are the Admin's alone (DOC-36 §4, §7, DOC-35 §9). */
export function assertAdmin(staff: StaffContext): void {
  if (staff.role !== 'admin') throw new ForbiddenError()
}
