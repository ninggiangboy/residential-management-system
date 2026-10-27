import {
  ConflictError,
  ForbiddenError,
  InvariantError,
  NotFoundError,
  PayloadTooLargeError,
  RuleViolationError,
  ValidationError,
} from '@core/kernel'

/** Why a file could not be used (DOC-42 §5.1: `file_not_verified`, `details[0].code`). `not_verified` is the attach of a file that is not `verified`, not the caller's, or already attached. */
export type FileNotVerifiedReason =
  | 'missing'
  | 'too_large'
  | 'empty'
  | 'wrong_type'
  | 'bad_content'
  | 'not_verified'

/** 422 `file_not_verified`. */
export class FileNotVerifiedError extends RuleViolationError {
  constructor(readonly reason: FileNotVerifiedReason) {
    super(reason, 'The file could not be used', '', 'file_not_verified')
  }
}

/** 413 `quota_exceeded`: a register that would pass the quota of the building (FR-40.1). */
export class QuotaExceededError extends PayloadTooLargeError {
  constructor(usedBytes: number, quotaBytes: number) {
    super('quota_exceeded', 'Storage is full', { details: { usedBytes, quotaBytes } })
  }
}

/** 400 `validation_failed`: the purpose is unknown, or the type or size is not allowed for it (DOC-37 §6.1). */
export class FileRejectedError extends ValidationError {
  constructor(path: 'purpose' | 'mime' | 'size' | 'module', code: string, message: string) {
    super([{ path, code, message }])
  }
}

/** 403: the caller's account kind or role may not register this purpose, or a system purpose was asked for. */
export class FilePurposeForbiddenError extends ForbiddenError {
  constructor() {
    super('forbidden', 'This account may not upload this kind of file')
  }
}

/** A call that needs the caller's transaction was made outside one, or the other way round (DOC-37 §3). */
export class FilesTransactionError extends InvariantError {}

/** 409 `gateway_in_use`: the receiving account, the driver or the status changes while an intent is active (FR-38.3). */
export class GatewayInUseError extends ConflictError {
  constructor() {
    super('gateway_in_use', 'Online payments are in progress')
  }
}

/** 409 `terms_version_superseded`: the version being accepted is no longer the latest of its kind (DOC-35 §9.3). */
export class TermsVersionSupersededError extends ConflictError {
  constructor(current: ReadonlyArray<{ kind: string; version: number; versionId: string }>) {
    super('terms_version_superseded', 'The terms were updated', { details: { current } })
  }
}

/**
 * 404 `not_found`: a demo operation aimed at a building that is not a demo building, or at an id that does not exist. The answer
 * does not tell the two apart and does not reveal that the endpoint exists for another building (DOC-36 §10.2, §10.4; BD-37, BD-42).
 */
export class DemoResetRefusedError extends NotFoundError {
  constructor() {
    super('not_found', 'Resource not found')
  }
}

/** 409 `demo_reset_running`: the advisory lock `job:demo_reset` is held by another reset (DOC-36 §10.4; BD-41). */
export class DemoResetRunningError extends ConflictError {
  constructor() {
    super('demo_reset_running', 'The demo is being reset')
  }
}
