import type { Log } from '@core/kernel'
import type {
  ExpoMessage,
  ExpoReceipt,
  ExpoTicket,
  PushSender,
} from '../../application/push-sender'

/**
 * `PUSH_DRIVER=console`, the default in `local` and `test` (DOC-31 §6.3): it sends nothing, logs the rendered title and body
 * at `info` without the token, and answers `ok` tickets with fake ids, so the `push_receipts` job reads `ok` receipts. The
 * boot guard refuses it in `production` (NT-60).
 */
export class ConsolePushSender implements PushSender {
  private sent = 0

  constructor(private readonly logger: Log) {}

  async send(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    const tickets: ExpoTicket[] = []
    for (const message of messages) {
      this.sent++
      tickets.push({ status: 'ok', id: `console-${this.sent}` })
      this.logger.info(
        { event: 'push_sent', title: message.title, body: message.body },
        'push not sent (PUSH_DRIVER=console)',
      )
    }
    return tickets
  }

  async getReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
    const receipts: Record<string, ExpoReceipt> = {}
    for (const id of ids) receipts[id] = { status: 'ok' }
    return receipts
  }
}
