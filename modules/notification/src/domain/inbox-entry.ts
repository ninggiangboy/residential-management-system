import type { Params, SourceKind, TemplateKey } from '@rms/shared-types'

/** The kind of account an entry or a device belongs to (DOC-17 §6.1). */
export type AccountKind = 'resident' | 'staff'

/** One recipient a plan was resolved to (DOC-31 §4.1 step 3). */
export interface InboxRecipient {
  readonly accountKind: AccountKind
  readonly accountId: string
  readonly unitId: string | null
}

/** One row to insert: the recipient plus the entry's own fields (DOC-17 §6.1, OPM-S13). */
export interface NewInboxEntry extends InboxRecipient {
  readonly id: string
  readonly templateKey: TemplateKey
  readonly params: Params
  readonly sourceKind: SourceKind
  readonly sourceId: string
  readonly dedupeId: string
}

/** One `notification.inbox_entry` as the inbox list reads it (DOC-31 §4.4, E-78). */
export interface InboxEntryRow {
  readonly id: string
  readonly templateKey: TemplateKey
  readonly params: Params
  readonly unitId: string | null
  readonly sourceKind: SourceKind
  readonly sourceId: string
  readonly createdAt: Date
  readonly readAt: Date | null
}

/** One keyset page of the inbox (DOC-31 §4.4): `nextCursor` is the last id shown, `null` at the end. */
export interface InboxPage {
  readonly items: readonly InboxEntryRow[]
  readonly nextCursor: string | null
}
