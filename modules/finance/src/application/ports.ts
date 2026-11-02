import type { Language } from '@rms/shared-types'
import type { Sheet } from '../domain/fee-import/sheet'

/** A unit found by its code (DOC-21 §2.1, DR-265): `occupancy` is for display, `hasActiveOwner` decides DQ-78. */
export interface FoundUnitDto {
  readonly unitId: string
  readonly code: string
  readonly occupancy: 'occupied' | 'rented' | 'vacant'
  readonly hasActiveOwner: boolean
}

/** `ResidencyApi.findUnitsByCodes` as `finance` needs it: at most 5,000 codes, compared by `lower(code)` (DOC-21 §2.1, §4.3). */
export interface UnitDirectory {
  findUnitsByCodes(buildingId: string, codes: readonly string[]): Promise<readonly FoundUnitDto[]>
}

/** What the reader found: the first sheet, or "this is not a workbook" (DQ-01). */
export type WorkbookRead = { ok: false } | { ok: true; sheet: Sheet; tooMany: boolean }

/** The streaming `exceljs` reader of DOC-18 §1.1; it never reads past the 5,001st data row (DQ-05). */
export interface WorkbookReader {
  read(bytes: Uint8Array): Promise<WorkbookRead>
}

/** The template of E-71 for a fee file, written in memory (DOC-18 §2.1). */
export interface TemplateWriter {
  write(language: Language): Promise<Uint8Array>
}
