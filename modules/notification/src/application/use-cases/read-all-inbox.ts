import type { ResidencyApi } from '@mod/residency/contracts'
import { INBOX_UNREAD_CAP } from '@rms/shared-types'
import type { InboxEntryRepository } from '../../domain/inbox-entry-repository'
import type { InboxReader } from '../inbox-reader'

/**
 * E-77 and E-79 (DOC-31 §4.3, §4.4): marks the caller's unread entries with `id <= upToId` read, notices and hidden entries
 * included. An entry created after `upToId` stays unread. A second call answers `updated: 0`.
 */
export class ReadAllInbox {
  constructor(
    private readonly entries: InboxEntryRepository,
    private readonly residency: Pick<ResidencyApi, 'activeUnitIds'>,
  ) {}

  async execute(
    reader: InboxReader,
    upToId: string,
  ): Promise<{ updated: number; unreadCount: number }> {
    const account = { kind: reader.kind, id: reader.accountId }
    const updated = await this.entries.readAll(reader.scope, account, upToId)
    const activeUnitIds =
      reader.kind === 'resident' ? await this.residency.activeUnitIds(reader.accountId) : null
    const unreadCount = await this.entries.countUnread(
      reader.scope,
      account,
      activeUnitIds,
      INBOX_UNREAD_CAP,
    )
    return { updated, unreadCount }
  }
}
