import type { DomainEvent } from '@core/kernel'
import type { IdentityApi } from '@mod/identity/contracts'
import type { ResidencyApi } from '@mod/residency/contracts'

/**
 * The outbox port `CreateInboxEntries` uses to append its follow-up messages inside the open transaction, typed the way the
 * finance use cases type theirs (`OutboxWriter`, `publish-fee-batch.ts`): the inbox row, the entries and these messages commit
 * together (DOC-31 §4.1 steps 5–6, §8, DOC-09 §4.3, ADR-0009). `add([])` writes nothing.
 */
export interface NotificationOutbox {
  add(events: DomainEvent[]): Promise<void>
}

/** The contract reads of DOC-31 §4.1 step 3, narrowed to the calls the resolver makes (DOC-31 §2.3, DOC-09 §7.2, §7.3). */
export interface NotificationRecipients {
  residency: Pick<ResidencyApi, 'listRecipients' | 'getMembership'>
  identity: Pick<IdentityApi, 'listActiveStaff' | 'getStaff'>
}
