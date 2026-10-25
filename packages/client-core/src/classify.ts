import type { ApiError } from './errors'

/** What a client does with an error (DOC-55 §6). A screen never branches on `message` or on the status alone. */
export type ClientAction =
  | { kind: 'refresh' }
  | { kind: 'terms' }
  | { kind: 'upgrade' }
  | { kind: 'membership_inactive' }
  | { kind: 'step_up'; failed: boolean }
  | { kind: 'forbidden' }
  | { kind: 'validation' }
  | { kind: 'conflict_refetch'; conflict: 'version' | 'transition' | 'charge' | 'ticket' }
  | { kind: 'retry_same_key' }
  | { kind: 'conflict_message' }
  | { kind: 'precondition' }
  | { kind: 'too_large' }
  | { kind: 'rate_limited' }
  | { kind: 'locked' }
  | { kind: 'maintenance' }
  | { kind: 'offline' }
  | { kind: 'server_error' }
  | { kind: 'not_found' }
  | { kind: 'unknown' }

const CONFLICT_REFETCH = new Map<string, 'version' | 'transition' | 'charge' | 'ticket'>([
  ['version_conflict', 'version'],
  ['invalid_transition', 'transition'],
  ['charge_changed', 'charge'],
])

/** The pure table of DOC-55 §6, tested with every code of DOC-42 §5 (CL-07, CL-08); an unknown code falls back to its status class (ER-45). */
export function classify(error: Pick<ApiError, 'status' | 'code'>): ClientAction {
  const { status, code } = error
  switch (code) {
    case 'unauthenticated':
      return { kind: 'refresh' }
    case 'terms_required':
      return { kind: 'terms' }
    case 'upgrade_required':
      return { kind: 'upgrade' }
    case 'membership_inactive':
      return { kind: 'membership_inactive' }
    case 'step_up_required':
      return { kind: 'step_up', failed: false }
    case 'step_up_failed':
      return { kind: 'step_up', failed: true }
    case 'forbidden':
      return { kind: 'forbidden' }
    case 'validation_failed':
      return { kind: 'validation' }
    case 'request_in_progress':
      return { kind: 'retry_same_key' }
    case 'precondition_required':
      return { kind: 'precondition' }
    case 'payload_too_large':
    case 'quota_exceeded':
      return { kind: 'too_large' }
    case 'rate_limited':
      return { kind: 'rate_limited' }
    case 'account_locked':
      return { kind: 'locked' }
    case 'maintenance':
      return { kind: 'maintenance' }
    case 'service_unavailable':
    case 'network':
      return { kind: 'offline' }
    case 'internal_error':
      return { kind: 'server_error' }
    case 'not_found':
      return { kind: 'not_found' }
    default:
  }
  const conflict = CONFLICT_REFETCH.get(code)
  if (conflict) return { kind: 'conflict_refetch', conflict }
  if (code.startsWith('ticket_')) return { kind: 'conflict_refetch', conflict: 'ticket' }
  // Any other code: the status class decides, and the caller shows `error.message`.
  if (status === 409) return { kind: 'conflict_message' }
  if (status === 404) return { kind: 'not_found' }
  if (status === 401) return { kind: 'refresh' }
  if (status === 403) return { kind: 'forbidden' }
  if (status === 429) return { kind: 'rate_limited' }
  if (status === 503 || status === 0) return { kind: 'offline' }
  if (status >= 500) return { kind: 'server_error' }
  if (status === 400 || status === 422) return { kind: 'validation' }
  return { kind: 'unknown' }
}
