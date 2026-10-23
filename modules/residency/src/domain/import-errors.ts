import { ConflictError, InvariantError } from '@core/kernel'

/** 409 `import_expired`: the preview is older than 24 hours (DQ-51). */
export class ImportExpiredError extends ConflictError {
  constructor() {
    super('import_expired', 'The preview expired')
  }
}

/** 409 `import_not_ready`: the job is not `validated` (DQ-52). */
export class ImportNotReadyError extends ConflictError {
  constructor(status: string) {
    super('import_not_ready', 'The import cannot be committed', { details: { status } })
  }
}

/** 409 `import_stale`: the data changed between the preview and the commit (DQ-50). */
export class ImportStaleError extends ConflictError {
  constructor(rows: number) {
    super('import_stale', 'The data changed since the preview', { details: { rows } })
  }
}

/** 500 `internal_error`: the write does not match the preview (DQ-60). Rolled back; the log line `import_integrity` raises the alert. */
export class ImportIntegrityError extends InvariantError {
  constructor(readonly reason: string) {
    super(`import_integrity: ${reason}`)
  }
}
