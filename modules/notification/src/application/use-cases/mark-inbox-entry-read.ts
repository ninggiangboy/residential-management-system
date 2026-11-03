import { NotFoundError } from '@core/kernel'
import type { ResidencyApi } from '@mod/residency/contracts'
import type { InboxEntryRepository } from '../../domain/inbox-entry-repository'
import type { InboxReader } from '../inbox-reader'

/**
 * E-178 and E-179 (DOC-31 §4.3, §4.4, DR-302): `read_at` is set on the caller's own visible entry. A `notice` entry is left to
 * the notice's own read (DR-51) and still answers 204. Zero rows is followed by an existence read: another account's entry and
 * an entry hidden by the unit filter are 404 `not_found`, never 403.
 */
export class MarkInboxEntryRead {
  constructor(
    private readonly entries: InboxEntryRepository,
    private readonly residency: Pick<ResidencyApi, 'activeUnitIds'>,
  ) {}

  async execute(reader: InboxReader, id: string): Promise<void> {
    const account = { kind: reader.kind, id: reader.accountId }
    if ((await this.entries.markRead(reader.scope, account, id)) > 0) return
    const activeUnitIds =
      reader.kind === 'resident' ? await this.residency.activeUnitIds(reader.accountId) : null
    if (!(await this.entries.exists(reader.scope, account, id, activeUnitIds)))
      throw new NotFoundError()
  }
}
