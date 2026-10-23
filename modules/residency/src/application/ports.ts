/** Ports to the outside only; the repositories are interfaces of the domain (DOC-12 §4.5 rule 5). */
import type { Language } from '@rms/shared-types'
import type { Sheet } from '../domain/import/sheet'

/** What the reader found: the first sheet, or "this is not a workbook" (DQ-01). */
export type WorkbookRead = { ok: false } | { ok: true; sheet: Sheet; tooMany: boolean }

/** The streaming `exceljs` reader of DOC-18 §1.1. It never reads past the 5,001st data row. */
export interface WorkbookReader {
  read(bytes: Uint8Array): Promise<WorkbookRead>
}

/** The template of E-71, written in memory. */
export interface TemplateWriter {
  write(language: Language): Promise<Uint8Array>
}
