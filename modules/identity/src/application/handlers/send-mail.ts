import type { Clock, Log, SecretBox } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import type { BuildingApi } from '@mod/building/contracts'
import { type CounterLabels, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { IDENTITY_EVENTS, type MailRequestedPayload } from '../../contracts'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { mailAad } from '../mail-commands'
import { actionLabel, renderMail } from '../mail-renderer'
import type { Mailer } from '../ports'

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

type SentOutcome = Exclude<CounterLabels['mail_sent_total']['outcome'], 'failed'>

/**
 * `identity.send_mail` (DOC-26 §5.4): turns `identity.mail_requested.v1` into a mail. A command past its `expiresAt` returns
 * normally and sends nothing; the address is read from `staff_account`, the secret is opened in memory and forgotten. A relay
 * failure throws and the outbox retries. The inbox is `afterSideEffect`: a sent mail cannot be rolled back. A staff member of a
 * demo building gets nothing: the command returns normally with the `warn` line `skipped_demo` (DOC-36 §9.2, BD-35).
 */
export class SendMailHandler implements IntegrationEventHandler {
  readonly name = 'identity.send_mail'
  readonly eventType = IDENTITY_EVENTS.mailRequested

  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly secretBox: SecretBox,
    private readonly mailer: Mailer,
    private readonly inbox: InboxGuard,
    private readonly clock: Clock,
    private readonly logger: Log,
    /** `ADMIN_BASE_URL`: the invite and reset links open there (DOC-26 §4.3). */
    private readonly adminBaseUrl: string,
    /** Whether the staff member's building is a demo building. */
    private readonly building: Pick<BuildingApi, 'isDemo'>,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const command = message.payload as unknown as MailRequestedPayload
    await this.inbox.afterSideEffect(message.id, this.name, () => this.send(message, command))
  }

  private async send(message: Envelope, command: MailRequestedPayload): Promise<void> {
    const { staffAccounts, secretBox, mailer, clock, logger, adminBaseUrl, metrics } = this
    const log = (outcome: SentOutcome, level: 'info' | 'warn' = 'info') => {
      metrics.inc('mail_sent_total', { outcome })
      logger[level](
        { event: 'auth.mail', kind: command.kind, outcome, staffId: command.staffId },
        'auth.mail',
      )
    }
    const expiresAt = command.expiresAt ? new Date(command.expiresAt) : null
    if (expiresAt && expiresAt <= clock.now()) return log('expired')

    const staff = await staffAccounts.findById(command.staffId)
    if (!staff) return log('skipped_unknown')
    if (await this.building.isDemo(staff.buildingId)) return log('skipped_demo', 'warn')
    const secret =
      command.secretEnc === null
        ? undefined
        : await secretBox.open(mailAad(staff.id, command.kind), command.secretEnc)
    const base = adminBaseUrl.replace(/\/$/, '')
    const lifetime = expiresAt ? expiresAt.getTime() - new Date(message.occurredAt).getTime() : 0
    const language = staff.language
    const mail = renderMail(command.kind, language, {
      name: staff.fullName,
      hours: Math.max(1, Math.round(lifetime / HOUR_MS)),
      minutes: Math.max(1, Math.round(lifetime / MINUTE_MS)),
      action: command.params.action ? actionLabel(command.params.action, language) : '',
      actorName: command.params.actorName ?? '',
      link:
        command.kind === 'staff_invite'
          ? `${base}/invite?token=${secret}`
          : `${base}/reset?token=${secret}`,
      code: secret ?? '',
    })
    try {
      await mailer.send({ to: staff.email, ...mail })
    } catch (error) {
      metrics.inc('mail_sent_total', { outcome: 'failed' })
      throw error
    }
    log('sent')
  }
}
