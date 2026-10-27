import {
  DomainError,
  type ErrorKind,
  RuleViolationError,
  UnavailableError,
  type ValidationDetail,
} from '@core/kernel'
import type { Logger } from '@core/telemetry'
import { ValueErrorType } from '@sinclair/typebox/errors'
import { Elysia, type ValidationError as ElysiaValidationError } from 'elysia'
import { errorCodes } from './error-codes'

const STATUS: Record<ErrorKind, number> = {
  validation: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition: 428,
  too_large: 413,
  upgrade_required: 426,
  locked: 423,
  rate_limited: 429,
  unavailable: 503,
  bad_gateway: 502,
  internal: 500,
}

/** What the handler puts in `set` for an error: the status, `Retry-After`, and the answer of DOC-42 §3. */
export interface ErrorAnswer {
  status: number
  code: string
  message: string
  details?: unknown
  retryAfterSeconds?: number
}

/** `constraint name → error`: a unique index that a legitimate race can hit (DOC-42 §4.2). One map per module. */
export type ConstraintErrors = Readonly<Record<string, () => DomainError>>

export interface ErrorHandlerOptions {
  logger: Logger
  constraintErrors?: ConstraintErrors
}

interface PgError {
  code?: unknown
  constraint_name?: unknown
}

/** SQLSTATE → the answer of DOC-42 §4.2. `undefined` = not a database error this table knows (an unmapped one is a 500). */
function databaseAnswer(
  error: PgError,
  constraintErrors: ConstraintErrors,
): ErrorAnswer | undefined {
  const sqlstate = error.code
  if (typeof sqlstate !== 'string' || !/^[0-9A-Z]{5}$/.test(sqlstate)) return undefined
  const busy = (): ErrorAnswer => ({
    status: 503,
    code: 'service_unavailable',
    message: 'Service unavailable',
    retryAfterSeconds: 1,
  })
  if (sqlstate === '23505') {
    const mapped =
      typeof error.constraint_name === 'string'
        ? constraintErrors[error.constraint_name]?.()
        : undefined
    return mapped ? answerOf(mapped) : undefined
  }
  if (['40001', '40P01', '55P03', '57014', '53300', '57P01'].includes(sqlstate)) return busy()
  if (sqlstate.startsWith('08')) return busy()
  return undefined
}

function answerOf(error: DomainError): ErrorAnswer {
  const status =
    error instanceof RuleViolationError ? 422 : error.kind === 'internal' ? 500 : STATUS[error.kind]
  // A 5xx never echoes the exception message or a detail (DOC-42 §2 rule 3, §4.3).
  if (status >= 500 && !(error instanceof UnavailableError) && error.kind !== 'bad_gateway')
    return { status: 500, code: 'internal_error', message: 'Internal server error' }
  return {
    status,
    code: error.code,
    message: error.message,
    details: status >= 500 ? undefined : error.details,
    retryAfterSeconds: error.retryAfterSeconds,
  }
}

const RULE_OF_TYPE: Partial<Record<ValueErrorType, string>> = {
  [ValueErrorType.ObjectRequiredProperty]: 'required',
  [ValueErrorType.ObjectAdditionalProperties]: 'unknown_key',
  [ValueErrorType.ObjectMinProperties]: 'min_properties',
  [ValueErrorType.StringMinLength]: 'min_length',
  [ValueErrorType.StringMaxLength]: 'max_length',
  [ValueErrorType.StringPattern]: 'pattern',
  [ValueErrorType.StringFormat]: 'format',
  [ValueErrorType.ArrayMinItems]: 'min_items',
  [ValueErrorType.ArrayMaxItems]: 'max_items',
  [ValueErrorType.IntegerMinimum]: 'minimum',
  [ValueErrorType.IntegerMaximum]: 'maximum',
  [ValueErrorType.NumberMinimum]: 'minimum',
  [ValueErrorType.NumberMaximum]: 'maximum',
  [ValueErrorType.Union]: 'type',
  [ValueErrorType.Literal]: 'enum',
}

interface TypeBoxIssue {
  type: number
  path: string
  message: string
  schema?: { minimum?: number; maximum?: number; enum?: unknown[] }
  value?: unknown
}

/** A value outside a `describedEnum` fails as the custom kind `UnionEnum`, whose schema lists the allowed values. */
const isEnumIssue = (issue: TypeBoxIssue) =>
  issue.type === ValueErrorType.Kind && Array.isArray(issue.schema?.enum)

/** Rule code of a schema violation (DOC-42 §5.2). A `t.Integer` fails as a union, so the bound is read from the schema. */
function ruleOf(issue: TypeBoxIssue): string {
  if (isEnumIssue(issue)) return 'enum'
  if (issue.type === ValueErrorType.Union && typeof issue.value === 'number') {
    const { minimum, maximum } = issue.schema ?? {}
    if (minimum !== undefined && issue.value < minimum) return 'minimum'
    if (maximum !== undefined && issue.value > maximum) return 'maximum'
  }
  return RULE_OF_TYPE[issue.type as ValueErrorType] ?? 'type'
}

/** `/lines/2/amount` → `lines[2].amount`; the whole body is `""`. */
const dotted = (pointer: string) =>
  pointer
    .split('/')
    .filter(Boolean)
    .reduce(
      (path, part) => (/^\d+$/.test(part) ? `${path}[${part}]` : path ? `${path}.${part}` : part),
      '',
    )

function validationDetails(error: ElysiaValidationError): ValidationDetail[] {
  const seen = new Set<string>()
  const details: ValidationDetail[] = []
  for (const issue of error.all as unknown as TypeBoxIssue[]) {
    const path = dotted(issue.path)
    const code = ruleOf(issue)
    const key = `${path}|${code}`
    if (seen.has(key)) continue
    seen.add(key)
    // Property 'a' is missing → required; a type error on the same path would only repeat it.
    const message = isEnumIssue(issue)
      ? `Expected one of: ${issue.schema?.enum?.join(', ')}`
      : issue.message
    details.push({ path, code, message })
  }
  // A missing property also reports its type error: keep the `required` one only.
  return details.filter(
    (d) =>
      d.code === 'required' || !details.some((o) => o.path === d.path && o.code === 'required'),
  )
}

function bodyOf(answer: ErrorAnswer) {
  return {
    error: {
      code: answer.code,
      message: answer.message,
      ...(answer.details === undefined ? {} : { details: answer.details }),
    },
  }
}

/**
 * Maps every thrown error to the answer of DOC-42 §3: `{ error: { code, message, details? } }`, with `X-Request-Id`
 * (set earlier), `Retry-After` on 429, 423 and 503, and `Cache-Control: no-store`. The log line of the request is
 * `requestLogPlugin`'s; this handler logs only what it cannot explain by the status (a 5xx with its cause).
 */
export const errorHandlerPlugin = ({ logger, constraintErrors = {} }: ErrorHandlerOptions) =>
  new Elysia({ name: 'error-handler' }).onError(
    { as: 'global' },
    ({ code, error, set, request }) => {
      const answer = resolve(code, error, constraintErrors)
      if (answer.status >= 500) {
        logger.error(
          { err: error, status: answer.status, errorCode: answer.code },
          'unhandled_error',
        )
      }
      errorCodes.set(request, answer.code)
      set.status = answer.status
      set.headers['cache-control'] = 'no-store'
      if (answer.retryAfterSeconds !== undefined)
        set.headers['retry-after'] = String(Math.max(1, Math.ceil(answer.retryAfterSeconds)))
      return bodyOf(answer)
    },
  )

function resolve(
  code: string | number,
  error: unknown,
  constraintErrors: ConstraintErrors,
): ErrorAnswer {
  if (error instanceof DomainError) return answerOf(error)
  switch (code) {
    case 'VALIDATION':
      return {
        status: 400,
        code: 'validation_failed',
        message: 'Some values are not valid.',
        details: validationDetails(error as ElysiaValidationError),
      }
    case 'NOT_FOUND':
      return { status: 404, code: 'not_found', message: 'Resource not found' }
    case 'PARSE':
      return { status: 400, code: 'malformed_request', message: 'The request could not be read.' }
    default: {
      const database = databaseAnswer(error as PgError, constraintErrors)
      return database ?? { status: 500, code: 'internal_error', message: 'Internal server error' }
    }
  }
}
