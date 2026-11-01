import type { Occupancy } from '../../contracts'
import { OWNER_COLUMNS, type UnitOwnerColumn } from './columns'
import { foldKey } from './folding'
import type { Cell, RawRow } from './sheet'
import type { ImportIssue, OwnerCells, ParsedRow, Severity } from './types'

/** A phone parser the infrastructure supplies: `libphonenumber-js/max`, region VN (DR-114). */
export interface PhoneParser {
  /** `null` for a number that is not valid anywhere; `landline` for a `FIXED_LINE`. */
  parse(input: string): { e164: string; landline: boolean } | null
}

export interface RowContext {
  /** The building's today, `YYYY-MM-DD` (DQ-23). */
  today: string
  phones: PhoneParser
}

const UNIT_CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const AREA = /^\d+(?:[.,]\d{1,2})?$/
const WHOLE = /^[+-]?\d+$/
const DATE_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const EARLIEST_BIRTH = '1900-01-01'
/** The Excel serial 0 is 1899-12-30 once the 1900 leap-year bug is accounted for. */
const SERIAL_EPOCH = Date.UTC(1899, 11, 30)

const OCCUPANCY_WORDS: Record<Occupancy, readonly string[]> = {
  occupied: ['occupied', 'đang ở', 'chủ ở'],
  rented: ['rented', 'cho thuê'],
  vacant: ['vacant', 'trống', 'bỏ trống'],
}
const OCCUPANCY_BY_KEY = new Map(
  (Object.entries(OCCUPANCY_WORDS) as [Occupancy, readonly string[]][]).flatMap(([value, words]) =>
    words.map((word) => [foldKey(word), value] as const),
  ),
)

export const isBlank = (cell: Cell | undefined): boolean =>
  cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')

/** The text of a cell the way a person would have typed it. */
const textOf = (cell: Cell): string =>
  typeof cell === 'string' ? cell.trim() : cell instanceof Date ? cell.toISOString() : String(cell)

/** The normalised unit code, or `null` (DQ-10): trimmed, 1–20 characters, stored upper-case. */
export function normalizeUnitCode(cell: Cell | undefined): string | null {
  if (isBlank(cell)) return null
  const text = textOf(cell as Cell)
  return UNIT_CODE.test(text) ? text.toUpperCase() : null
}

export function parseWhole(cell: Cell | undefined, min: number, max: number): number | null {
  const text = textOf(cell as Cell)
  const value = typeof cell === 'number' ? cell : WHOLE.test(text) ? Number(text) : Number.NaN
  return Number.isInteger(value) && value >= min && value <= max ? value : null
}

/** DQ-13: above 0 and at most 2,000, at most two decimals, `.` or `,` as the mark; `1,000.5` is refused. */
export function parseArea(cell: Cell | undefined): string | null {
  const text = textOf(cell as Cell).replace(/\s/g, '')
  if (!AREA.test(text)) return null
  const value = Number(text.replace(',', '.'))
  return value > 0 && value <= 2000 ? value.toFixed(2) : null
}

export function parseOccupancy(cell: Cell | undefined): Occupancy | null {
  return OCCUPANCY_BY_KEY.get(foldKey(textOf(cell as Cell))) ?? null
}

/** DQ-17: collapsed, 2–100 characters, a letter, no control character. */
export function parseName(cell: Cell | undefined): string | null {
  const raw = typeof cell === 'string' ? cell : String(cell)
  if (/\p{Cc}/u.test(raw)) return null
  const name = raw.replace(/\s+/g, ' ').trim()
  const length = [...name].length
  return length >= 2 && length <= 100 && /\p{L}/u.test(name) ? name : null
}

export function parseEmail(cell: Cell | undefined): string | null {
  const text = textOf(cell as Cell)
  return text.length <= 254 && EMAIL.test(text) ? text.toLowerCase() : null
}

/** DQ-21 and DQ-22: 9 or 12 digits; a number cell of 10 or 11 digits lost its zeros and is padded to 12. */
export function parseIdNumber(cell: Cell | undefined): { value: string; padded: boolean } | null {
  if (typeof cell === 'number') {
    if (!Number.isInteger(cell) || cell < 0) return null
    const digits = String(cell)
    if (digits.length === 10 || digits.length === 11)
      return { value: digits.padStart(12, '0'), padded: true }
    return digits.length === 9 || digits.length === 12 ? { value: digits, padded: false } : null
  }
  const digits = textOf(cell as Cell).replace(/\s+/g, '')
  return /^(?:\d{12}|\d{9})$/.test(digits) ? { value: digits, padded: false } : null
}

const realDay = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day))
  const ok =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return ok ? date.toISOString().slice(0, 10) : null
}

/** DQ-23: `DD/MM/YYYY`, `YYYY-MM-DD`, an Excel date cell or an Excel serial; a real day from 1900-01-01 to today. */
export function parseBirthDate(cell: Cell | undefined, today: string): string | null {
  let day: string | null = null
  if (cell instanceof Date)
    day = Number.isNaN(cell.getTime()) ? null : cell.toISOString().slice(0, 10)
  else if (typeof cell === 'number')
    day = Number.isInteger(cell)
      ? new Date(SERIAL_EPOCH + cell * 86_400_000).toISOString().slice(0, 10)
      : null
  else {
    const text = textOf(cell as Cell)
    const dmy = DATE_DMY.exec(text)
    const iso = DATE_ISO.exec(text)
    if (dmy) day = realDay(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]))
    else if (iso) day = realDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }
  return day !== null && day >= EARLIEST_BIRTH && day <= today ? day : null
}

/** DQ-10 to DQ-23 on one row. The first problem of a column is the one reported. */
export function parseRow(raw: RawRow, context: RowContext): ParsedRow {
  const { cells } = raw
  const unitCode = normalizeUnitCode(cells.unit_code)
  const issues: ImportIssue[] = []
  const add = (
    column: UnitOwnerColumn,
    severity: Severity,
    code: string,
    params: Record<string, string | number> = {},
  ) => issues.push({ row: raw.row, unitCode, column, severity, code, params })

  if (unitCode === null) add('unit_code', 'error', 'unit_code_invalid')

  let floor: number | null = null
  if (!isBlank(cells.floor)) {
    floor = parseWhole(cells.floor, -5, 150)
    if (floor === null) add('floor', 'error', 'floor_invalid')
  }
  const unitType = isBlank(cells.unit_type) ? null : textOf(cells.unit_type as Cell)
  let bedrooms: number | null = null
  if (!isBlank(cells.bedrooms)) {
    bedrooms = parseWhole(cells.bedrooms, 0, 20)
    if (bedrooms === null) add('bedrooms', 'error', 'bedrooms_invalid')
  }
  let areaM2: string | null = null
  if (!isBlank(cells.area_m2)) {
    areaM2 = parseArea(cells.area_m2)
    if (areaM2 === null) add('area_m2', 'error', 'area_invalid', { max: 2000 })
  }
  let occupancy: Occupancy | null = null
  if (!isBlank(cells.occupancy)) {
    occupancy = parseOccupancy(cells.occupancy)
    if (occupancy === null) add('occupancy', 'error', 'occupancy_invalid')
  }

  const ownerFilled = OWNER_COLUMNS.some((column) => !isBlank(cells[column]))
  let owner: OwnerCells | null = null
  if (ownerFilled) {
    let name: string | null = null
    if (isBlank(cells.owner_name)) add('owner_name', 'error', 'owner_name_required')
    else {
      name = parseName(cells.owner_name)
      if (name === null) add('owner_name', 'error', 'owner_name_invalid')
    }
    let phone: string | null = null
    if (isBlank(cells.owner_phone)) add('owner_phone', 'error', 'owner_phone_required')
    else {
      const parsed = context.phones.parse(textOf(cells.owner_phone as Cell))
      if (parsed === null) add('owner_phone', 'error', 'phone_invalid')
      else {
        phone = parsed.e164
        if (parsed.landline) add('owner_phone', 'warning', 'phone_not_mobile')
      }
    }
    let email: string | null = null
    if (!isBlank(cells.owner_email)) {
      email = parseEmail(cells.owner_email)
      if (email === null) add('owner_email', 'error', 'email_invalid')
    }
    let idNumber: string | null = null
    if (!isBlank(cells.owner_id_number)) {
      const parsed = parseIdNumber(cells.owner_id_number)
      if (parsed === null) add('owner_id_number', 'error', 'id_number_invalid')
      else {
        idNumber = parsed.value
        if (parsed.padded) add('owner_id_number', 'warning', 'id_number_padded')
      }
    }
    let dateOfBirth: string | null = null
    if (!isBlank(cells.owner_dob)) {
      dateOfBirth = parseBirthDate(cells.owner_dob, context.today)
      if (dateOfBirth === null) add('owner_dob', 'error', 'dob_invalid')
    }
    if (name !== null && phone !== null) owner = { name, phone, email, idNumber, dateOfBirth }
  }

  return { row: raw.row, unitCode, floor, unitType, bedrooms, areaM2, occupancy, owner, issues }
}
