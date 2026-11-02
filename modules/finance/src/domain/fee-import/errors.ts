import { ConflictError, InvariantError, ValidationError } from '@core/kernel'

/** 400 `too_many_rows`: more than 5,000 data rows; no job is stored (DQ-05, DOC-21 §8). */
export class TooManyRowsError extends ValidationError {
  constructor() {
    super([{ path: 'file', code: 'too_many_rows', message: 'The file has more than 5,000 rows' }])
  }
}

/** 409 `import_expired`: the preview is older than 24 hours (DQ-51, FR-01.4). */
export class ImportExpiredError extends ConflictError {
  constructor() {
    super('import_expired', 'The preview expired')
  }
}

/** 409 `import_not_ready`: the job is not `validated`, e.g. a file with a `fail` rule (DQ-52). */
export class ImportNotReadyError extends ConflictError {
  constructor(status: string) {
    super('import_not_ready', 'The import cannot be committed', { details: { status } })
  }
}

/** 409 `import_stale`: the file or the units changed between the preview and the commit (DQ-50, DOC-21 §4.5). */
export class ImportStaleError extends ConflictError {
  constructor(rows: number) {
    super('import_stale', 'The data changed since the preview', { details: { rows } })
  }
}

/** 500: the write does not match the preview (DQ-80). Rolled back; the log line `import_integrity` raises the alert. */
export class ImportIntegrityError extends InvariantError {
  constructor(readonly reason: string) {
    super(`import_integrity: ${reason}`)
  }
}
