import type { Occupancy } from '../../contracts'
import type { UnitOwnerColumn } from './columns'

export type Severity = 'fail' | 'error' | 'warning'

/** One finding of a rule: stored as `{code, params}` and rendered in the language of the request (DR-22). */
export interface ImportIssue {
  row: number
  /** The normalised code of the row, `null` when it has none (DR-213). */
  unitCode: string | null
  column: UnitOwnerColumn | null
  severity: Severity
  code: string
  params: Record<string, string | number>
}

/** What a valid row says about an owner, after DQ-15…DQ-23. */
export interface OwnerCells {
  name: string
  /** E.164. */
  phone: string
  email: string | null
  /** 9 or 12 digits. */
  idNumber: string | null
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null
}

/** A row after the row layer: its values normalised, and what the row layer found. */
export interface ParsedRow {
  row: number
  unitCode: string | null
  floor: number | null
  bedrooms: number | null
  /** Two decimals, as the `numeric(8,2)` column takes it. */
  areaM2: string | null
  occupancy: Occupancy | null
  /** `null` when no owner cell is filled: the row changes the unit only. */
  owner: OwnerCells | null
  issues: ImportIssue[]
}

export interface ImportCounts {
  rows: number
  valid: number
  errors: number
  warnings: number
  unitsToCreate: number
  unitsToUpdate: number
  accountsToCreate: number
  accountsLinked: number
  ownersToAdd: number
  ownersUnchanged: number
}

export interface PreviewNote {
  code: string
  params: Record<string, string | number>
}

export interface PreviewRow {
  row: number
  unitCode: string | null
  ownerName: string | null
  ownerPhone: string | null
  /** `•••• 2345`: never the whole number (DR-58). */
  ownerIdNumber: string | null
  notes: PreviewNote[]
}

/** The `result` of the import job: it holds no ID number and no date of birth (DOC-18 §1.4). */
export interface ImportPreview {
  counts: ImportCounts
  validRows: PreviewRow[]
  issues: ImportIssue[]
  issuesTruncated: boolean
}

export const MAX_ROWS = 5000
export const MAX_ISSUES = 500
export const MAX_PREVIEW_ROWS = 50
