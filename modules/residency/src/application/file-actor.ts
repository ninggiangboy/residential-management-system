import type { FileActor } from '@mod/building/contracts'
import type { StaffContext } from '@rms/shared-types'

/** The caller of `FilesApi` as a staff member (DOC-37 §3). */
export const fileActorOf = (staff: StaffContext): FileActor => ({
  accountKind: 'staff',
  accountId: staff.staffId,
  buildingId: staff.buildingId,
  scope: staff.scope,
  role: staff.role,
})
