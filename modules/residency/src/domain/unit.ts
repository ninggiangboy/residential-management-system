import { type Transition, ValidationError } from '@core/kernel'
import type { Occupancy } from '../contracts'
import { vacancyChange } from './unit-occupancy'

export interface UnitRecord {
  id: string
  buildingId: string
  /** Stored upper-case (DOC-27 §4.1 rule 2). */
  code: string
  floor: number | null
  bedrooms: number | null
  /** A decimal string with two decimals (DR-11 treatment of `numeric`). */
  areaM2: string | null
  occupancy: Occupancy
  note: string | null
  version: number
}

export type UnitTransition = Transition<UnitRecord>

/** The fields the Manager edits (DOC-27 §4.1 rule 3). `undefined` keeps the stored value and `null` clears the nullable ones. */
export interface UnitEdit {
  code?: string
  floor?: number | null
  bedrooms?: number | null
  areaM2?: string | null
  occupancy?: Occupancy
  note?: string | null
}

/** What `POST /staff/units` stores (DOC-27 §4.1 rule 1). */
export interface NewUnit {
  id: string
  code: string
  floor: number | null
  bedrooms: number | null
  areaM2: string | null
  occupancy: Occupancy
  note: string | null
}

const UNIT_CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$/
const AREA = /^\d{1,4}(?:\.\d{1,2})?$/
const FLOOR = { min: -5, max: 150 }
const BEDROOMS = { min: 0, max: 20 }
const NOTE_MAX = 500

const invalid = (path: string, code: string, message: string): never => {
  throw new ValidationError([{ path, code, message }])
}

/** The code as DR-114 (1) writes it: trimmed, `^[A-Za-z0-9][A-Za-z0-9._/-]{0,19}$`, stored upper-case. */
export function unitCodeOf(input: string): string {
  const code = input.trim()
  return UNIT_CODE.test(code) ? code.toUpperCase() : invalid('code', 'pattern', 'a unit code')
}

const wholeIn = (
  path: string,
  value: number | null,
  { min, max }: { min: number; max: number },
) => {
  if (value !== null && !(Number.isInteger(value) && value >= min && value <= max))
    invalid(path, value < min ? 'minimum' : 'maximum', `${min} to ${max}`)
  return value
}

/** Above 0 and at most 2,000 with at most two decimals; written with two decimals as the column does. */
function areaOf(value: string | null): string | null {
  if (value === null) return null
  const text = value.trim()
  const area = Number(text)
  if (!AREA.test(text) || !(area > 0 && area <= 2000))
    invalid('areaM2', 'format', 'above 0, at most 2000, two decimals')
  return area.toFixed(2)
}

const noteOf = (value: string | null): string | null => {
  const note = value?.trim() || null
  if (note !== null && [...note].length > NOTE_MAX)
    invalid('note', 'maxLength', `${NOTE_MAX} characters`)
  return note
}

/** What an edit changed, for the audit row: the field and its before and after as text (`null` when empty). */
export interface UnitFieldChange {
  field: keyof UnitEdit
  before: string | number | null
  after: string | number | null
}

export interface UnitChange {
  transition: UnitTransition
  /** The vacancy boundary the change crossed, which is one `unit_history` row (DOC-27 §4.1 rule 6). */
  vacancy: 'moved_in' | 'moved_out' | null
  fields: UnitFieldChange[]
}

/** A unit of the building (DOC-16 §5.1). It is never deleted; the end of an occupancy is `vacant` (DR-12). */
export class Unit {
  constructor(readonly record: UnitRecord) {}

  /** The row a creation inserts, with every field normalised. */
  static create(id: string, input: Partial<Omit<NewUnit, 'id'>> & { code: string }): NewUnit {
    return {
      id,
      code: unitCodeOf(input.code),
      floor: wholeIn('floor', input.floor ?? null, FLOOR),
      bedrooms: wholeIn('bedrooms', input.bedrooms ?? null, BEDROOMS),
      areaM2: areaOf(input.areaM2 ?? null),
      occupancy: input.occupancy ?? 'vacant',
      note: noteOf(input.note ?? null),
    }
  }

  /** The statement that moves nothing but `version`: the first one of a transfer, which holds the row and arbitrates (DR-138). */
  static bump(id: string, expected: number): UnitTransition {
    return { id, expect: { version: expected }, set: { version: expected + 1 } }
  }

  /**
   * The fields that differ from the stored ones, as one guarded statement on `version` (DOC-27 §4.1 rule 5); `null` when nothing
   * would change. `occupancy` is set by the Manager and never derived (DR-40).
   */
  edit(input: UnitEdit): UnitChange | null {
    const { record } = this
    const set: Partial<UnitRecord> = {}
    const fields: UnitFieldChange[] = []
    const take = <K extends keyof UnitEdit & keyof UnitRecord>(field: K, value: UnitRecord[K]) => {
      if (value === record[field]) return
      set[field] = value
      fields.push({
        field,
        before: record[field] as string | number | null,
        after: value as string | number | null,
      })
    }
    if (input.code !== undefined) take('code', unitCodeOf(input.code))
    if (input.floor !== undefined) take('floor', wholeIn('floor', input.floor, FLOOR))
    if (input.bedrooms !== undefined)
      take('bedrooms', wholeIn('bedrooms', input.bedrooms, BEDROOMS))
    if (input.areaM2 !== undefined) take('areaM2', areaOf(input.areaM2))
    if (input.occupancy !== undefined) take('occupancy', input.occupancy)
    if (input.note !== undefined) take('note', noteOf(input.note))
    if (fields.length === 0) return null
    return {
      transition: {
        id: record.id,
        expect: { version: record.version },
        set: { ...set, version: record.version + 1 },
      },
      vacancy: vacancyChange(record.occupancy, set.occupancy ?? null),
      fields,
    }
  }
}
