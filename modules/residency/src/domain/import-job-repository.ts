import type { BuildingScope } from '@rms/shared-types'
import type { ImportJobRecord, ImportKind, NewImportJob, StoredImportStatus } from './import-job'

export interface ImportJobCursor {
  createdAt: Date
  id: string
}

export interface ImportJobFilter {
  kind: ImportKind
  /** `expired` includes a `validated` job past its `expires_at`; `validated` means not yet expired (E-169). */
  status?: StoredImportStatus
  after?: ImportJobCursor
  limit: number
  now: Date
}

/** The summary of a job without its preview rows: E-169 reads only `result->'counts'`. */
export interface ImportJobSummary extends Omit<ImportJobRecord, 'result'> {
  counts: ImportJobRecord['result']['counts']
}

export interface ImportJobRepository {
  insert(scope: BuildingScope, job: NewImportJob): Promise<void>
  find(scope: BuildingScope, id: string): Promise<ImportJobRecord | null>
  /**
   * The conditional statement of DOC-16 §5.5: `committed` only from `validated` and before `expires_at`; `null` when it did not
   * apply (committed already, expired, failed). It joins the caller's transaction, so a failed commit gives the claim back.
   */
  claim(scope: BuildingScope, id: string, now: Date): Promise<ImportJobRecord | null>
  /** Newest first, keyset on `(created_at, id)`; one row more than `limit` tells the caller there is a next page. */
  list(scope: BuildingScope, filter: ImportJobFilter): Promise<ImportJobSummary[]>
  /** `import_expire`: the `validated` jobs of a building past `expires_at`, as `expired`; returns them for the file removal. */
  expire(scope: BuildingScope, now: Date, limit: number): Promise<ImportJobRecord[]>
  /** `import_purge`: deletes the jobs created before `cutoff` (30 days, DR-62) and returns them for their files. */
  purge(scope: BuildingScope, cutoff: Date, limit: number): Promise<ImportJobRecord[]>
}
