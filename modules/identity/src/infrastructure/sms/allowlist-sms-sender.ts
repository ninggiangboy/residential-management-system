import type { Log } from '@core/kernel'
import type { SmsSender } from '../../application/ports'

/**
 * Sends only to the numbers of `SMS_ALLOWLIST` and logs `not_allowlisted` for any other, returning normally (DOC-26 §5.5): the
 * `staging` driver, so a test environment never texts a real resident by accident. `inner` is the provider adapter of P1-22;
 * until then the driver sends nothing real and logs the message like the console.
 */
export class AllowlistSmsSender implements SmsSender {
  private readonly allowed: ReadonlySet<string>

  constructor(
    private readonly inner: SmsSender,
    allowed: readonly string[],
    private readonly log: Log,
  ) {
    this.allowed = new Set(allowed)
  }

  async send(message: {
    to: string
    text: string
    requestId: string
  }): Promise<void | 'not_allowlisted'> {
    if (!this.allowed.has(message.to)) {
      this.log.warn(
        { event: 'auth.sms', outcome: 'not_allowlisted', requestId: message.requestId },
        'sms not sent (not on SMS_ALLOWLIST)',
      )
      return 'not_allowlisted'
    }
    return this.inner.send(message)
  }
}
