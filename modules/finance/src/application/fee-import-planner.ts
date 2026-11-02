import type { BuildingScope, LocalDate } from '@rms/shared-types'
import {
  checkFeeSet,
  EMPTY_FEE_COUNTS,
  type FeeImportPlan,
  type FeeRow,
  planFeeImport,
} from '../domain/fee-import/plan'
import { parseFeeRow } from '../domain/fee-import/row-rules'
import { readFeeSheet } from '../domain/fee-import/sheet'
import type { FeeImportIssue, FeeImportPreview } from '../domain/fee-import/types'
import type { UnitDirectory, WorkbookReader } from './ports'

/** The file, read and checked by the file, row and set layers: nothing here touches the database. */
export type FeeImportRead =
  | { readonly kind: 'too_many_rows' }
  | { readonly kind: 'failed'; readonly preview: FeeImportPreview }
  | {
      readonly kind: 'read'
      readonly rowCount: number
      readonly survivors: readonly FeeRow[]
      readonly issues: readonly FeeImportIssue[]
    }

const failed = (code: string, params: Record<string, string> = {}): FeeImportRead => ({
  kind: 'failed',
  preview: {
    counts: { ...EMPTY_FEE_COUNTS },
    validRows: [],
    issues: [{ row: 1, unitCode: null, column: null, severity: 'fail', code, params }],
    issuesTruncated: false,
  },
})

/**
 * The validation of DOC-18 §2 and DOC-21 §4 in the two halves the commit also needs: `read` is CPU on the bytes, outside any
 * transaction; `plan` is the `db` layer, one `findUnitsByCodes` call for the whole file and never one per row (DOC-21 §4.3).
 */
export class FeeImportPlanner {
  constructor(
    private readonly reader: WorkbookReader,
    private readonly units: UnitDirectory,
  ) {}

  async read(bytes: Uint8Array, batchFeeMonth: LocalDate): Promise<FeeImportRead> {
    const workbook = await this.reader.read(bytes)
    if (!workbook.ok) return failed('import_file_type')
    if (workbook.tooMany) return { kind: 'too_many_rows' }
    const sheet = readFeeSheet(workbook.sheet)
    if (!sheet.ok) return failed(sheet.code, sheet.params)
    const parsed = sheet.rows.map((row) => parseFeeRow(row, batchFeeMonth))
    const set = checkFeeSet(parsed)
    const unknown = sheet.unknownColumns.map(
      (column): FeeImportIssue => ({
        row: 1,
        unitCode: null,
        column: null,
        severity: 'warning',
        code: 'import_unknown_column',
        params: { column },
      }),
    )
    return {
      kind: 'read',
      rowCount: parsed.length,
      survivors: set.survivors,
      issues: [...unknown, ...parsed.flatMap((row) => row.issues), ...set.issues],
    }
  }

  async plan(
    scope: BuildingScope,
    read: Extract<FeeImportRead, { kind: 'read' }>,
  ): Promise<FeeImportPlan> {
    const codes = [...new Set(read.survivors.map((row) => row.codeKey))]
    const found = codes.length > 0 ? await this.units.findUnitsByCodes(scope.buildingId, codes) : []
    return planFeeImport({
      rowCount: read.rowCount,
      survivors: read.survivors,
      earlierIssues: read.issues,
      units: new Map(found.map((unit) => [unit.code.toLowerCase(), unit])),
    })
  }
}
