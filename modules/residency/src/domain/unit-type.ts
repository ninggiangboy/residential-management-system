import { type Transition, ValidationError } from '@core/kernel'
import { areaOf, BEDROOMS, wholeIn } from './unit'

export type UnitTypeStatus = 'active' | 'archived'

/** The most unit types a building has, archived ones counted (DR-314). */
export const UNIT_TYPE_LIMIT = 50

export interface UnitTypeName {
  vi: string
  /** `null` when the type has no English name; the stored object then has no `en` key (DOC-14 §8). */
  en: string | null
}

export interface UnitTypeRecord {
  id: string
  buildingId: string
  /** Never edited after the insert: the import and the tests name a type by it (DR-315). */
  code: string
  name: UnitTypeName
  defaultBedrooms: number | null
  /** A decimal string with two decimals, as `Unit.areaM2`. */
  defaultAreaM2: string | null
  status: UnitTypeStatus
  archivedAt: Date | null
  version: number
}

export type UnitTypeTransition = Transition<UnitTypeRecord>

/** What `POST /staff/unit-types` stores. */
export interface NewUnitType {
  id: string
  code: string
  name: UnitTypeName
  defaultBedrooms: number | null
  defaultAreaM2: string | null
}

export interface UnitTypeCreateInput {
  code: string
  name: { vi: string; en?: string | null }
  defaultBedrooms?: number | null
  defaultAreaM2?: string | null
}

/** The fields the Manager edits: `undefined` keeps the stored value, `null` clears a default or the English name. */
export interface UnitTypeEdit {
  name?: { vi?: string; en?: string | null }
  defaultBedrooms?: number | null
  defaultAreaM2?: string | null
  status?: UnitTypeStatus
}

export interface UnitTypeFieldChange {
  field: 'name' | 'defaultBedrooms' | 'defaultAreaM2' | 'status'
  before: string | number | null
  after: string | number | null
}

export interface UnitTypeChange {
  transition: UnitTypeTransition
  fields: UnitTypeFieldChange[]
}

const CODE = /^[a-z][a-z0-9_]{1,29}$/
const NAME_MAX = 60

const invalid = (path: string, code: string, message: string): never => {
  throw new ValidationError([{ path, code, message }])
}

export function unitTypeCodeOf(input: string): string {
  const code = input.trim()
  return CODE.test(code) ? code : invalid('code', 'pattern', 'a unit type code')
}

const nameText = (path: string, value: string): string => {
  const text = value.trim().replace(/\s+/g, ' ')
  const length = [...text].length
  if (length < 1) return invalid(path, 'required', '1 to 60 characters')
  if (length > NAME_MAX) return invalid(path, 'max_length', `${NAME_MAX} characters`)
  return text
}

const englishOf = (value: string | null | undefined): string | null => {
  if (value === undefined || value === null) return null
  const text = value.trim()
  return text === '' ? null : nameText('name.en', text)
}

const bedroomsOf = (value: number | null) => wholeIn('defaultBedrooms', value, BEDROOMS)

/** The stored object of a name: `vi` always, `en` only when there is one (DOC-14 §8). */
export const nameDocument = (name: UnitTypeName): { vi: string; en?: string } =>
  name.en === null ? { vi: name.vi } : { vi: name.vi, en: name.en }

const nameLabel = (name: UnitTypeName) => (name.en === null ? name.vi : `${name.vi} / ${name.en}`)

/** One kind of unit of the building (DOC-16 §5.6). It is never deleted; the end of its use is `archived` (DR-314). */
export class UnitType {
  constructor(readonly record: UnitTypeRecord) {}

  static create(id: string, input: UnitTypeCreateInput): NewUnitType {
    return {
      id,
      code: unitTypeCodeOf(input.code),
      name: { vi: nameText('name.vi', input.name.vi), en: englishOf(input.name.en) },
      defaultBedrooms: bedroomsOf(input.defaultBedrooms ?? null),
      defaultAreaM2: areaOf(input.defaultAreaM2 ?? null, 'defaultAreaM2'),
    }
  }

  /** What a new unit of this type takes for the fields it leaves out (DR-315). */
  get defaults(): { bedrooms: number | null; areaM2: string | null } {
    return { bedrooms: this.record.defaultBedrooms, areaM2: this.record.defaultAreaM2 }
  }

  get archived(): boolean {
    return this.record.status === 'archived'
  }

  /**
   * The fields that differ from the stored ones, as one guarded statement on `version` (DOC-27 §4.3 rule 6); `null` when nothing
   * would change. An archive sets `archived_at` and a restore clears it in the same statement.
   */
  edit(input: UnitTypeEdit, now: Date): UnitTypeChange | null {
    const { record } = this
    const set: Partial<UnitTypeRecord> = {}
    const fields: UnitTypeFieldChange[] = []
    if (input.name !== undefined) {
      const vi = input.name.vi === undefined ? record.name.vi : nameText('name.vi', input.name.vi)
      const en = input.name.en === undefined ? record.name.en : englishOf(input.name.en)
      if (vi !== record.name.vi || en !== record.name.en) {
        set.name = { vi, en }
        fields.push({ field: 'name', before: nameLabel(record.name), after: nameLabel({ vi, en }) })
      }
    }
    if (input.defaultBedrooms !== undefined) {
      const value = bedroomsOf(input.defaultBedrooms)
      if (value !== record.defaultBedrooms) {
        set.defaultBedrooms = value
        fields.push({ field: 'defaultBedrooms', before: record.defaultBedrooms, after: value })
      }
    }
    if (input.defaultAreaM2 !== undefined) {
      const value = areaOf(input.defaultAreaM2, 'defaultAreaM2')
      if (value !== record.defaultAreaM2) {
        set.defaultAreaM2 = value
        fields.push({ field: 'defaultAreaM2', before: record.defaultAreaM2, after: value })
      }
    }
    if (input.status !== undefined && input.status !== record.status) {
      set.status = input.status
      set.archivedAt = input.status === 'archived' ? now : null
      fields.push({ field: 'status', before: record.status, after: input.status })
    }
    if (fields.length === 0) return null
    return {
      transition: {
        id: record.id,
        expect: { version: record.version },
        set: { ...set, version: record.version + 1 },
      },
      fields,
    }
  }
}
