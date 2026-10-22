import { type ValidationDetail, ValidationError } from '@core/kernel'
import type { Bilingual } from '../contracts'
import type { FieldChange } from './settings'

/** The fields of the building that the Admin may change (DOC-36 §4.1). `code`, `timeZone` and `isDemo` are not among them. */
export interface CompanyBlock {
  name: Bilingual
  taxCode?: string
  address?: string
  phone?: string
  email?: string
  representative?: string
}

export interface BuildingPatch {
  name?: Bilingual
  company?: CompanyBlock
  address?: string
  hotline?: string | null
  workingHours?: Bilingual | null
  email?: string | null
  logoFileId?: string | null
}

export interface BuildingFields {
  name: Bilingual
  company: CompanyBlock
  address: string
  hotline: string | null
  workingHours: Bilingual | null
  email: string | null
  logoFile: string | null
}

const PHONE = /^[0-9 +().-]{1,30}$/
const TAX_CODE = /^[0-9]{10}(-[0-9]{3})?$/
// Good enough for a contact address; the mail relay is the real judge.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Problems = ValidationDetail[]

function text(problems: Problems, path: string, value: unknown, min: number, max: number) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    problems.push({
      path,
      code: min > 0 ? 'length' : 'max_length',
      message: `${path} is not valid`,
    })
}

function bilingual(
  problems: Problems,
  path: string,
  value: Bilingual,
  max: number,
  required: boolean,
) {
  text(problems, `${path}.vi`, value.vi, required ? 1 : 0, max)
  if (value.en !== undefined) text(problems, `${path}.en`, value.en, 0, max)
}

function email(problems: Problems, path: string, value: string) {
  if (value.length > 254 || !EMAIL.test(value))
    problems.push({ path, code: 'format', message: `${path} is not an email address` })
}

/** The columns a patch sets (the logo is swapped separately, because it moves a file). */
export function patchedFields(patch: BuildingPatch): Partial<Omit<BuildingFields, 'logoFile'>> {
  const out: Partial<Omit<BuildingFields, 'logoFile'>> = {}
  if (patch.name) out.name = patch.name
  if (patch.company) out.company = patch.company
  if (patch.address !== undefined) out.address = patch.address
  if (patch.hotline !== undefined) out.hotline = patch.hotline
  if (patch.workingHours !== undefined) out.workingHours = patch.workingHours
  if (patch.email !== undefined) out.email = patch.email
  return out
}

function company(problems: Problems, block: CompanyBlock) {
  bilingual(problems, 'building.company.name', block.name, 160, true)
  if (block.taxCode !== undefined && !TAX_CODE.test(block.taxCode))
    problems.push({ path: 'building.company.taxCode', code: 'pattern', message: 'tax code' })
  if (block.address !== undefined) text(problems, 'building.company.address', block.address, 1, 300)
  if (block.phone !== undefined && !PHONE.test(block.phone))
    problems.push({ path: 'building.company.phone', code: 'pattern', message: 'phone' })
  if (block.email !== undefined) email(problems, 'building.company.email', block.email)
  if (block.representative !== undefined)
    text(problems, 'building.company.representative', block.representative, 0, 120)
}

/** The rules of DOC-36 §4.2. A breach is 400 `validation_failed` with `details: [{path, code, message}]` and nothing changes. */
export function assertBuildingPatch(patch: BuildingPatch): void {
  const problems: Problems = []
  if (patch.name) bilingual(problems, 'building.name', patch.name, 120, true)
  if (patch.company) company(problems, patch.company)
  if (patch.address !== undefined) text(problems, 'building.address', patch.address, 1, 300)
  if (patch.hotline != null && !PHONE.test(patch.hotline))
    problems.push({ path: 'building.hotline', code: 'pattern', message: 'hotline' })
  if (patch.workingHours)
    bilingual(problems, 'building.workingHours', patch.workingHours, 200, true)
  if (patch.email != null) email(problems, 'building.email', patch.email)
  if (problems.length > 0) throw new ValidationError(problems)
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const scalar = (value: unknown) =>
  value === undefined || value === null ? null : (value as string | number | boolean)

/** Compares two values and appends one change per scalar that differs, objects by member (`company.name.vi`). */
function walk(out: FieldChange[], path: string, before: unknown, after: unknown): void {
  if (JSON.stringify(before) === JSON.stringify(after)) return
  if (!isObject(before) && !isObject(after)) {
    out.push({ field: path, before: scalar(before), after: scalar(after) })
    return
  }
  const keys = new Set([
    ...Object.keys(isObject(before) ? before : {}),
    ...Object.keys(isObject(after) ? after : {}),
  ])
  for (const key of [...keys].sort())
    walk(
      out,
      `${path}.${key}`,
      isObject(before) ? before[key] : undefined,
      isObject(after) ? after[key] : undefined,
    )
}

/** The fields that differ, as audit changes: `company` and the bilingual blocks by member (`company.name.vi`). Personal-looking fields are masked by the use case, not here. */
export function diffBuilding(before: BuildingFields, after: BuildingFields): FieldChange[] {
  const out: FieldChange[] = []
  for (const field of [
    'name',
    'company',
    'address',
    'hotline',
    'workingHours',
    'email',
    'logoFile',
  ] as const)
    walk(out, field, before[field], after[field])
  return out
}
