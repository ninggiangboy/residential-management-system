import type { Language, StaffContext } from '@rms/shared-types'

/**
 * The imports of another module behind the one set of routes `/staff/imports` (E-71…E-74, E-169), dispatched by `kind` (DR-149):
 * `residency` owns the routes and the `unit_owner` kind, a module that owns another kind hands a handler to the host, which gives
 * it to `residency`. The answers are the bodies of the routes, plain JSON with ISO dates, the texts already in the request
 * language: the kind knows its columns and codes, the routes do not.
 */
export type ImportJobStatus = 'validated' | 'failed' | 'committed' | 'expired'

export interface ImportIssueBody {
  row: number
  unitCode: string | null
  column: string | null
  severity: 'fail' | 'error' | 'warning'
  code: string
  params: Record<string, string | number>
  /** `{code, params}` rendered in the request language (DR-22). */
  message: string
}

/** E-72 and E-73: one job and its preview. */
export interface ImportJobBody {
  importId: string
  kind: ImportHandler['kind']
  status: ImportJobStatus
  fileName: string | null
  createdAt: string
  expiresAt: string
  committedAt: string | null
  /** What the commit wrote, the same answer for every later "Save"; `null` before the commit. */
  committed: Record<string, number> | null
  /** The extra parameters the job was created with, e.g. `{batchId}` for `fee_batch`. */
  params: Record<string, string>
  preview: {
    counts: Record<string, number>
    validRows: ReadonlyArray<Record<string, unknown>>
    issues: ImportIssueBody[]
    issuesTruncated: boolean
  }
}

/** E-74. */
export interface ImportCommitBody {
  importId: string
  status: 'committed'
  committedAt: string | null
  committed: Record<string, number>
}

/** One row of E-169; `residency` adds the creator's name. */
export interface ImportListRow {
  importId: string
  kind: ImportHandler['kind']
  status: ImportJobStatus
  fileName: string | null
  counts: { rows: number; valid: number; errors: number; warnings: number }
  createdBy: string
  createdAt: string
  expiresAt: string
  committedAt: string | null
}

export interface ImportListCursor {
  createdAt: Date
  id: string
}

export interface ImportHandler {
  readonly kind: 'fee_batch'
  /** E-71: the template workbook and the name of the download. */
  template(
    staff: StaffContext,
    language: Language,
  ): Promise<{ bytes: Uint8Array; fileName: string }>
  /** E-72: validates the upload and stores the preview; `params` as the body carried it. */
  validate(
    staff: StaffContext,
    input: { fileId: string; fileName?: string; params: Record<string, string> },
    language: Language,
  ): Promise<ImportJobBody>
  /** E-73: `null` when the id is no job of this kind in the caller's building. */
  get(staff: StaffContext, id: string, language: Language): Promise<ImportJobBody | null>
  /** E-74: `null` when the id is no job of this kind in the caller's building. */
  commit(staff: StaffContext, id: string): Promise<ImportCommitBody | null>
  /** E-169: newest first; one page and the cursor of the next. */
  list(
    staff: StaffContext,
    query: { status?: ImportJobStatus; after?: ImportListCursor; limit: number },
  ): Promise<{ items: ImportListRow[]; next: ImportListCursor | null }>
}
