/**
 * The error reporter of the clients (DOC-55 §15, DR-192): the throttle and the cleaning of a report, with no I/O of its own. The
 * client passes `send`, which posts `POST /client-errors` (E-04) through the plain `fetch`: no authenticated fetcher, no refresh and
 * no retry, so a failing API cannot start a report storm. A report that is throttled, or whose `send` fails, is dropped.
 */

export type ClientErrorKind = 'crash' | 'unhandled_rejection' | 'render' | 'network'

/** The body of E-04: unknown keys are refused by the server, so this is the whole list. */
export interface ClientErrorBody {
  app: 'resident' | 'staff' | 'web'
  appVersion: string
  platform: 'ios' | 'android' | 'web'
  kind: ClientErrorKind
  screen?: string
  errorName: string
  message: string
  stack?: string
  requestId?: string
}

export interface ReporterOptions {
  app: ClientErrorBody['app']
  platform: ClientErrorBody['platform']
  appVersion: string
  /** Posts the body; its rejection is swallowed. */
  send: (body: ClientErrorBody) => Promise<unknown>
  /** A development build logs to the console and reports nothing (DOC-55 §15). */
  enabled?: boolean
  now?: () => number
}

export interface ReportInput {
  kind: ClientErrorKind
  error: unknown
  /** The route template (`/units/$unitId`), never the URL. */
  screen?: string
  /** The `X-Request-Id` of the failed call, or the reference shown on the error screen. */
  requestId?: string
}

/** At most this many reports a minute per app, and one per `(kind, errorName, screen)` per ten minutes (DR-192). */
export const REPORTS_PER_MINUTE = 5
export const SAME_REPORT_WINDOW_MS = 10 * 60_000
const MINUTE_MS = 60_000

export const MAX_MESSAGE = 500
export const MAX_STACK_BYTES = 4096
const MAX_NAME = 100
const MAX_SCREEN = 60
const MAX_REQUEST_ID = 64

/** An absolute URL loses its query and fragment; a bearer token loses its value. A message or a stack carries nothing else of the user. */
const URL_WITH_QUERY = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"`<>()]+)[?#][^\s'"`<>()]*/gi
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const PATH_WITH_QUERY = /((?:^|[\s('"`])\/[\w./~%-]*)\?[^\s'"`<>()]*/g

export function cleanText(text: string): string {
  return text
    .replace(URL_WITH_QUERY, '$1')
    .replace(PATH_WITH_QUERY, '$1')
    .replace(BEARER, 'Bearer [redacted]')
}

const encoder = new TextEncoder()

/** The longest prefix of `text` that fits `maxBytes` of UTF-8, never splitting a character. */
export function truncateBytes(text: string, maxBytes: number): string {
  if (encoder.encode(text).length <= maxBytes) return text
  let end = Math.min(text.length, maxBytes)
  while (end > 0 && encoder.encode(text.slice(0, end)).length > maxBytes) end--
  // A cut between the two halves of a surrogate pair would leave a lone half.
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return text.slice(0, end)
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text)

/** The class, the message and the stack of a thrown value; a value that is not an `Error` is named `NonError`. */
export function describeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error)
    return {
      name: error.name || 'Error',
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    }
  if (typeof error === 'string') return { name: 'NonError', message: error }
  return { name: 'NonError', message: 'A value that is not an Error was thrown' }
}

export function createErrorReporter(options: ReporterOptions) {
  const now = options.now ?? Date.now
  const sent: number[] = []
  const seen = new Map<string, number>()

  /** `true` when the report was handed to `send`; `false` when it was throttled or the reporter is off. */
  function report(input: ReportInput): boolean {
    const { name, message, stack } = describeError(input.error)
    const screen = input.screen ? clip(cleanText(input.screen), MAX_SCREEN) : undefined
    const errorName = clip(name, MAX_NAME) || 'Error'
    if (options.enabled === false) {
      console.error(`[report:${input.kind}]`, input.error)
      return false
    }
    const at = now()
    while (sent.length > 0 && at - (sent[0] as number) >= MINUTE_MS) sent.shift()
    if (sent.length >= REPORTS_PER_MINUTE) return false
    const key = `${input.kind}|${errorName}|${screen ?? ''}`
    const last = seen.get(key)
    if (last !== undefined && at - last < SAME_REPORT_WINDOW_MS) return false
    sent.push(at)
    seen.set(key, at)
    const body: ClientErrorBody = {
      app: options.app,
      appVersion: options.appVersion,
      platform: options.platform,
      kind: input.kind,
      ...(screen ? { screen } : {}),
      errorName,
      message: clip(cleanText(message), MAX_MESSAGE) || 'No message',
      ...(stack ? { stack: truncateBytes(cleanText(stack), MAX_STACK_BYTES) } : {}),
      ...(input.requestId ? { requestId: clip(input.requestId, MAX_REQUEST_ID) } : {}),
    }
    void options.send(body).catch(() => undefined)
    return true
  }

  return { report }
}

export type ErrorReporter = ReturnType<typeof createErrorReporter>
