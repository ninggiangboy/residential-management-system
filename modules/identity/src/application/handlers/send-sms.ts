import type { Clock, Log, SecretBox } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import { createTranslator, type MessageKey } from '@rms/i18n-catalog'
import { IDENTITY_EVENTS, type SmsRequestedPayload } from '../../contracts'
import { ResidentAccount } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'
import type { SmsSender } from '../ports'
import { smsAad } from '../sms-commands'

/**
 * `identity.send_sms` (DOC-26 §5.4): turns `identity.sms_requested.v1` into a message. A command past its `expiresAt` returns
 * normally and sends nothing (FR-15.7, MC-15); a demo account gets no SMS (`skipped_demo`); the phone is read from
 * `resident_account` and the code is opened in memory and forgotten. A provider failure throws and the outbox retries, three
 * times at most (class `sms`). The inbox is `afterSideEffect`: a sent message cannot be rolled back.
 */
export class SendSmsHandler implements IntegrationEventHandler {
  readonly name = 'identity.send_sms'
  readonly eventType = IDENTITY_EVENTS.smsRequested

  constructor(
    private readonly residents: ResidentAccountRepository,
    private readonly secretBox: SecretBox,
    private readonly sender: SmsSender,
    private readonly inbox: InboxGuard,
    private readonly clock: Clock,
    private readonly logger: Log,
    /** `SMS_BRAND` and `APP_DOWNLOAD_URL`: the texts name them. */
    private readonly texts: { brand: string; appUrl: string },
  ) {}

  async handle(message: Envelope): Promise<void> {
    const command = message.payload as unknown as SmsRequestedPayload
    await this.inbox.afterSideEffect(message.id, this.name, () => this.send(command))
  }

  private async send(command: SmsRequestedPayload): Promise<void> {
    const { residents, secretBox, sender, clock, logger, texts } = this
    const log = (outcome: string, level: 'info' | 'warn' = 'info') =>
      logger[level](
        { event: 'auth.sms', kind: command.kind, outcome, accountId: command.accountId },
        'auth.sms',
      )
    if (new Date(command.expiresAt) <= clock.now()) return log('expired')

    const [record] = await residents.findByIds([command.accountId])
    // A deleted account has no phone to send to.
    if (!record || !new ResidentAccount(record).canSignIn) return log('skipped_unknown')
    if (record.isDemo) return log('skipped_demo', 'warn')

    const secret =
      command.secretEnc === null
        ? ''
        : await secretBox.open(smsAad(record.id, command.kind), command.secretEnc)
    const text = createTranslator(record.language)(`sms.${command.kind}` as MessageKey, {
      ...command.params,
      code: secret,
      brand: texts.brand,
      appUrl: texts.appUrl,
    })
    await sender.send({ to: record.phone, text, requestId: command.requestId })
    log('sent')
  }
}
