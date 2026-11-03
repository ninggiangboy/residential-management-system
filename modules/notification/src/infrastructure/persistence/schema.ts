import { inboxTable, outboxTable } from '@core/messaging'
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
 * DOC-17 §6: the three tables of the `notification` module (DR-52, DR-53). Names of tables, columns, constraints and
 * indexes are DOC-17's: `inbox_entry` carries `building_id` and is scoped, while `device_token` and `push_ticket` belong
 * to a device of an account that spans buildings and have no `building_id` (DOC-14 §5.3).
 */
export const notification = pgSchema('notification')

/** One thing one account was told about, for one unit or for none (DOC-17 §6.1, DR-299). */
export const inboxEntry = notification.table(
  'inbox_entry',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    accountKind: text('account_kind').notNull(),
    accountId: uuid('account_id').notNull(),
    unitId: uuid('unit_id'),
    templateKey: text('template_key').notNull(),
    params: jsonb().default({}).notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    dedupeId: uuid('dedupe_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'pk_inbox_entry', columns: [t.id] }),
    unique('uq_inbox_entry_dedupe')
      .on(
        t.buildingId,
        t.accountKind,
        t.accountId,
        t.sourceKind,
        t.dedupeId,
        t.templateKey,
        t.unitId,
      )
      .nullsNotDistinct(),
    index('ix_inbox_entry_building_account').on(
      t.buildingId,
      t.accountKind,
      t.accountId,
      t.id.desc().nullsFirst(),
    ),
    index('ix_inbox_entry_building_account_unread')
      .on(t.buildingId, t.accountKind, t.accountId)
      .where(sql`${t.readAt} IS NULL`),
    index('ix_inbox_entry_building_created').on(t.buildingId, t.createdAt),
    check('ck_inbox_entry_account_kind', sql`${t.accountKind} IN ('resident', 'staff')`),
    check('ck_inbox_entry_staff_unit', sql`${t.accountKind} = 'resident' OR ${t.unitId} IS NULL`),
    check(
      'ck_inbox_entry_template_key',
      sql`${t.templateKey} ~ '^[a-z]+\\.[a-z_]+$' AND char_length(${t.templateKey}) <= 40`,
    ),
    check(
      'ck_inbox_entry_params',
      sql`jsonb_typeof(${t.params}) = 'object' AND octet_length(${t.params}::text) <= 2048`,
    ),
    check(
      'ck_inbox_entry_source_kind',
      sql`${t.sourceKind} IN ('batch', 'charge', 'debt_reminder', 'payment', 'gateway_event', 'statement_line', 'ticket', 'vehicle', 'notice', 'membership', 'unit', 'export', 'step_up')`,
    ),
    check('ck_inbox_entry_read_at', sql`${t.readAt} IS NULL OR ${t.readAt} >= ${t.createdAt}`),
  ],
)

/** One Expo push token of one session (DOC-17 §6.2, DR-300); denied to `rms_readonly` (DOC-19 §5). */
export const deviceToken = notification.table(
  'device_token',
  {
    id: uuid().notNull(),
    accountKind: text('account_kind').notNull(),
    accountId: uuid('account_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    expoPushToken: text('expo_push_token').notNull(),
    platform: text().notNull(),
    appVersion: text('app_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_device_token', columns: [t.id] }),
    unique('uq_device_token_token').on(t.expoPushToken),
    unique('uq_device_token_session').on(t.sessionId),
    index('ix_device_token_account').on(t.accountKind, t.accountId),
    check('ck_device_token_account_kind', sql`${t.accountKind} IN ('resident', 'staff')`),
    check(
      'ck_device_token_token',
      sql`char_length(${t.expoPushToken}) <= 200 AND ${t.expoPushToken} ~ '^Expo(nent)?PushToken\\[[A-Za-z0-9_-]{1,180}\\]$'`,
    ),
    check('ck_device_token_platform', sql`${t.platform} IN ('ios', 'android')`),
    check(
      'ck_device_token_version',
      sql`${t.appVersion} ~ '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$'`,
    ),
  ],
)

/** One message sent to one device for one push request (DOC-17 §6.3, DR-301). */
export const pushTicket = notification.table(
  'push_ticket',
  {
    id: uuid().notNull(),
    messageId: uuid('message_id').notNull(),
    deviceTokenId: uuid('device_token_id').notNull(),
    accountKind: text('account_kind').notNull(),
    accountId: uuid('account_id').notNull(),
    templateKey: text('template_key').notNull(),
    sourceKind: text('source_kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    receiptId: text('receipt_id'),
    status: text().default('pending').notNull(),
    error: text(),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ name: 'pk_push_ticket', columns: [t.id] }),
    unique('uq_push_ticket_message_device').on(t.messageId, t.deviceTokenId),
    index('ix_push_ticket_pending').on(t.nextCheckAt).where(sql`${t.status} = 'pending'`),
    index('ix_push_ticket_created').on(t.createdAt),
    check('ck_push_ticket_account_kind', sql`${t.accountKind} IN ('resident', 'staff')`),
    check('ck_push_ticket_status', sql`${t.status} IN ('pending', 'ok', 'failed', 'unknown')`),
    check(
      'ck_push_ticket_receipt',
      sql`${t.receiptId} IS NULL OR char_length(${t.receiptId}) BETWEEN 1 AND 100`,
    ),
    check(
      'ck_push_ticket_shape',
      sql`(${t.status} = 'pending' AND ${t.receiptId} IS NOT NULL AND ${t.nextCheckAt} IS NOT NULL AND ${t.error} IS NULL AND ${t.checkedAt} IS NULL) OR (${t.status} = 'ok' AND ${t.receiptId} IS NOT NULL AND ${t.error} IS NULL AND ${t.checkedAt} IS NOT NULL) OR (${t.status} = 'unknown' AND ${t.receiptId} IS NOT NULL AND ${t.error} IS NULL AND ${t.checkedAt} IS NOT NULL) OR (${t.status} = 'failed' AND ${t.error} IS NOT NULL AND (${t.receiptId} IS NULL OR ${t.checkedAt} IS NOT NULL))`,
    ),
  ],
)

export const notificationOutbox = outboxTable(notification)
export const notificationInbox = inboxTable(notification)
