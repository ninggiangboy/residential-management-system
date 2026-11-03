import { type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { AccountKind, InboxEntryRow, InboxPage, NewInboxEntry } from '../../domain/inbox-entry'
import type {
  InboxAccount,
  InboxEntryRepository,
  InsertedInboxEntry,
} from '../../domain/inbox-entry-repository'
import { inboxEntry } from './schema'

/** A driver may hand a raw date back as a string. */
const toInstant = (value: Date | string): Date => (value instanceof Date ? value : new Date(value))

/** One row of `insertMany`'s `RETURNING` (OPM-S13). */
type InsertedRow = {
  readonly id: string
  readonly account_kind: string
  readonly account_id: string
  readonly unit_id: string | null
}

/** One `list` row before conversion (DOC-31 §4.4). */
type InboxRowRaw = {
  readonly id: string
  readonly template_key: string
  readonly params: unknown
  readonly unit_id: string | null
  readonly source_kind: string
  readonly source_id: string
  readonly created_at: Date | string
  readonly read_at: Date | string | null
}

const toRow = (row: InboxRowRaw): InboxEntryRow => ({
  id: row.id,
  templateKey: row.template_key as InboxEntryRow['templateKey'],
  params: row.params as InboxEntryRow['params'],
  unitId: row.unit_id,
  sourceKind: row.source_kind as InboxEntryRow['sourceKind'],
  sourceId: row.source_id,
  createdAt: toInstant(row.created_at),
  readAt: row.read_at === null ? null : toInstant(row.read_at),
})

/** The `unit_id IS NULL OR unit_id = ANY (...)` filter of DOC-31 §4.2; `null` is a staff read, with no filter. */
const unitFilter = (activeUnitIds: readonly string[] | null) =>
  activeUnitIds === null
    ? sql``
    : sql`AND (unit_id IS NULL OR unit_id = ANY (${sql.param(activeUnitIds)}::uuid[]))`

/**
 * `notification.inbox_entry` for DOC-31 §4: the deduped insert page (OPM-S13), the keyset list with the unit filter
 * (OPM-S14), the capped unread count (OPM-S15), the read statements (OPM-S16, S17, S18) and the two purges (OPM-S24).
 */
export class DrizzleInboxEntryRepository implements InboxEntryRepository {
  constructor(private readonly database: Database) {}

  /** DOC-31 §4.1 step 4: one `INSERT ... SELECT FROM unnest(...)` per page, the conflicts left out (OPM-S13). */
  async insertMany(
    scope: BuildingScope,
    entries: readonly NewInboxEntry[],
    page: number,
  ): Promise<readonly InsertedInboxEntry[]> {
    const inserted: InsertedInboxEntry[] = []
    for (let start = 0; start < entries.length; start += page) {
      const chunk = entries.slice(start, start + page)
      const rows = await this.database.executor.execute<InsertedRow>(sql`
        INSERT INTO notification.inbox_entry
          (id, building_id, account_kind, account_id, unit_id, template_key, params, source_kind, source_id, dedupe_id)
        SELECT r.id, ${scope.buildingId}::uuid, r.account_kind, r.account_id, r.unit_id, r.template_key,
               (r.params)::jsonb, r.source_kind, r.source_id, r.dedupe_id
          FROM unnest(
                 ${sql.param(chunk.map((entry) => entry.id))}::uuid[],
                 ${sql.param(chunk.map((entry) => entry.accountKind))}::text[],
                 ${sql.param(chunk.map((entry) => entry.accountId))}::uuid[],
                 ${sql.param(chunk.map((entry) => entry.unitId))}::uuid[],
                 ${sql.param(chunk.map((entry) => entry.templateKey))}::text[],
                 ${sql.param(chunk.map((entry) => JSON.stringify(entry.params)))}::text[],
                 ${sql.param(chunk.map((entry) => entry.sourceKind))}::text[],
                 ${sql.param(chunk.map((entry) => entry.sourceId))}::uuid[],
                 ${sql.param(chunk.map((entry) => entry.dedupeId))}::uuid[]
               ) AS r(id, account_kind, account_id, unit_id, template_key, params, source_kind, source_id, dedupe_id)
        ON CONFLICT ON CONSTRAINT uq_inbox_entry_dedupe DO NOTHING
        RETURNING id, account_kind, account_id, unit_id`)
      for (const row of rows)
        inserted.push({
          id: row.id,
          accountKind: row.account_kind as AccountKind,
          accountId: row.account_id,
          unitId: row.unit_id,
        })
    }
    return inserted
  }

  /** DOC-31 §4.4 / OPM-S14: the caller's visible entries, newest first, keyset on `id`. */
  async list(
    scope: BuildingScope,
    account: InboxAccount,
    activeUnitIds: readonly string[] | null,
    cursor: string | null,
    limit: number,
  ): Promise<InboxPage> {
    const keyset = cursor === null ? sql`` : sql`AND id < ${cursor}::uuid`
    const rows = await this.database.executor.execute<InboxRowRaw>(sql`
      SELECT id, template_key, params, unit_id, source_kind, source_id, created_at, read_at
        FROM notification.inbox_entry
       WHERE building_id = ${scope.buildingId}::uuid
         AND account_kind = ${account.kind}
         AND account_id = ${account.id}::uuid
         ${unitFilter(activeUnitIds)}
         ${keyset}
       ORDER BY id DESC
       LIMIT ${limit + 1}`)
    const items = rows.slice(0, limit).map(toRow)
    const last = items.at(-1)
    return { items, nextCursor: rows.length > limit && last ? last.id : null }
  }

  /** DOC-31 §4.4 / OPM-S15: the unread count of the visible entries, capped for the bell. */
  async countUnread(
    scope: BuildingScope,
    account: InboxAccount,
    activeUnitIds: readonly string[] | null,
    cap: number,
  ): Promise<number> {
    const [row] = await this.database.executor.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
        FROM (SELECT 1 FROM notification.inbox_entry
               WHERE building_id = ${scope.buildingId}::uuid
                 AND account_kind = ${account.kind}
                 AND account_id = ${account.id}::uuid
                 AND read_at IS NULL
                 ${unitFilter(activeUnitIds)}
               LIMIT ${cap}) x`)
    return row?.count ?? 0
  }

  /** DOC-31 §4.3 / OPM-S16: `read_at = now()`; a `notice` entry is left to `markNoticeRead`. */
  async markRead(scope: BuildingScope, account: InboxAccount, id: string): Promise<number> {
    const rows = await this.database.executor
      .update(inboxEntry)
      .set({ readAt: sql`now()` })
      .where(
        and(
          inBuilding(inboxEntry, scope),
          eq(inboxEntry.accountKind, account.kind),
          eq(inboxEntry.accountId, account.id),
          eq(inboxEntry.id, id),
          isNull(inboxEntry.readAt),
          ne(inboxEntry.sourceKind, 'notice'),
        ),
      )
      .returning({ id: inboxEntry.id })
    return rows.length
  }

  /** DOC-31 §4.4 / E-178: whether the entry is the caller's and visible under the unit filter. */
  async exists(
    scope: BuildingScope,
    account: InboxAccount,
    id: string,
    activeUnitIds: readonly string[] | null,
  ): Promise<boolean> {
    const visible =
      activeUnitIds === null
        ? undefined
        : or(isNull(inboxEntry.unitId), inArray(inboxEntry.unitId, [...activeUnitIds]))
    const [row] = await this.database.executor
      .select({ id: inboxEntry.id })
      .from(inboxEntry)
      .where(
        and(
          inBuilding(inboxEntry, scope),
          eq(inboxEntry.accountKind, account.kind),
          eq(inboxEntry.accountId, account.id),
          eq(inboxEntry.id, id),
          visible,
        ),
      )
      .limit(1)
    return row !== undefined
  }

  /** DOC-31 §4.3 / OPM-S17: every unread entry of the caller with `id <= upToId`, notices included. */
  async readAll(scope: BuildingScope, account: InboxAccount, upToId: string): Promise<number> {
    const rows = await this.database.executor
      .update(inboxEntry)
      .set({ readAt: sql`now()` })
      .where(
        and(
          inBuilding(inboxEntry, scope),
          eq(inboxEntry.accountKind, account.kind),
          eq(inboxEntry.accountId, account.id),
          isNull(inboxEntry.readAt),
          lte(inboxEntry.id, upToId),
        ),
      )
      .returning({ id: inboxEntry.id })
    return rows.length
  }

  /** DOC-31 §4.3 / OPM-S18: the `notice.published` entry of the caller and notice, from the database clock. */
  async markNoticeRead(
    scope: BuildingScope,
    account: InboxAccount,
    noticeId: string,
  ): Promise<number> {
    const rows = await this.database.executor
      .update(inboxEntry)
      .set({ readAt: sql`now()` })
      .where(
        and(
          inBuilding(inboxEntry, scope),
          eq(inboxEntry.accountKind, account.kind),
          eq(inboxEntry.accountId, account.id),
          eq(inboxEntry.templateKey, 'notice.published'),
          eq(inboxEntry.sourceId, noticeId),
          isNull(inboxEntry.readAt),
        ),
      )
      .returning({ id: inboxEntry.id })
    return rows.length
  }

  /**
   * DOC-31 §4.5 / OPM-S24: the weekly `inbox_purge` deletes up to `batch` entries older than `cutoff`; a full batch
   * means call again.
   */
  // scope-ok: a cross-building retention sweep, not a read of one building (DOC-20 §5)
  async purgeOlderThan(cutoff: Date, batch: number): Promise<number> {
    // scope-ok: the sweep spans buildings by design (DOC-31 §4.5)
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.inbox_entry
       WHERE id = ANY(ARRAY(
         SELECT id FROM notification.inbox_entry
          WHERE created_at < ${cutoff.toISOString()}::timestamptz
          ORDER BY created_at
          LIMIT ${batch}))`)
    return deleted.count
  }

  /** DOC-36 §10.2: the demo reset drops every entry of the building. */
  // scope-ok: the demo reset names the building itself (DOC-36 §10.2)
  async deleteForBuilding(buildingId: string): Promise<number> {
    const deleted = await this.database.executor.execute(sql`
      DELETE FROM notification.inbox_entry
       WHERE building_id = ${buildingId}::uuid`)
    return deleted.count
  }
}
