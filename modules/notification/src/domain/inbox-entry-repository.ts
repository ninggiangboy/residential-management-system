import type { BuildingScope } from '@rms/shared-types'
import type {
  AccountKind,
  InboxEntryRow,
  InboxPage,
  InboxRecipient,
  NewInboxEntry,
} from './inbox-entry'

/** The account an inbox read belongs to: a resident of E-78 or a staff member of E-76. */
export interface InboxAccount {
  readonly kind: AccountKind
  readonly id: string
}

/** The rows one insert statement returns: the entries that were actually written (OPM-S13). */
export type InsertedInboxEntry = InboxRecipient & { readonly id: string }

/**
 * `notification.inbox_entry` (DOC-17 §6.1, DOC-31 §4). A port in `domain/` (DOC-12 §4.5); the Drizzle adapter is in
 * `infrastructure/persistence/`. Every method carries the building scope, and `read_at` is always the database clock
 * (DOC-31 §4.3).
 */
export interface InboxEntryRepository {
  /** Inserts `entries` in pages of `page`, skipping the rows the dedupe key already holds (DOC-31 §4.1 step 4, OPM-S13). */
  insertMany(
    scope: BuildingScope,
    entries: readonly NewInboxEntry[],
    page: number,
  ): Promise<readonly InsertedInboxEntry[]>
  /** The caller's entries, newest first, keyset on `id`; `activeUnitIds` is §4.2's filter, `null` for staff (OPM-S14). */
  list(
    scope: BuildingScope,
    account: InboxAccount,
    activeUnitIds: readonly string[] | null,
    cursor: string | null,
    limit: number,
  ): Promise<InboxPage>
  /** The unread count of the visible entries, capped at `cap` for the bell (DOC-31 §4.4, OPM-S15). */
  countUnread(
    scope: BuildingScope,
    account: InboxAccount,
    activeUnitIds: readonly string[] | null,
    cap: number,
  ): Promise<number>
  /** Marks one entry read; never a `notice` entry, which `notices.notice_read.v1` owns (DOC-31 §4.3, OPM-S16). */
  markRead(scope: BuildingScope, account: InboxAccount, id: string): Promise<number>
  /** True when the entry is the caller's and visible under the unit filter (DOC-31 §4.4, E-178). */
  exists(
    scope: BuildingScope,
    account: InboxAccount,
    id: string,
    activeUnitIds: readonly string[] | null,
  ): Promise<boolean>
  /** Marks the caller's unread entries with `id <= upToId` read, notices included (DOC-31 §4.3, OPM-S17). */
  readAll(scope: BuildingScope, account: InboxAccount, upToId: string): Promise<number>
  /** Marks the `notice.published` entry of the caller and notice read (DOC-31 §4.3, OPM-S18). */
  markNoticeRead(scope: BuildingScope, account: InboxAccount, noticeId: string): Promise<number>
  /** Deletes up to `batch` entries older than `cutoff` across buildings (DOC-31 §4.5, OPM-S24); returns how many. */
  purgeOlderThan(cutoff: Date, batch: number): Promise<number>
  /** Deletes every entry of a building for the demo reset (DOC-36 §10.2). */
  deleteForBuilding(buildingId: string): Promise<number>
}
