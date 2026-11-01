import type { Language } from '@rms/shared-types'
import { foldKey } from './folding'

/** The canonical columns of the units-and-owners file (DOC-18 §1.1). */
export const UNIT_OWNER_COLUMNS = [
  'unit_code',
  'floor',
  'unit_type',
  'bedrooms',
  'area_m2',
  'occupancy',
  'owner_name',
  'owner_phone',
  'owner_email',
  'owner_id_number',
  'owner_dob',
] as const
export type UnitOwnerColumn = (typeof UNIT_OWNER_COLUMNS)[number]

export const isUnitOwnerColumn = (value: string): value is UnitOwnerColumn =>
  (UNIT_OWNER_COLUMNS as readonly string[]).includes(value)

/** The owner columns: filling any of them makes the row an owner row (DQ-15, DQ-16). */
export const OWNER_COLUMNS = [
  'owner_name',
  'owner_phone',
  'owner_email',
  'owner_id_number',
  'owner_dob',
] as const satisfies readonly UnitOwnerColumn[]

/** Header of the template, per language (DOC-18 §1.1, E-71). */
export const TEMPLATE_HEADERS: Record<Language, Record<UnitOwnerColumn, string>> = {
  vi: {
    unit_code: 'Mã căn hộ',
    floor: 'Tầng',
    unit_type: 'Loại căn hộ',
    bedrooms: 'Số phòng ngủ',
    area_m2: 'Diện tích (m²)',
    occupancy: 'Tình trạng',
    owner_name: 'Họ tên chủ hộ',
    owner_phone: 'SĐT chủ hộ',
    owner_email: 'Email chủ hộ',
    owner_id_number: 'CCCD chủ hộ',
    owner_dob: 'Ngày sinh chủ hộ',
  },
  en: {
    unit_code: 'Unit code',
    floor: 'Floor',
    unit_type: 'Unit type',
    bedrooms: 'Bedrooms',
    area_m2: 'Area (m²)',
    occupancy: 'Occupancy',
    owner_name: 'Owner full name',
    owner_phone: 'Owner phone',
    owner_email: 'Owner email',
    owner_id_number: 'Owner ID number',
    owner_dob: 'Owner date of birth',
  },
}

export const TEMPLATE_SHEET_NAMES: Record<Language, string> = { vi: 'Căn hộ', en: 'Units' }

/** Columns whose cells the template formats as Text, because Excel drops the leading zero of a number (DOC-18 §1.1). */
export const TEXT_COLUMNS = [
  'unit_code',
  'unit_type',
  'occupancy',
  'owner_name',
  'owner_phone',
  'owner_email',
  'owner_id_number',
  'owner_dob',
] as const satisfies readonly UnitOwnerColumn[]

/** Aliases a header may have (DOC-18 §1.1); compared by `foldKey`. */
const ALIASES: Record<UnitOwnerColumn, readonly string[]> = {
  unit_code: ['Mã căn hộ', 'Mã căn', 'Căn hộ', 'Unit code', 'Unit', 'Apartment'],
  floor: ['Tầng', 'Floor'],
  // `Loại căn` and `Type` named the bedroom count before DR-315; they name the unit type now.
  unit_type: ['Loại căn hộ', 'Loại hình', 'Loại căn', 'Unit type', 'Type'],
  bedrooms: ['Số phòng ngủ', 'PN', 'Bedrooms'],
  area_m2: ['Diện tích (m²)', 'Diện tích', 'DT', 'Area (m²)', 'Area'],
  occupancy: ['Tình trạng', 'Hiện trạng', 'Occupancy'],
  owner_name: ['Họ tên chủ hộ', 'Tên chủ hộ', 'Chủ hộ', 'Owner full name', 'Owner name'],
  owner_phone: ['SĐT chủ hộ', 'Số điện thoại chủ hộ', 'Điện thoại chủ hộ', 'Owner phone'],
  owner_email: ['Email chủ hộ', 'Owner email'],
  owner_id_number: ['CCCD chủ hộ', 'Số CCCD', 'CMND/CCCD', 'Owner ID number', 'Owner CCCD'],
  owner_dob: ['Ngày sinh chủ hộ', 'Ngày sinh', 'Owner date of birth', 'Owner DOB'],
}

const COLUMN_BY_KEY: ReadonlyMap<string, UnitOwnerColumn> = new Map(
  UNIT_OWNER_COLUMNS.flatMap((column) =>
    ALIASES[column].map((alias) => [foldKey(alias), column] as const),
  ),
)

/** The canonical column a header names, or `null` when it matches no alias (DQ-06). */
export const columnOfHeader = (header: string): UnitOwnerColumn | null =>
  COLUMN_BY_KEY.get(foldKey(header)) ?? null
