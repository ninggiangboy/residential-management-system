import { type FileActor, SYSTEM_ACCOUNT_ID } from '@mod/building/contracts'
import type { BuildingId } from '@rms/shared-types'

/** The caller of `FilesApi` for a job that no staff member started (DOC-37 §3): the receipt PDF handler (DOC-34 §8.2). */
export const systemFileActor = (buildingId: string): FileActor => ({
  accountKind: 'system',
  accountId: SYSTEM_ACCOUNT_ID,
  buildingId,
  scope: { buildingId: buildingId as BuildingId },
})
