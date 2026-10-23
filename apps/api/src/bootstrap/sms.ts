import type { Log } from '@core/kernel'
import { AllowlistSmsSender, ConsoleSmsSender, type SmsSender } from '@mod/identity'
import type { Config } from './config'

/**
 * The `provider` driver before the adapter exists. The process still boots (the configuration of production is valid), and a
 * send fails loudly: the outbox retries, then the command is dead, and the provider probe turns that into 503 `sms_unavailable`
 * (DOC-26 §5.4), so no resident waits for a code that was never sent.
 */
class NoProviderSender implements SmsSender {
  async send(): Promise<void> {
    throw new Error('SMS_DRIVER=provider has no adapter before P1-22 (DR-68)')
  }
}

/**
 * The SMS sender `SMS_DRIVER` asks for (DOC-26 §5.5): `console` logs the message (local and test), `allowlist` sends only to the
 * numbers of `SMS_ALLOWLIST` (staging) and `provider` is the adapter of the carrier that the Owner picks (DR-68). The adapter is
 * P1-22: until then the `allowlist` driver wraps the console, so a listed number is logged and none is texted. The production
 * rule of the configuration (`SMS_DRIVER` must be `provider`) already keeps the other two out of production.
 */
export function createSmsSenderFor(config: Config, log: Log): SmsSender {
  const { SMS_DRIVER, SMS_ALLOWLIST } = config.drivers
  const console = new ConsoleSmsSender(log)
  if (SMS_DRIVER === 'console') return console
  if (SMS_DRIVER === 'allowlist') return new AllowlistSmsSender(console, SMS_ALLOWLIST, log)
  return new NoProviderSender()
}
