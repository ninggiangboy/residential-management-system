import type { Money } from '@rms/shared-types'
import { type ChargeLine, chargeTotal } from '../charge-line'
import { foldKey } from './folding'
import type { ParsedFeeRow } from './row-rules'
import {
  type FeeImportCounts,
  type FeeImportIssue,
  type FeeImportPreview,
  type FeePreviewRow,
  MAX_ISSUES,
  MAX_PREVIEW_ROWS,
} from './types'

/** A row that passed the row layer: its code key and line are set. */
export type FeeRow = ParsedFeeRow & { readonly codeKey: string; readonly line: ChargeLine }

const isFeeRow = (row: ParsedFeeRow): row is FeeRow => row.codeKey !== null && row.line !== null

const setIssue = (
  row: FeeRow,
  column: FeeImportIssue['column'],
  code: string,
  params: FeeImportIssue['params'],
): FeeImportIssue => ({
  row: row.row,
  unitCode: row.unitCode,
  column,
  severity: 'error',
  code,
  params,
})

function groupByUnit(rows: readonly FeeRow[]): Map<string, FeeRow[]> {
  const units = new Map<string, FeeRow[]>()
  for (const row of rows) {
    const list = units.get(row.codeKey)
    if (list) list.push(row)
    else units.set(row.codeKey, [row])
  }
  return units
}

/**
 * The set layer (DOC-18 §2.2): DQ-75, the first row of a unit and item stands and later ones are rejected (the key folds case,
 * marks and spaces); then DQ-76 on the valid lines of each unit, whose total must stay above zero, or every row of it is rejected.
 */
export function checkFeeSet(rows: readonly ParsedFeeRow[]): {
  survivors: FeeRow[]
  issues: FeeImportIssue[]
} {
  const issues: FeeImportIssue[] = []
  const firstRowOf = new Map<string, number>()
  const unique: FeeRow[] = []
  for (const row of rows.filter(isFeeRow)) {
    const key = `${row.codeKey}\u0000${foldKey(row.line.itemName.vi)}`
    const first = firstRowOf.get(key)
    if (first === undefined) {
      firstRowOf.set(key, row.row)
      unique.push(row)
    } else
      issues.push(
        setIssue(row, 'item_name', 'charge_item_duplicate', {
          item: row.line.itemName.vi,
          firstRow: first,
        }),
      )
  }
  const refused = new Set<string>()
  for (const [codeKey, lines] of groupByUnit(unique)) {
    const total = chargeTotal(lines.map((row) => row.line))
    if (total > 0n) continue
    refused.add(codeKey)
    const code = lines[0]?.unitCode ?? codeKey
    for (const row of lines)
      issues.push(setIssue(row, 'amount', 'charge_total_zero', { code, total: Number(total) }))
  }
  return { survivors: unique.filter((row) => !refused.has(row.codeKey)), issues }
}

/** What the `db` layer learns of a unit from `ResidencyApi.findUnitsByCodes` (DOC-21 §2.1). */
export interface KnownUnit {
  readonly unitId: string
  readonly code: string
  readonly hasActiveOwner: boolean
}

/** One charge the commit writes: the unit's own code, the sum of its lines, positions 1… in file order (DOC-21 §4.5 step 4). */
export interface PlannedCharge {
  readonly unitId: string
  readonly unitCode: string
  readonly amount: Money
  readonly lines: readonly ChargeLine[]
}

export interface FeeImportPlan {
  readonly charges: readonly PlannedCharge[]
  readonly preview: FeeImportPreview
}

/** `1000n` → `1`, `12345n` → `12.345`, `2500n` → `2.5`. */
const quantityShown = (milli: bigint): string => {
  const fraction = (milli % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction === '' ? `${milli / 1000n}` : `${milli / 1000n}.${fraction}`
}

const previewRow = (row: FeeRow, unit: KnownUnit): FeePreviewRow => ({
  row: row.row,
  unitCode: unit.code,
  itemName: row.line.itemName.vi,
  ...(row.line.itemName.en ? { itemNameEn: row.line.itemName.en } : {}),
  kind: row.line.kind,
  quantity: quantityShown(row.line.quantityMilli),
  unitPrice: Number(row.line.unitPrice),
  amount: Number(row.line.amount),
})

/** DQ-77 and DQ-78 on one row: no entry is `unit_not_found`, an entry without an active owner `unit_without_owner`. */
function unitIssue(row: FeeRow, unit: KnownUnit | undefined): FeeImportIssue | null {
  const params = { code: row.unitCode ?? row.codeKey }
  if (!unit) return setIssue(row, 'unit_code', 'unit_not_found', params)
  return unit.hasActiveOwner ? null : setIssue(row, 'unit_code', 'unit_without_owner', params)
}

/**
 * The `db` layer and the preview (DOC-21 §4.3, §4.4): the rows the file, row and set layers kept, the units of the one contract
 * call, and the charges the commit would write. Issues come failures first, then errors by row, then warnings; the counts are
 * complete whatever the lists hold.
 */
export function planFeeImport(input: {
  rowCount: number
  survivors: readonly FeeRow[]
  earlierIssues: readonly FeeImportIssue[]
  units: ReadonlyMap<string, KnownUnit>
}): FeeImportPlan {
  const issues = [...input.earlierIssues]
  const accepted: { row: FeeRow; unit: KnownUnit }[] = []
  for (const row of input.survivors) {
    const unit = input.units.get(row.codeKey)
    const issue = unitIssue(row, unit)
    if (issue) issues.push(issue)
    else if (unit) accepted.push({ row, unit })
  }
  const byUnit = new Map<string, { unit: KnownUnit; lines: ChargeLine[] }>()
  for (const { row, unit } of accepted) {
    const entry = byUnit.get(unit.unitId)
    if (entry) entry.lines.push(row.line)
    else byUnit.set(unit.unitId, { unit, lines: [row.line] })
  }
  const charges = [...byUnit.values()].map(({ unit, lines }) => ({
    unitId: unit.unitId,
    unitCode: unit.code,
    amount: chargeTotal(lines),
    lines,
  }))
  const bySeverity = (severity: FeeImportIssue['severity']) =>
    issues.filter((issue) => issue.severity === severity).sort((a, b) => a.row - b.row)
  const ordered = [...bySeverity('fail'), ...bySeverity('error'), ...bySeverity('warning')]
  const counts: FeeImportCounts = {
    rows: input.rowCount,
    valid: accepted.length,
    errors: new Set(bySeverity('error').map((issue) => issue.row)).size,
    warnings: bySeverity('warning').length,
    charges: charges.length,
    lines: accepted.length,
    totalAmount: Number(chargeTotal(charges)),
  }
  return {
    charges,
    preview: {
      counts,
      validRows: accepted.slice(0, MAX_PREVIEW_ROWS).map(({ row, unit }) => previewRow(row, unit)),
      issues: ordered.slice(0, MAX_ISSUES),
      issuesTruncated: ordered.length > MAX_ISSUES,
    },
  }
}

/** The counts of a file that could not be read: all zero (DOC-18 §1.4). */
export const EMPTY_FEE_COUNTS: FeeImportCounts = {
  rows: 0,
  valid: 0,
  errors: 0,
  warnings: 0,
  charges: 0,
  lines: 0,
  totalAmount: 0,
}

/** DQ-50 for a fee file: the commit finds every previewed count unchanged (DOC-21 §4.5). */
export const sameFeeCounts = (a: FeeImportCounts, b: FeeImportCounts): boolean =>
  (Object.keys(EMPTY_FEE_COUNTS) as (keyof FeeImportCounts)[]).every((key) => a[key] === b[key])
