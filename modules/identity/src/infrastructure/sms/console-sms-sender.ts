import type { Log } from '@core/kernel'
import type { SmsSender } from '../../application/ports'

/**
 * Sends nothing: writes each message to the log, text and code included, for `local` and `test` (DOC-26 §5.5). It is the only
 * place where a code is logged; the boot guard refuses it in `production`.
 */
export class ConsoleSmsSender implements SmsSender {
  constructor(private readonly log: Log) {}

  async send(message: { to: string; text: string; requestId: string }): Promise<void> {
    this.log.info(
      { to: message.to, text: message.text, requestId: message.requestId },
      'sms not sent (SMS_DRIVER=console)',
    )
  }
}
