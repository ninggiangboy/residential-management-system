import { type FileActor, SYSTEM_ACCOUNT_ID } from '@mod/building/contracts'
import { scopeOf } from './scope-of'

/** The caller of `FilesApi` for a job that no staff member started (DOC-37 §3). */
export const systemFileActor = (buildingId: string): FileActor => ({
  accountKind: 'system',
  accountId: SYSTEM_ACCOUNT_ID,
  buildingId,
  scope: scopeOf(buildingId),
})
