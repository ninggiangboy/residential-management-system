import { DomainError, type DomainErrorOptions } from './domain-errors'

export { DomainError }

/** One violated rule or schema constraint of a `validation_failed` answer (DOC-42 §3). */
export interface ValidationDetail {
  /** Dotted path with array indexes (`lines[2].amount`); `""` for the whole body. */
  path: string
  code: string
  message: string
}

export class NotFoundError extends DomainError {
  constructor(code = 'not_found', message = 'Resource not found', options?: DomainErrorOptions) {
    super(code, message, 'not_found', options)
  }
}

export class ConflictError extends DomainError {
  constructor(code = 'conflict', message = 'Conflict', options?: DomainErrorOptions) {
    super(code, message, 'conflict', options)
  }
}

export class UnauthorizedError extends DomainError {
  constructor(code = 'unauthorized', message = 'Unauthorized', options?: DomainErrorOptions) {
    super(code, message, 'unauthorized', options)
  }
}

export class ForbiddenError extends DomainError {
  constructor(code = 'forbidden', message = 'Forbidden', options?: DomainErrorOptions) {
    super(code, message, 'forbidden', options)
  }
}

/** The request is invalid in itself: schema, limits, formats. Answered 400 (DOC-42 §4.1). */
export class ValidationError extends DomainError {
  constructor(
    details: readonly ValidationDetail[] = [],
    code = 'validation_failed',
    message = 'Invalid input',
  ) {
    super(code, message, 'validation', { details })
  }
}

/** Well-formed values that a business rule refuses. Answered 422; the code stays `validation_failed` (DR-127). */
export class RuleViolationError extends DomainError {
  constructor(rule: string, message = 'A business rule refused the request', path = '') {
    super('validation_failed', message, 'validation', {
      details: [{ path, code: rule, message }] satisfies ValidationDetail[],
    })
  }
}

/** An edit of a versioned resource without `If-Match`. */
export class PreconditionRequiredError extends DomainError {
  constructor(code = 'precondition_required', message = 'If-Match is required') {
    super(code, message, 'precondition')
  }
}

export class PayloadTooLargeError extends DomainError {
  constructor(
    code = 'payload_too_large',
    message = 'Payload too large',
    options?: DomainErrorOptions,
  ) {
    super(code, message, 'too_large', options)
  }
}

/** `X-App-Version` below the minimum. */
export class UpgradeRequiredError extends DomainError {
  constructor(minVersion: string, storeUrl?: string) {
    super('upgrade_required', 'The app must be updated', 'upgrade_required', {
      details: { minVersion, ...(storeUrl ? { storeUrl } : {}) },
    })
  }
}

/** A staff account in its temporary lock. */
export class LockedError extends DomainError {
  constructor(retryAfterSeconds: number) {
    super('account_locked', 'The account is locked', 'locked', {
      details: { retryAfter: retryAfterSeconds },
      retryAfterSeconds,
    })
  }
}

/** A bucket is empty. */
export class RateLimitedError extends DomainError {
  constructor(scope: string, retryAfterSeconds: number) {
    super('rate_limited', 'Too many requests', 'rate_limited', {
      details: { scope },
      retryAfterSeconds,
    })
  }
}

/** A dependency the request needs is down or saturated. */
export class UnavailableError extends DomainError {
  constructor(
    code = 'service_unavailable',
    message = 'Service unavailable',
    retryAfterSeconds = 1,
  ) {
    super(code, message, 'unavailable', { retryAfterSeconds })
  }
}

/** The payment provider failed or refused the request. */
export class BadGatewayError extends DomainError {
  constructor(code = 'bad_gateway', message = 'Bad gateway') {
    super(code, message, 'bad_gateway')
  }
}

/** A programming error: no transaction open, an undeclared audit action, a missing mapping. Answered 500 with no detail. */
export class InvariantError extends DomainError {
  constructor(message: string) {
    super('internal_error', message, 'internal')
  }
}

/** Optimistic lock failed: the aggregate was changed by another request. `current` is the fresh resource when the caller may see it. */
export class VersionConflictError extends ConflictError {
  constructor(current?: unknown) {
    super(
      'version_conflict',
      'The resource was modified by someone else, please reload',
      current === undefined ? undefined : { details: { current } },
    )
  }
}
