import { requestContext } from '@core/context'
import pino from 'pino'

export type Logger = pino.Logger

export interface LoggerOptions {
  /** `api`, `worker` or both joined with a comma: the `service` field of every line (DOC-40 §3.1). */
  service?: string
  /** Where the lines go; stdout when absent. Tests pass a stream to read what was written. */
  destination?: pino.DestinationStream
}

/** Keys that must never reach a log line (DOC-42 §8.3, §8.4); a net, the rule is not to pass them. */
const SECRET_KEYS = [
  'password',
  'code',
  'otp',
  'token',
  'refreshToken',
  'secrets',
  'secretEnc',
  'cccd',
  'stepUp',
]

const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  // `code` stays loggable at the top level (the `error.code` of a request line); only a nested one is a secret.
  ...SECRET_KEYS.filter((key) => key !== 'code'),
  ...SECRET_KEYS.map((key) => `*.${key}`),
]

const MAX_LINE_FIELD = 16 * 1024
const MAX_CAUSE_DEPTH = 3

interface PgLike {
  code?: unknown
  constraint_name?: unknown
  table_name?: unknown
  column_name?: unknown
}

const SQLSTATE = /^[0-9A-Z]{5}$/

/**
 * A database error is logged by its SQLSTATE, constraint, table and column only: the PostgreSQL `detail` and `where` carry
 * the values of the failing row (a phone number, DOC-42 §8.3).
 */
function sqlFields(err: PgLike): Record<string, string> | undefined {
  if (typeof err.code !== 'string' || !SQLSTATE.test(err.code)) return undefined
  const fields: Record<string, string> = { sqlstate: err.code }
  if (typeof err.constraint_name === 'string') fields.constraint = err.constraint_name
  if (typeof err.table_name === 'string') fields.table = err.table_name
  if (typeof err.column_name === 'string') fields.column = err.column_name
  return fields
}

interface SerializedError {
  type: string
  message: string
  stack?: string
  code?: string
  sql?: Record<string, string>
  cause?: SerializedError
}

/** The `err` field of a line: type, message, stack, the SQL facts and the cause chain to depth 3. */
export function serializeError(value: unknown, depth = 0): SerializedError {
  if (!(value instanceof Error)) return { type: typeof value, message: String(value).slice(0, 500) }
  const out: SerializedError = {
    type: value.name,
    message: value.message.slice(0, MAX_LINE_FIELD),
  }
  if (value.stack) out.stack = value.stack.slice(0, MAX_LINE_FIELD)
  const sql = sqlFields(value as PgLike)
  if (sql) out.sql = sql
  else if (typeof (value as unknown as { code?: unknown }).code === 'string')
    out.code = (value as unknown as { code: string }).code
  const cause = (value as { cause?: unknown }).cause
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) out.cause = serializeError(cause, depth + 1)
  return out
}

export function createLogger(level: string, options: LoggerOptions = {}): Logger {
  return pino(
    {
      level,
      base: options.service ? { service: options.service } : {},
      timestamp: pino.stdTimeFunctions.isoTime,
      // `level` as a word (`info`), the way DOC-40 §3.1 and the Loki stage read it.
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: serializeError },
      redact: { paths: REDACT, censor: '[redacted]' },
      // Every log line is automatically tagged with the requestId/correlationId of the current context.
      mixin: () => {
        const ctx = requestContext.get()
        return ctx ? { requestId: ctx.requestId, correlationId: ctx.correlationId } : {}
      },
    },
    options.destination,
  )
}
