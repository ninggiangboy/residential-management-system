import type { Log } from '@core/kernel'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import type { IdentityConfig } from '../config'
import type { RateLimiter } from '../ports'

type ClientApp = 'resident' | 'staff' | 'web'
type ClientErrorKind = 'crash' | 'unhandled_rejection' | 'render' | 'network'

/** The body of `POST /client-errors` after validation (DOC-42 §10). */
export interface ClientErrorReport {
  app: ClientApp
  appVersion: string
  platform: 'ios' | 'android' | 'web'
  kind: ClientErrorKind
  screen: string | null
  errorName: string
  message: string
  stack: string | null
  requestId: string | null
}

export interface ReportClientErrorInput {
  report: ClientErrorReport
  /** The bucket IP of the caller (DOC-39 §5.3). */
  ip: string
  /** Read from a valid bearer token; `null` for none or an invalid one. */
  account: { kind: 'staff' | 'resident'; id: string } | null
}

const MINUTE_SECONDS = 60
const HOUR_SECONDS = 3600
const BULLET = '•'

/**
 * A phone-shaped run of digits (8 to 15 digits, a leading `+` and the usual separators) is the only personal value a message or
 * a stack is likely to carry. It becomes `+84•••••567` or `•••••567`, as the audit log masks a phone (DOC-35 §3.4).
 */
const PHONE = /\+?\d[\d\s.()-]{6,}\d/g

export function maskPhones(text: string): string {
  return text.replace(PHONE, (found) => {
    const digits = found.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) return found
    const last = digits.slice(-3)
    return found.startsWith('+')
      ? `+${digits.slice(0, digits.startsWith('84') ? 2 : 3)}${BULLET.repeat(5)}${last}`
      : `${BULLET.repeat(5)}${last}`
  })
}

/**
 * `POST /client-errors` (E-04, DOC-42 §10, DR-103): the apps report a crash because there is no hosted tracker. Nothing is stored:
 * one `warn` line `client_error` carries the report, with a phone masked in the message and the stack. Two buckets bound what a
 * crash loop or an abuser can write to the log, 10 a minute per IP and 30 an hour per signed-in account; a refusal is 429
 * `rate_limited` and the app drops the report. The IP bucket is spent first, whatever the outcome.
 */
export class ReportClientError {
  constructor(
    private readonly ipLimiter: RateLimiter,
    private readonly accountLimiter: RateLimiter,
    private readonly logger: Log,
    private readonly config: Pick<
      IdentityConfig,
      'clientErrorsPerMinutePerIp' | 'clientErrorsPerHourPerAccount'
    >,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute({ report, ip, account }: ReportClientErrorInput): Promise<void> {
    await this.ipLimiter.take({
      key: `client_errors:ip:${ip}`,
      capacity: this.config.clientErrorsPerMinutePerIp,
      perSeconds: MINUTE_SECONDS,
    })
    if (account)
      await this.accountLimiter.take({
        key: `client_errors:account:${account.id}`,
        capacity: this.config.clientErrorsPerHourPerAccount,
        perSeconds: HOUR_SECONDS,
      })
    this.metrics.inc('client_errors_total', { app: report.app, kind: report.kind })
    this.logger.warn(
      {
        event: 'client_error',
        app: report.app,
        appVersion: report.appVersion,
        platform: report.platform,
        kind: report.kind,
        screen: report.screen,
        errorName: report.errorName,
        message: maskPhones(report.message),
        stack: report.stack === null ? null : maskPhones(report.stack),
        clientRequestId: report.requestId,
        accountKind: account?.kind ?? null,
        accountId: account?.id ?? null,
      },
      'client_error',
    )
  }
}
