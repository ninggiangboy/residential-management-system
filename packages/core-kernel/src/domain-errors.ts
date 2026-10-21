export type ErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'precondition'
  | 'too_large'
  | 'upgrade_required'
  | 'locked'
  | 'rate_limited'
  | 'unavailable'
  | 'bad_gateway'
  | 'internal'

export interface DomainErrorOptions {
  /** What the answer may tell the caller beyond the code (DOC-42 §3): an array for `validation_failed`, an object elsewhere. */
  details?: unknown
  /** Seconds, sent as `Retry-After` (429, 423, 503). */
  retryAfterSeconds?: number
}

/** Business error with a stable `code` for clients to handle; `kind` decides the HTTP status in the presentation layer. */
export class DomainError extends Error {
  readonly details?: unknown
  readonly retryAfterSeconds?: number

  constructor(
    readonly code: string,
    message: string,
    readonly kind: ErrorKind = 'validation',
    options: DomainErrorOptions = {},
  ) {
    super(message)
    this.name = new.target.name
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds
  }
}
