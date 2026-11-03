import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-17 §9.1: the replay buffer of the staff event stream (ADR-0024, DOC-52 §8). One row per outbox event the stream carries;
 * the unique `source_message_id` makes a repeated handler write nothing (DR-289). The table is scoped by `building_id`.
 */
export const realtime = pgSchema('realtime')

export const events = realtime.table(
  'events',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    sourceMessageId: uuid('source_message_id').notNull(),
    type: text().notNull(),
    targetAccountId: uuid('target_account_id'),
    targetRoles: text('target_roles').array(),
    closeSessionId: uuid('close_session_id'),
    data: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_events', columns: [t.id] }),
    unique('uq_events_source').on(t.sourceMessageId),
    index('ix_events_building_created').on(t.buildingId, t.createdAt),
    check('ck_events_id_v7', sql`uuid_extract_version(${t.id}) = 7`),
    check(
      'ck_events_type',
      sql`${t.type} IN ('inbox.created', 'ticket.created', 'ticket.changed', 'money_log.opened', 'export.ready', 'session.revoked')`,
    ),
    check('ck_events_target', sql`(${t.targetAccountId} IS NULL) <> (${t.targetRoles} IS NULL)`),
    check(
      'ck_events_roles',
      sql`${t.targetRoles} IS NULL OR (cardinality(${t.targetRoles}) >= 1 AND ${t.targetRoles} <@ ARRAY['admin', 'manager', 'technician', 'guard'])`,
    ),
    check(
      'ck_events_close',
      sql`(${t.closeSessionId} IS NOT NULL) = (${t.type} = 'session.revoked')`,
    ),
    check(
      'ck_events_data',
      sql`jsonb_typeof(${t.data}) = 'object' AND octet_length(${t.data}::text) <= 2048`,
    ),
  ],
)
