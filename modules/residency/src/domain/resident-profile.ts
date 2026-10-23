import { type Transition, ValidationError } from '@core/kernel'

export interface ResidentProfileRecord {
  buildingId: string
  accountId: string
  fullName: string | null
  email: string | null
  /** `v1:<keyId>:<iv>:<ciphertext+tag>`, sealed with the PII key ring and `cccdAad` (DOC-36 §6.2). */
  cccdEnc: string | null
  cccdLast4: string | null
  /** `YYYY-MM-DD`. */
  dateOfBirth: string | null
  note: string | null
  clearedAt: Date | null
  version: number
}

export type ResidentProfileTransition = Transition<ResidentProfileRecord>

/** The fields the Manager edits (DOC-27 §5.3). `undefined` keeps the stored value and `null` clears it. */
export interface ProfileEdit {
  fullName?: string | null
  email?: string | null
  /** As typed: 12 digits (CCCD) or 9 (CMND), spaces allowed. */
  cccd?: string | null
  dateOfBirth?: string | null
  note?: string | null
}

/** What a sealed number needs: the blob alone is not enough to open it elsewhere (DOC-36 §6.2). */
export const cccdAad = (buildingId: string, accountId: string) => `cccd|${buildingId}|${accountId}`

const CCCD = /^(?:\d{12}|\d{9})$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EARLIEST_BIRTH = '1900-01-01'

/** The digits of an ID number with the spaces removed, or a 400 `format` (DR-114 (5)). */
export function normalizeCccd(input: string): string {
  const digits = input.replace(/\s+/g, '')
  if (!CCCD.test(digits))
    throw new ValidationError([{ path: 'cccd', code: 'format', message: '12 or 9 digits' }])
  return digits
}

/** A real calendar date from 1900-01-01 up to the building's today (DOC-27 §5.3). */
export function assertBirthDate(value: string, today: string): void {
  const match = DATE.exec(value)
  const real =
    match !== null &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value &&
    value >= EARLIEST_BIRTH &&
    value <= today
  if (!real)
    throw new ValidationError([{ path: 'dateOfBirth', code: 'format', message: 'YYYY-MM-DD' }])
}

/** A building's record of one person (DOC-16 §5.2). A cleared one (after an account deletion) is no longer edited. */
export class ResidentProfile {
  constructor(readonly record: ResidentProfileRecord) {}

  get isCleared(): boolean {
    return this.record.clearedAt !== null
  }

  /**
   * The fields that differ from the stored ones, as one guarded statement on `version`. `sealed` is the number already sealed by
   * the caller (the box is async and the domain is pure). `null` when nothing would change.
   */
  edit(
    input: ProfileEdit,
    sealed: { cccdEnc: string; cccdLast4: string } | null | undefined,
    today: string,
  ): ResidentProfileTransition | null {
    const { record } = this
    const set: Partial<ResidentProfileRecord> = {}
    if (input.fullName !== undefined) {
      const name = input.fullName?.trim() ?? ''
      if (name === '')
        throw new ValidationError([{ path: 'fullName', code: 'required', message: 'a name' }])
      if (name !== record.fullName) set.fullName = name
    }
    if (input.email !== undefined) {
      const email = input.email?.trim() || null
      if (email !== null && !EMAIL.test(email))
        throw new ValidationError([{ path: 'email', code: 'format', message: 'an email address' }])
      if (email !== record.email) set.email = email
    }
    if (input.dateOfBirth !== undefined) {
      if (input.dateOfBirth !== null) assertBirthDate(input.dateOfBirth, today)
      if (input.dateOfBirth !== record.dateOfBirth) set.dateOfBirth = input.dateOfBirth
    }
    if (input.note !== undefined) {
      const note = input.note?.trim() || null
      if (note !== record.note) set.note = note
    }
    // The two columns of the number change together (`resident_profile_cccd_pair`).
    if (input.cccd !== undefined) {
      if (sealed) Object.assign(set, sealed)
      else Object.assign(set, { cccdEnc: null, cccdLast4: null })
    }
    if (Object.keys(set).length === 0) return null
    return {
      id: record.accountId,
      expect: { version: record.version },
      set: { ...set, version: record.version + 1 },
    }
  }
}
