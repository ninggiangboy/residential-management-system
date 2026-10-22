import { sql } from 'drizzle-orm'
import {
  check,
  index,
  inet,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-17 §2. The table is append-only for the runtime role (`rms_app` holds `SELECT` and `INSERT` only, DOC-19) and, as a
 * second layer, by a trigger that the second migration adds. `retention_class` is generated from `action`, so no use case can
 * mislabel a row; the monthly `audit.purge` selects on it (DR-110).
 */
export const audit = pgSchema('audit')

export const auditLog = audit.table(
  'audit_log',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id').notNull(),
    changes: jsonb('changes').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    retentionClass: text('retention_class').generatedAlwaysAs(
      sql`CASE WHEN action LIKE 'finance.%' THEN 'finance' ELSE 'standard' END`,
    ),
  },
  (t) => [
    primaryKey({ name: 'pk_audit_log', columns: [t.id] }),
    check('ck_audit_log_actor_kind', sql`${t.actorKind} IN ('staff', 'system')`),
    check('ck_audit_log_actor', sql`(${t.actorKind} = 'system') = (${t.actorId} IS NULL)`),
    check('ck_audit_log_role', sql`(${t.actorKind} = 'staff') = (${t.actorRole} IS NOT NULL)`),
    check('ck_audit_log_action', sql`${t.action} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    check('ck_audit_log_changes', sql`jsonb_typeof(${t.changes}) = 'array'`),
    check('ck_audit_log_details', sql`jsonb_typeof(${t.details}) = 'object'`),
    index('ix_audit_log_building_at').on(
      t.buildingId,
      t.at.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('ix_audit_log_building_object').on(
      t.buildingId,
      t.objectType,
      t.objectId,
      t.at.desc().nullsFirst(),
    ),
    index('ix_audit_log_building_actor')
      .on(t.buildingId, t.actorId, t.at.desc().nullsFirst())
      .where(sql`${t.actorId} IS NOT NULL`),
    index('ix_audit_log_purge').on(t.retentionClass, t.at),
  ],
)
