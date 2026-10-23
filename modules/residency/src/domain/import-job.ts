import type { ImportCounts, ImportPreview } from './import/types'

export type ImportKind = 'unit_owner'
export type StoredImportStatus = 'validated' | 'failed' | 'committed' | 'expired'

/** A row of `residency.import_job` (DOC-16 §5.5). */
export interface ImportJobRecord {
  id: string
  buildingId: string
  kind: ImportKind
  status: StoredImportStatus
  /** The `file_object.id` of the upload: `FilesApi` keeps the object key private (DR-86), so the id is what a job can hold. */
  fileId: string
  fileName: string | null
  result: ImportPreview
  createdBy: string
  createdAt: Date
  expiresAt: Date
  committedAt: Date | null
}

export type NewImportJob = Omit<ImportJobRecord, 'buildingId' | 'committedAt'>

/** The 24 hours a preview stays valid (DQ-51). */
export const IMPORT_TTL_MS = 24 * 3_600_000

/**
 * The status a reader reports: a `validated` job past `expires_at` is `expired` at once, before the hourly `import_expire` job
 * updates the row (E-73, E-169).
 */
export const statusAt = (job: Pick<ImportJobRecord, 'status' | 'expiresAt'>, now: Date) =>
  job.status === 'validated' && job.expiresAt.getTime() <= now.getTime() ? 'expired' : job.status

/** What a commit wrote, equal to the previewed counts (DQ-60). */
export interface CommittedCounts {
  unitsCreated: number
  unitsUpdated: number
  accountsCreated: number
  accountsLinked: number
  ownersAdded: number
}

export const committedOf = (counts: ImportCounts): CommittedCounts => ({
  unitsCreated: counts.unitsToCreate,
  unitsUpdated: counts.unitsToUpdate,
  accountsCreated: counts.accountsToCreate,
  accountsLinked: counts.accountsLinked,
  ownersAdded: counts.ownersToAdd,
})
