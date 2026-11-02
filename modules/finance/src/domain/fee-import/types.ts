import type { ChargeLineKind } from '../charge-line'
import type { FeeColumn } from './columns'

export type Severity = 'fail' | 'error' | 'warning'

/** One finding of a rule, stored as `{code, params}` and rendered in the language of the request (DR-22, DOC-21 §4.4). */
export interface FeeImportIssue {
  readonly row: number
  /** The trimmed code of the row, `null` when the cell is blank. */
  readonly unitCode: string | null
  readonly column: FeeColumn | null
  readonly severity: Severity
  readonly code: string
  readonly params: Readonly<Record<string, string | number>>
}

/** Complete whatever the lists hold (DOC-21 §4.4): `charges` is the number of units that will get a charge. */
export interface FeeImportCounts {
  readonly rows: number
  readonly valid: number
  readonly errors: number
  readonly warnings: number
  readonly charges: number
  readonly lines: number
  readonly totalAmount: number
}

/** A valid row as the preview lists it: a fee file holds no personal data, so the row is listed whole (DOC-15 §10.1). */
export interface FeePreviewRow {
  readonly row: number
  readonly unitCode: string
  readonly itemName: string
  readonly itemNameEn?: string
  readonly kind: ChargeLineKind
  /** `1`, `12.345`, `2.5`: the quantity without trailing zeros. */
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
}

/** What a commit wrote: the answer of E-74, and of every later "Save" of the same job (DOC-21 §4.1, §4.5). */
export interface FeeImportCommitted {
  readonly created: number
  readonly replaced: number
}

/** The `result` of `finance.import_job` and the response of E-72 (DOC-21 §4.4); `committed` is added by the commit. */
export interface FeeImportPreview {
  readonly counts: FeeImportCounts
  readonly validRows: readonly FeePreviewRow[]
  readonly issues: readonly FeeImportIssue[]
  readonly issuesTruncated: boolean
  readonly committed?: FeeImportCommitted
}

/** DR-21: 5,000 rows, 500 listed issues, 50 listed valid rows; code constants, a change is a DR (DOC-21 §6). */
export const MAX_ROWS = 5000
export const MAX_ISSUES = 500
export const MAX_PREVIEW_ROWS = 50
