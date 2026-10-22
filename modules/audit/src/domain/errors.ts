import { InvariantError } from '@core/kernel'

/** `record` was called with no open transaction (DOC-35 §3.1, AD-04). Answered 500: a programming mistake. */
export class NoTransactionError extends InvariantError {
  constructor() {
    super(
      'AuditApi.record must be called inside UnitOfWork.run (the audit row belongs to the mutation)',
    )
  }
}

/** The action is not declared by the module of its first segment (DOC-35 §3.3, AD-05). */
export class UndeclaredAuditActionError extends InvariantError {
  constructor(action: string) {
    super(`audit action ${action} is not declared by its module (auditActions in the manifest)`)
  }
}

/** A field of the global deny-list was recorded with its plain value (DOC-35 §3.4, AD-09). */
export class UnmaskedAuditFieldError extends InvariantError {
  constructor(field: string) {
    super(`audit field ${field} holds a personal or secret value and must be masked`)
  }
}

/** `changes` plus `details` are over the 32,768-byte limit (DOC-35 §3.4, AD-12). */
export class AuditEntryTooLargeError extends InvariantError {
  constructor(bytes: number, limit: number) {
    super(`audit entry is ${bytes} bytes, over the limit of ${limit}; use the bulk form`)
  }
}

/** The action name breaks `<module>.<object>.<verb>` (the `CHECK` of DOC-17 §2). */
export class MalformedAuditActionError extends InvariantError {
  constructor(action: string) {
    super(`audit action ${action} is not <module>.<object>.<verb> or pii.read`)
  }
}
