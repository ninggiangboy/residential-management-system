import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import type { InboxEntryRepository } from '../../domain/inbox-entry-repository'
import { scopeOf } from '../scope-of'

/**
 * `notices.notice_read.v1` (DOC-09 §6.6, DOC-31 §4.3): the first open of a notice marks the `notice.published` entry of that
 * account read, from the database clock and never from the event's `readAt`. The notices module is built in P4, so the payload
 * type is declared here (structural, as the consumer). A second delivery changes nothing (NT-37, OPM-S18).
 */
interface NoticeReadPayload {
  buildingId: string
  noticeId: string
  accountKind: 'resident' | 'staff'
  accountId: string
  readAt: string
}

export class MarkReadOnNoticeReadHandler implements IntegrationEventHandler {
  readonly name = 'notification.mark_read_on_notices_notice_read'
  readonly eventType = 'notices.notice_read.v1'

  constructor(
    private readonly entries: InboxEntryRepository,
    private readonly inbox: InboxGuard,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const event = message.payload as unknown as NoticeReadPayload
    await this.inbox.transactional(message.id, this.name, async () => {
      await this.entries.markNoticeRead(
        scopeOf(event.buildingId),
        { kind: event.accountKind, id: event.accountId },
        event.noticeId,
      )
    })
  }
}
