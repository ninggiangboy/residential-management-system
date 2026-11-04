import type { Language, MemberType } from '@rms/shared-types'
import type { Sheet } from '../domain/fee-import/sheet'
import type { ReceiptContext } from '../domain/receipt-snapshot'
import type { Bilingual, PdfLanguage } from './pdf-renderer'

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

/** `BuildingApi.getBuilding(id).timeZone` (DOC-21 §2.1, DR-09): the zone the building's "today" is read in. */
export interface BuildingCalendar {
  timeZone(buildingId: string): Promise<string>
}

/**
 * What a receipt freezes of the building at issue time (DOC-22 §7, DR-17): the zone of the receipt period, the company block and
 * the building name. The payer is the caller's.
 */
export interface ReceiptBuildingSource {
  forBuilding(buildingId: string): Promise<Omit<ReceiptContext, 'payer'>>
}

/**
 * The payer of an online payment (DOC-23 §2.2): the name from `IdentityApi.getResidentAccounts` (`null` once the account is
 * deleted, IN-39) and the member type from `ResidencyApi.getMembership` (`null` without a membership).
 */
export interface PayerDirectory {
  payer(
    accountId: string,
    unitId: string,
  ): Promise<{ readonly name: string | null; readonly memberType: MemberType | null }>
}

/**
 * The building's fee-notice language at the moment a receipt is first rendered (DOC-34 §7.3, DOC-36 §5.2, FR-36.1): a
 * cached receipt keeps that language even when the setting changes later. The adapter reads `BuildingApi.getSettings`.
 */
export interface NoticeLanguageSource {
  language(buildingId: string): Promise<PdfLanguage>
}

/** The building block a fee notice prints (DOC-34 §6.1, DR-292): the header, the logo id and the two "how to pay" switches. */
export interface NoticeBuilding {
  readonly name: Bilingual
  readonly company: { readonly name: Bilingual; readonly address: string | null }
  readonly address: string
  readonly hotline: string | null
  readonly email: string | null
  readonly workingHours: Bilingual | null
  /** The `building.logo_file` id, not the bytes (DOC-34 §8.1): the cache key covers it and the renderer reads the bytes. */
  readonly logoFile: string | null
  /** The building's gateway configuration is `active` (DOC-34 §6.1): the first "how to pay" line prints. */
  readonly gatewayActive: boolean
}

/**
 * What a fee notice prints of the building and its units (DOC-34 §6.1, DR-292): a port in `application/`; the `apps/api`
 * adapter reads `BuildingApi` and `ResidencyApi.unitOwnerNames`.
 */
export interface NoticeContextSource {
  /** The header block of DOC-34 §6.1 for one building. */
  building(buildingId: string): Promise<NoticeBuilding>
  /** The active owner's name of each unit, `null` when it has none (DR-292); a missing id is absent from the map. */
  ownerNames(buildingId: string, unitIds: string[]): Promise<Map<string, string | null>>
}
