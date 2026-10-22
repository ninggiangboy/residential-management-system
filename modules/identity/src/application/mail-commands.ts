import type { Clock, SecretBox } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import { IDENTITY_EVENTS, type MailKind, type MailRequestedPayload } from '../contracts'

/** The additional authenticated data of a command's secret: it opens only for this staff member and this kind (DR-117). */
export const mailAad = (staffId: string, kind: MailKind): string =>
  `identity.mail:${staffId}:${kind}`

export interface MailRecipient {
  id: string
  buildingId: string
  language: 'vi' | 'en'
}

/**
 * Writes `identity.mail_requested.v1` (DOC-09 §6.3). The command holds no address and no plaintext secret: the handler reads
 * the address from `staff_account` and opens `secretEnc` in memory, so a leaked outbox row is not a leaked link (DR-117).
 */
export class MailCommands {
  constructor(
    private readonly outbox: OutboxWriter,
    private readonly secretBox: SecretBox,
    private readonly clock: Clock,
  ) {}

  async request(
    to: MailRecipient,
    kind: MailKind,
    options: { secret?: string; params?: Record<string, string>; expiresAt?: Date } = {},
  ): Promise<void> {
    const now = this.clock.now()
    const payload: MailRequestedPayload = {
      buildingId: to.buildingId,
      staffId: to.id,
      kind,
      locale: to.language,
      params: options.params ?? {},
      secretEnc:
        options.secret === undefined
          ? null
          : await this.secretBox.seal(mailAad(to.id, kind), options.secret),
      expiresAt: options.expiresAt?.toISOString() ?? null,
    }
    await this.outbox.add([
      {
        type: IDENTITY_EVENTS.mailRequested,
        aggregateId: to.id,
        payload: { ...payload },
        occurredAt: now,
      },
    ])
  }
}
