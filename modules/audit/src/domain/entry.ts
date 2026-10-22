import { RuleViolationError } from '@core/kernel'
import type { AuditChange, AuditValue, JsonValue } from '../contracts'
import { AuditEntryTooLargeError, MalformedAuditActionError } from './errors'

/** Limits that are constants of the module, not configuration: a change is a code change and a new test (DOC-35 §11). */
export const MAX_STRING_LENGTH = 500
export const MAX_ENTRY_BYTES = 32_768
export const MAX_USER_AGENT_LENGTH = 500
const MIN_REASON_LENGTH = 5
const MAX_REASON_LENGTH = 500

/** `<module>.<object>.<verb>` in lower snake case, or the two-part `pii.read` (the `CHECK` of DOC-17 §2). */
const ACTION = /^[a-z_]+(\.[a-z_]+)+$/

export const PII_READ = 'pii.read'

export function assertActionShape(action: string): void {
  if (!ACTION.test(action)) throw new MalformedAuditActionError(action)
}

export const moduleOf = (action: string) => action.split('.')[0] as string

/** The actions that undo or override something carry a reason (DOC-35 §3.5). DOC-28, DOC-30 and DOC-32 confirm their own. */
const REASON_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  'finance.payment.void',
  'finance.charge.void',
  'finance.batch.recall',
  'finance.money_log.review',
  'residency.owner.transfer',
  'identity.staff.force_lock',
  'tickets.ticket.cancel',
  'tickets.ticket.force_assign',
  'vehicles.vehicle.reject',
  'wiki.page.restore',
])

/**
 * The reason, trimmed, when the action needs one and has a valid one; `undefined` when it needs none and none was given.
 * A missing or short reason is 422 `validation_failed` with rule `reason_too_short` (DOC-35 §3.5, AD-08).
 */
export function checkedReason(action: string, reason: string | undefined): string | undefined {
  const trimmed = reason?.trim()
  const required = REASON_REQUIRED_ACTIONS.has(action)
  if (required && (trimmed === undefined || trimmed.length < MIN_REASON_LENGTH))
    throw new RuleViolationError(
      'reason_too_short',
      `A reason of at least ${MIN_REASON_LENGTH} characters is required`,
      'reason',
    )
  if (trimmed === undefined || trimmed === '') return undefined
  return trimmed.slice(0, MAX_REASON_LENGTH)
}

/** A string over 500 characters is cut to 500 with a closing `…` (AD-11). */
export function clip<T extends AuditValue | JsonValue>(value: T): T {
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH)
    return `${value.slice(0, MAX_STRING_LENGTH - 1)}…` as T
  return value
}

function clipJson(value: JsonValue): JsonValue {
  if (typeof value === 'string') return clip(value)
  if (Array.isArray(value)) return value.map(clipJson)
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, JsonValue>).map(([key, item]) => [
        key,
        clipJson(item),
      ]),
    )
  return value
}

export interface PreparedPayload {
  changes: AuditChange[]
  details: Record<string, JsonValue>
}

/** Clips every string and refuses an entry over 32 KB of JSON (the bulk form is for actions over many rows, DOC-35 §3.4). */
export function preparePayload(
  changes: readonly AuditChange[],
  details: Record<string, JsonValue> = {},
): PreparedPayload {
  const clipped: PreparedPayload = {
    changes: changes.map((c) => ({ field: c.field, before: clip(c.before), after: clip(c.after) })),
    details: clipJson(details) as Record<string, JsonValue>,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(clipped)).length
  if (bytes > MAX_ENTRY_BYTES) throw new AuditEntryTooLargeError(bytes, MAX_ENTRY_BYTES)
  return clipped
}
