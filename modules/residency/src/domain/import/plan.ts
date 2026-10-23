import type { Occupancy } from '../../contracts'
import type { UnitOwnerColumn } from './columns'
import { foldKey } from './folding'
import {
  type ImportCounts,
  type ImportIssue,
  type ImportPreview,
  MAX_ISSUES,
  MAX_PREVIEW_ROWS,
  type OwnerCells,
  type ParsedRow,
  type PreviewNote,
  type PreviewRow,
} from './types'

/** The set layer: DQ-30 and DQ-31, across the rows of the file, in memory. The first row stands, later ones are rejected. */
export function checkSet(rows: readonly ParsedRow[]): {
  survivors: ParsedRow[]
  issues: ImportIssue[]
} {
  const codes = new Map<string, number>()
  const phones = new Map<string, { nameKey: string; row: number }>()
  const issues: ImportIssue[] = []
  const survivors: ParsedRow[] = []
  for (const parsed of rows) {
    const rejected = parsed.issues.some((issue) => issue.severity === 'error')
    let duplicate = false
    if (parsed.unitCode !== null) {
      const first = codes.get(parsed.unitCode)
      if (first === undefined) codes.set(parsed.unitCode, parsed.row)
      else {
        duplicate = true
        issues.push({
          row: parsed.row,
          unitCode: parsed.unitCode,
          column: 'unit_code',
          severity: 'error',
          code: 'unit_code_duplicate',
          params: { code: parsed.unitCode, firstRow: first },
        })
      }
    }
    let conflict = false
    if (parsed.owner && !duplicate) {
      const nameKey = foldKey(parsed.owner.name)
      const first = phones.get(parsed.owner.phone)
      if (first === undefined) phones.set(parsed.owner.phone, { nameKey, row: parsed.row })
      else if (first.nameKey !== nameKey) {
        conflict = true
        issues.push({
          row: parsed.row,
          unitCode: parsed.unitCode,
          column: 'owner_phone',
          severity: 'error',
          code: 'phone_conflict',
          params: { firstRow: first.row },
        })
      }
    }
    if (!rejected && !duplicate && !conflict) survivors.push(parsed)
  }
  return { survivors, issues }
}

/** What the `db` layer needs to know about a unit of the file (Q-U, DOC-18 §1.5). */
export interface StoredUnit {
  unitId: string
  code: string
  occupancy: Occupancy
  ownerAccountId: string | null
}

/** What the `db` layer needs to know about a stored profile (Q-P); the ID number only by its last four digits. */
export interface StoredProfile {
  accountId: string
  fullName: string | null
  email: string | null
  cccdLast4: string | null
  dateOfBirth: string | null
}

export interface Lookups {
  /** By lower-case code. */
  units: ReadonlyMap<string, StoredUnit>
  /** By E.164 number. */
  accounts: ReadonlyMap<string, { accountId: string }>
  /** `<unitId>|<accountId>` of the non-removed, non-owner memberships (Q-M). */
  members: ReadonlySet<string>
  profiles: ReadonlyMap<string, StoredProfile>
}

/** A valid row, with what the commit needs to write it. */
export interface PlannedRow {
  parsed: ParsedRow
  /** The stored unit; `null` when the row creates it. */
  unit: StoredUnit | null
  owner: (OwnerCells & { accountId: string | null; action: 'add' | 'unchanged' }) | null
}

export interface ImportPlan {
  preview: ImportPreview
  rows: PlannedRow[]
}

/** The profile fields a file value may differ on (DQ-46), as the column the Manager sees. */
const differingFields = (owner: OwnerCells, stored: StoredProfile): UnitOwnerColumn[] => {
  const fields: UnitOwnerColumn[] = []
  if (stored.fullName && foldKey(owner.name) !== foldKey(stored.fullName)) fields.push('owner_name')
  if (owner.email && stored.email && owner.email !== stored.email.toLowerCase())
    fields.push('owner_email')
  if (owner.dateOfBirth && stored.dateOfBirth && owner.dateOfBirth !== stored.dateOfBirth)
    fields.push('owner_dob')
  if (owner.idNumber && stored.cccdLast4 && owner.idNumber.slice(-4) !== stored.cccdLast4)
    fields.push('owner_id_number')
  return fields
}

const maskedId = (idNumber: string | null) => (idNumber ? `•••• ${idNumber.slice(-4)}` : null)

/**
 * The `db` layer and the classification of DOC-18 §1.5, on the rows that passed the row and set layers, then the preview of
 * §1.4. `rowIssues` are the findings of the earlier layers; `unknownColumns` become one warning each on row 1 (DQ-06).
 */
export function classify(input: {
  rowCount: number
  survivors: readonly ParsedRow[]
  earlierIssues: readonly ImportIssue[]
  lookups: Lookups
}): ImportPlan {
  const { survivors, lookups } = input
  const issues: ImportIssue[] = [...input.earlierIssues]
  const planned: PlannedRow[] = []
  const notes = new Map<number, PreviewNote[]>()
  const createPhones = new Set<string>()
  const linkedPhones = new Set<string>()
  let unitsToCreate = 0
  let unitsToUpdate = 0
  let ownersToAdd = 0
  let ownersUnchanged = 0

  for (const parsed of survivors) {
    const code = parsed.unitCode as string
    const rowNotes: PreviewNote[] = []
    const rowIssues: ImportIssue[] = []
    const reject = (column: UnitOwnerColumn, issueCode: string) =>
      issues.push({
        row: parsed.row,
        unitCode: code,
        column,
        severity: 'error',
        code: issueCode,
        params: { code },
      })

    const unit = lookups.units.get(code.toLowerCase()) ?? null
    rowNotes.push({ code: unit ? 'unit_will_update' : 'unit_will_create', params: { code } })

    let owner: PlannedRow['owner'] = null
    if (parsed.owner) {
      const account = lookups.accounts.get(parsed.owner.phone) ?? null
      rowNotes.push({
        code: account ? 'account_linked' : 'account_will_be_created',
        params: {},
      })
      let action: 'add' | 'unchanged' | null = null
      if (unit?.ownerAccountId != null) {
        if (account && unit.ownerAccountId === account.accountId) action = 'unchanged'
        else {
          reject('owner_phone', 'owner_conflict')
          continue
        }
      } else if (unit && account && lookups.members.has(`${unit.unitId}|${account.accountId}`)) {
        reject('owner_phone', 'owner_is_member')
        continue
      } else action = 'add'

      const stored = account ? lookups.profiles.get(account.accountId) : undefined
      if (stored)
        for (const field of differingFields(parsed.owner, stored))
          rowIssues.push({
            row: parsed.row,
            unitCode: code,
            column: field,
            severity: 'warning',
            code: 'profile_field_differs',
            params: { field },
          })
      owner = { ...parsed.owner, accountId: account?.accountId ?? null, action }
      if (action === 'add') ownersToAdd++
      else ownersUnchanged++
      ;(account ? linkedPhones : createPhones).add(parsed.owner.phone)
    }
    if (unit) unitsToUpdate++
    else unitsToCreate++
    issues.push(...rowIssues)
    notes.set(parsed.row, rowNotes)
    planned.push({ parsed, unit, owner })
  }

  // Warnings of the row layer belong to accepted rows only: a rejected row's warnings are noise.
  const acceptedRows = new Set(planned.map((row) => row.parsed.row))
  const kept = issues.filter(
    (issue) => issue.severity !== 'warning' || issue.row === 1 || acceptedRows.has(issue.row),
  )
  const errorRows = new Set(kept.filter((issue) => issue.severity === 'error').map((i) => i.row))
  const ordered = [
    ...kept.filter((issue) => issue.severity === 'fail'),
    ...kept.filter((issue) => issue.severity === 'error').sort((a, b) => a.row - b.row),
    ...kept.filter((issue) => issue.severity === 'warning').sort((a, b) => a.row - b.row),
  ]
  const counts: ImportCounts = {
    rows: input.rowCount,
    valid: planned.length,
    errors: errorRows.size,
    warnings: kept.filter((issue) => issue.severity === 'warning').length,
    unitsToCreate,
    unitsToUpdate,
    accountsToCreate: createPhones.size,
    accountsLinked: linkedPhones.size,
    ownersToAdd,
    ownersUnchanged,
  }
  const validRows: PreviewRow[] = planned.slice(0, MAX_PREVIEW_ROWS).map(({ parsed, owner }) => ({
    row: parsed.row,
    unitCode: parsed.unitCode,
    ownerName: owner?.name ?? null,
    ownerPhone: owner?.phone ?? null,
    ownerIdNumber: maskedId(owner?.idNumber ?? null),
    notes: notes.get(parsed.row) ?? [],
  }))
  return {
    rows: planned,
    preview: {
      counts,
      validRows,
      issues: ordered.slice(0, MAX_ISSUES),
      issuesTruncated: ordered.length > MAX_ISSUES,
    },
  }
}

/** The counts of a file that could not be read (DQ-01…DQ-04): all zero. */
export const EMPTY_COUNTS: ImportCounts = {
  rows: 0,
  valid: 0,
  errors: 0,
  warnings: 0,
  unitsToCreate: 0,
  unitsToUpdate: 0,
  accountsToCreate: 0,
  accountsLinked: 0,
  ownersToAdd: 0,
  ownersUnchanged: 0,
}

/** DQ-50: the commit finds the preview's counts unchanged. */
export const sameCounts = (a: ImportCounts, b: ImportCounts): boolean =>
  (Object.keys(EMPTY_COUNTS) as (keyof ImportCounts)[]).every((key) => a[key] === b[key])
