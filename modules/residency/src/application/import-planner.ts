import type { IdentityApi } from '@mod/identity/contracts'
import type { BuildingScope } from '@rms/shared-types'
import {
  checkSet,
  classify,
  EMPTY_COUNTS,
  type ImportPlan,
  type Lookups,
} from '../domain/import/plan'
import { type PhoneParser, parseRow } from '../domain/import/row-rules'
import { readSheet } from '../domain/import/sheet'
import type { ImportIssue, ImportPreview, ParsedRow } from '../domain/import/types'
import type { UnitImportRepository } from '../domain/unit-import-repository'
import type { WorkbookReader } from './ports'

/** The file, read and checked by the file, row and set layers: nothing here touches the database. */
export type ImportRead =
  | { kind: 'too_many_rows' }
  | { kind: 'failed'; preview: ImportPreview }
  | { kind: 'read'; rowCount: number; survivors: ParsedRow[]; issues: ImportIssue[] }

const fileIssue = (code: string, params: Record<string, string> = {}): ImportIssue => ({
  row: 1,
  unitCode: null,
  column: null,
  severity: 'fail',
  code,
  params,
})

/**
 * The validation of DOC-18 §1 in the two halves the commit also needs: `read` is CPU on the bytes (outside any transaction), `plan`
 * is the `db` layer, three set queries and one contract call for the whole file, never one query per row (DOC-18 §1.5).
 */
export class ImportPlanner {
  constructor(
    private readonly reader: WorkbookReader,
    private readonly phones: PhoneParser,
    private readonly units: UnitImportRepository,
    private readonly identity: Pick<IdentityApi, 'findResidentAccountsByPhones'>,
  ) {}

  async read(bytes: Uint8Array, today: string): Promise<ImportRead> {
    const failed = (issue: ImportIssue): ImportRead => ({
      kind: 'failed',
      preview: {
        counts: { ...EMPTY_COUNTS },
        validRows: [],
        issues: [issue],
        issuesTruncated: false,
      },
    })
    const workbook = await this.reader.read(bytes)
    if (!workbook.ok) return failed(fileIssue('import_file_type'))
    if (workbook.tooMany) return { kind: 'too_many_rows' }
    const sheet = readSheet(workbook.sheet)
    if (!sheet.ok) return failed(fileIssue(sheet.code, sheet.params))
    const context = { today, phones: this.phones }
    const parsed = sheet.rows.map((row) => parseRow(row, context))
    const set = checkSet(parsed)
    const unknown: ImportIssue[] = sheet.unknownColumns.map((column) => ({
      row: 1,
      unitCode: null,
      column: null,
      severity: 'warning',
      code: 'import_unknown_column',
      params: { column },
    }))
    return {
      kind: 'read',
      rowCount: parsed.length,
      survivors: set.survivors,
      issues: [...unknown, ...parsed.flatMap((row) => row.issues), ...set.issues],
    }
  }

  async plan(
    scope: BuildingScope,
    read: Extract<ImportRead, { kind: 'read' }>,
  ): Promise<ImportPlan> {
    const { survivors } = read
    const codes = [...new Set(survivors.map((row) => (row.unitCode as string).toLowerCase()))]
    const phones = [...new Set(survivors.flatMap((row) => (row.owner ? [row.owner.phone] : [])))]
    const [units, matches, unitTypes] = await Promise.all([
      this.units.findUnits(scope, codes),
      phones.length > 0 ? this.identity.findResidentAccountsByPhones(phones) : [],
      // Q-T runs once per file, and only when a row names a type (DOC-18 §1.5).
      survivors.some((row) => row.unitType !== null) ? this.units.findUnitTypes(scope) : [],
    ])
    const accounts = new Map(matches.map((match) => [match.phone, { accountId: match.accountId }]))
    const accountIds = [...new Set(matches.map((match) => match.accountId))]
    const [members, profiles] = await Promise.all([
      this.units.findMembers(
        scope,
        units.map((unit) => unit.unitId),
        accountIds,
      ),
      this.units.findProfiles(scope, accountIds),
    ])
    const lookups: Lookups = {
      unitTypes,
      units: new Map(units.map((unit) => [unit.code.toLowerCase(), unit])),
      accounts,
      members,
      profiles: new Map(profiles.map((profile) => [profile.accountId, profile])),
    }
    return classify({
      rowCount: read.rowCount,
      survivors,
      earlierIssues: read.issues,
      lookups,
    })
  }
}
