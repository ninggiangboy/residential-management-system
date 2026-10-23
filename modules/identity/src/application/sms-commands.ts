import type { Clock, IdGenerator, SecretBox } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import { IDENTITY_EVENTS, type SmsKind, type SmsRequestedPayload } from '../contracts'
import type { ResidentAccountRecord } from '../domain/resident-account'

/** The additional authenticated data of a command's secret: it opens only for this account and this kind (DR-117). */
export const smsAad = (accountId: string, kind: SmsKind): string =>
  `identity.sms:${accountId}:${kind}`

/**
 * Writes `identity.sms_requested.v1` (DOC-09 §6.3). The command holds no phone and no plaintext code: the handler reads the
 * phone from `resident_account` and opens `secretEnc` in memory, so a leaked outbox row is not a leaked code (DR-117, MC-14).
 */
export class SmsCommands {
  constructor(
    private readonly outbox: OutboxWriter,
    private readonly secretBox: SecretBox,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async request(
    to: Pick<ResidentAccountRecord, 'id' | 'language'>,
    kind: SmsKind,
    options: { secret?: string; params?: Record<string, string>; expiresAt: Date },
  ): Promise<void> {
    const requestId = this.ids.next()
    const payload: SmsRequestedPayload = {
      buildingId: null,
      requestId,
      accountId: to.id,
      kind,
      locale: to.language,
      params: options.params ?? {},
      secretEnc:
        options.secret === undefined
          ? null
          : await this.secretBox.seal(smsAad(to.id, kind), options.secret),
      expiresAt: options.expiresAt.toISOString(),
    }
    await this.outbox.add([
      {
        type: IDENTITY_EVENTS.smsRequested,
        aggregateId: requestId,
        payload: { ...payload },
        occurredAt: this.clock.now(),
      },
    ])
  }
}
