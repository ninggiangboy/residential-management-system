import { daysBetween, isLocalDate, type LocalDate, zonedParts } from '@rms/shared-types'
import { RequestRuleError } from './errors'

/** The most charges one manual payment covers (DOC-22 §5.1, §13, DR-267). */
export const MANUAL_PAYMENT_MAX_CHARGES = 50

/** A Manager may not back-date more than this; an Admin may (DOC-22 §5.1, FR-05.5, §13). */
export const MANUAL_PAYMENT_BACKDATE_DAYS = 90

/** The two ways a manual payment arrives (DOC-22 §5.1): cash in hand or a bank transfer. */
export type ManualMethod = 'cash' | 'bank_transfer'

/** A `POST /staff/payments` body before its rules are checked (DOC-22 §5.1). */
export interface ManualPaymentInput {
  readonly unitId: string
  readonly chargeIds: readonly string[]
  readonly amount?: number | null
  readonly method: ManualMethod
  readonly payerName: string
  readonly receivedOn: string
  readonly bankReference?: string | null
  readonly statementLineId?: string | null
  readonly note?: string | null
  readonly dryRun?: boolean
}

/**
 * The body after the rules of DOC-22 §5.1 passed: trimmed, de-duplicated, `receivedOn` a `LocalDate`.
 */
export interface CheckedManualPayment {
  readonly unitId: string
  readonly chargeIds: readonly string[]
  readonly amount: number | null
  readonly method: ManualMethod
  readonly payerName: string
  readonly receivedOn: LocalDate
  readonly bankReference: string | null
  readonly statementLineId: string | null
  readonly note: string | null
  readonly dryRun: boolean
}

/** Trim a text field and read the empty string as absent (DOC-22 §5.1). */
const trimmedOrNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** The payer-name, reference and note limits of DOC-22 §5.1. */
const PAYER_NAME_MAX = 120
const BANK_REFERENCE_MAX = 100
const NOTE_MAX = 500

/** Distinct ids in first-seen order, 1 to 50 (DOC-22 §5.1, LG-08). */
function checkedChargeIds(ids: readonly string[]): string[] {
  const chargeIds = [...new Set(ids)]
  if (chargeIds.length === 0)
    throw new RequestRuleError('chargeIds', 'too_few_charges', 'At least one charge')
  if (chargeIds.length > MANUAL_PAYMENT_MAX_CHARGES)
    throw new RequestRuleError(
      'chargeIds',
      'too_many_charges',
      `At most ${MANUAL_PAYMENT_MAX_CHARGES} charges`,
    )
  return chargeIds
}

/** A building day, not after today, and for a Manager not more than 90 days back (FR-05.5). */
function checkedReceivedOn(value: string, today: LocalDate, isAdmin: boolean): LocalDate {
  if (!isLocalDate(value))
    throw new RequestRuleError('receivedOn', 'format', 'A calendar day, YYYY-MM-DD')
  const back = daysBetween(value, today)
  if (back < 0) throw new RequestRuleError('receivedOn', 'received_on_future', 'Not after today')
  if (back > MANUAL_PAYMENT_BACKDATE_DAYS && !isAdmin)
    throw new RequestRuleError(
      'receivedOn',
      'received_on_too_old',
      `Not more than ${MANUAL_PAYMENT_BACKDATE_DAYS} days back`,
    )
  return value
}

/** An optional text, trimmed, blank read as absent, at most `max` characters. */
function optionalText(value: string | null | undefined, path: string, max: number): string | null {
  const text = trimmedOrNull(value)
  if (text !== null && text.length > max)
    throw new RequestRuleError(path, 'max_length', `At most ${max} characters`)
  return text
}

/**
 * Check the request rules of the manual payment in their documented order (DOC-22 §5.1, §13, DR-267). The first
 * failure throws a `RequestRuleError` naming the field and the rule; `chargeIds` is de-duplicated keeping
 * first-seen order, so a duplicate counts once (LG-08).
 */
export function checkManualPayment(
  input: ManualPaymentInput,
  today: LocalDate,
  isAdmin: boolean,
): CheckedManualPayment {
  const chargeIds = checkedChargeIds(input.chargeIds)
  if (input.method !== 'cash' && input.method !== 'bank_transfer')
    throw new RequestRuleError('method', 'enum', 'cash or bank_transfer')
  const payerName = input.payerName.trim()
  if (payerName === '')
    throw new RequestRuleError('payerName', 'required', 'The payer name is required')
  if (payerName.length > PAYER_NAME_MAX)
    throw new RequestRuleError('payerName', 'max_length', `At most ${PAYER_NAME_MAX} characters`)
  const receivedOn = checkedReceivedOn(input.receivedOn, today, isAdmin)
  const bankReference = optionalText(input.bankReference, 'bankReference', BANK_REFERENCE_MAX)
  const statementLineId = input.statementLineId ?? null
  if (statementLineId !== null && input.method === 'cash')
    throw new RequestRuleError('method', 'enum', 'a statement line needs bank_transfer')
  return {
    unitId: input.unitId,
    chargeIds,
    amount: input.amount ?? null,
    method: input.method,
    payerName,
    receivedOn,
    bankReference,
    statementLineId,
    note: optionalText(input.note, 'note', NOTE_MAX),
    dryRun: input.dryRun ?? false,
  }
}

/**
 * When the payment is stamped: `now` when it was received today, else 12:00 local of that day in `timeZone`
 * (DOC-22 §5.1, DOC-15 §7.1, DR-09). The caller reads `today` (the building day of `now`) and `now` once.
 */
export function receivedAtOf(
  receivedOn: LocalDate,
  today: LocalDate,
  now: Date,
  timeZone: string,
): Date {
  if (receivedOn === today) return now
  const [year, month, day] = receivedOn.split('-').map(Number) as [number, number, number]
  const utcNoon = Date.UTC(year, month - 1, day, 12)
  const local = zonedParts(new Date(utcNoon), timeZone)
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute)
  return new Date(utcNoon - (localAsUtc - utcNoon))
}
