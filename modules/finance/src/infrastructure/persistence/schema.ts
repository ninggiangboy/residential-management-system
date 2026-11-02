import { inboxTable, outboxTable } from '@core/messaging'
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  type PgTableExtraConfigValue,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-15 §4–§10: every table of the `finance` schema (DR-13), the order-code sequence (DR-27) and the outbox and inbox of the
 * module. Names of tables, columns, constraints and indexes are DOC-15's, so an error names the rule it broke. A building, a
 * unit, an account and a file are referenced by id with no foreign key (ADR-0014); the foreign keys below stay inside
 * `finance`. The triggers of DOC-15 §11 are the custom migration `0001_triggers.sql`, which Drizzle does not model.
 * Amounts are whole đồng in `bigint` read as `number` (DOC-14 §5: at most 15 digits, below 2^53).
 */
export const finance = pgSchema('finance')
export const orderCodeSeq = finance.sequence('order_code_seq', {
  startWith: '1000000',
  increment: '1',
  minValue: '1000000',
  maxValue: '34359738367',
  cache: '1',
  cycle: false,
})

export const feeNoticeJob = finance.table(
  'fee_notice_job',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    status: text().default('queued').notNull(),
    language: text().notNull(),
    unitTotal: integer('unit_total').notNull(),
    unitDone: integer('unit_done').default(0).notNull(),
    cursorCharge: uuid('cursor_charge'),
    zipFile: uuid('zip_file'),
    attempts: smallint().default(0).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    error: jsonb(),
    requestedBy: uuid('requested_by').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_fee_notice_job', columns: [table.id] }),
    index('ix_fee_notice_job_building_claim')
      .on(table.buildingId, table.createdAt)
      .where(sql`(status = ANY (ARRAY['queued'::text, 'running'::text]))`),
    uniqueIndex('uq_fee_notice_job_batch_active')
      .on(table.buildingId, table.batchId)
      .where(sql`(status = ANY (ARRAY['queued'::text, 'running'::text]))`),
    foreignKey({
      columns: [table.batchId],
      foreignColumns: [feeBatch.id],
      name: 'fk_fee_notice_job_batch',
    }),
    check('ck_fee_notice_job_failed', sql`(status = 'failed'::text) = (error IS NOT NULL)`),
    check(
      'ck_fee_notice_job_finished',
      sql`(status = ANY (ARRAY['ready'::text, 'failed'::text])) = (finished_at IS NOT NULL)`,
    ),
    check(
      'ck_fee_notice_job_language',
      sql`language = ANY (ARRAY['vi'::text, 'en'::text, 'both'::text])`,
    ),
    check(
      'ck_fee_notice_job_progress',
      sql`(unit_total >= 0) AND ((unit_done >= 0) AND (unit_done <= unit_total))`,
    ),
    check('ck_fee_notice_job_ready', sql`(status = 'ready'::text) = (zip_file IS NOT NULL)`),
    check(
      'ck_fee_notice_job_status',
      sql`status = ANY (ARRAY['queued'::text, 'running'::text, 'ready'::text, 'failed'::text])`,
    ),
  ],
)

export const statementImport = finance.table(
  'statement_import',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    profileKey: text('profile_key').notNull(),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name'),
    status: text().notNull(),
    periodFrom: date('period_from'),
    periodTo: date('period_to'),
    lineCount: integer('line_count').default(0).notNull(),
    creditCount: integer('credit_count').default(0).notNull(),
    duplicateCount: integer('duplicate_count').default(0).notNull(),
    matchedCount: integer('matched_count').default(0).notNull(),
    error: jsonb(),
    createdBy: uuid('created_by').notNull(),
    fileDeletedAt: timestamp('file_deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_statement_import', columns: [table.id] }),
    index('ix_statement_import_building_created').on(
      table.buildingId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('ix_statement_import_building_period')
      .on(table.buildingId, table.periodFrom, table.periodTo)
      .where(sql`(status = 'processed'::text)`),
    check(
      'ck_statement_import_counts',
      sql`(line_count >= (credit_count + duplicate_count)) AND (credit_count >= 0) AND (duplicate_count >= 0) AND ((matched_count >= 0) AND (matched_count <= credit_count))`,
    ),
    check('ck_statement_import_failed', sql`(status = 'failed'::text) = (error IS NOT NULL)`),
    check(
      'ck_statement_import_period',
      sql`((period_from IS NULL) = (period_to IS NULL)) AND (period_from <= period_to)`,
    ),
    check(
      'ck_statement_import_processed',
      sql`(status = 'failed'::text) OR (period_from IS NOT NULL)`,
    ),
    check(
      'ck_statement_import_status',
      sql`status = ANY (ARRAY['processed'::text, 'failed'::text])`,
    ),
  ],
)

export const statementLine = finance.table(
  'statement_line',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    importId: uuid('import_id').notNull(),
    lineNo: integer('line_no').notNull(),
    bookedOn: date('booked_on').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    content: text().default('').notNull(),
    bankReference: text('bank_reference'),
    dedupKey: text('dedup_key').notNull(),
    matchStatus: text('match_status').default('unmatched').notNull(),
    paymentId: uuid('payment_id'),
    candidatePaymentId: uuid('candidate_payment_id'),
    intentId: uuid('intent_id'),
    note: text(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_statement_line', columns: [table.id] }),
    index('ix_statement_line_building_import').on(table.buildingId, table.importId, table.lineNo),
    index('ix_statement_line_building_payment')
      .on(table.buildingId, table.paymentId)
      .where(sql`(payment_id IS NOT NULL)`),
    index('ix_statement_line_building_status').on(
      table.buildingId,
      table.matchStatus,
      table.bookedOn.desc().nullsFirst(),
    ),
    foreignKey({
      columns: [table.candidatePaymentId],
      foreignColumns: [payment.id],
      name: 'fk_statement_line_candidate',
    }),
    foreignKey({
      columns: [table.importId],
      foreignColumns: [statementImport.id],
      name: 'fk_statement_line_import',
    }),
    foreignKey({
      columns: [table.intentId],
      foreignColumns: [paymentIntent.id],
      name: 'fk_statement_line_intent',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payment.id],
      name: 'fk_statement_line_payment',
    }),
    unique('uq_statement_line_building_dedup').on(table.buildingId, table.dedupKey),
    unique('uq_statement_line_import_line_no').on(table.importId, table.lineNo),
    check('ck_statement_line_amount', sql`amount > 0`),
    check('ck_statement_line_dedup', sql`dedup_key ~ '^[0-9a-f]{64}$'::text`),
    check(
      'ck_statement_line_matched',
      sql`(match_status = 'matched'::text) = (payment_id IS NOT NULL)`,
    ),
    check(
      'ck_statement_line_proposed',
      sql`(match_status = 'proposed'::text) <= (candidate_payment_id IS NOT NULL)`,
    ),
    check(
      'ck_statement_line_review',
      sql`((reviewed_at IS NULL) = (reviewed_by IS NULL)) AND ((reviewed_at IS NULL) = (review_note IS NULL))`,
    ),
    check(
      'ck_statement_line_review_note',
      sql`(review_note IS NULL) OR ((char_length(btrim(review_note)) >= 5) AND (char_length(btrim(review_note)) <= 1000))`,
    ),
    check(
      'ck_statement_line_reviewable',
      sql`(reviewed_at IS NULL) OR (match_status = ANY (ARRAY['unmatched'::text, 'statement_only'::text]))`,
    ),
    check(
      'ck_statement_line_status',
      sql`match_status = ANY (ARRAY['unmatched'::text, 'proposed'::text, 'matched'::text, 'statement_only'::text])`,
    ),
  ],
)

export const importJob = finance.table(
  'import_job',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    kind: text().notNull(),
    status: text().notNull(),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name'),
    params: jsonb().default({}).notNull(),
    result: jsonb().notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: 'pk_import_job', columns: [table.id] }),
    index('ix_import_job_building_created').on(
      table.buildingId,
      table.createdAt.desc().nullsFirst(),
    ),
    index('ix_import_job_created').on(table.createdAt),
    check(
      'ck_import_job_committed',
      sql`(status = 'committed'::text) = (committed_at IS NOT NULL)`,
    ),
    check('ck_import_job_expiry', sql`expires_at > created_at`),
    check('ck_import_job_kind', sql`kind = 'fee_batch'::text`),
    check(
      'ck_import_job_params',
      sql`(jsonb_typeof(params) = 'object'::text) AND (COALESCE(jsonb_typeof((params -> 'batchId'::text)), ''::text) = 'string'::text)`,
    ),
    check('ck_import_job_result', sql`jsonb_typeof(result) = 'object'::text`),
    check(
      'ck_import_job_status',
      sql`status = ANY (ARRAY['validated'::text, 'failed'::text, 'committed'::text, 'expired'::text])`,
    ),
  ],
)

export const debtReminder = finance.table(
  'debt_reminder',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    reminderDay: date('reminder_day').notNull(),
    sentBy: uuid('sent_by').notNull(),
    chargeCount: integer('charge_count').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_debt_reminder', columns: [table.id] }),
    index('ix_debt_reminder_created').on(table.createdAt),
    unique('uq_debt_reminder_unit_day').on(table.buildingId, table.unitId, table.reminderDay),
    check('ck_debt_reminder_amounts', sql`(charge_count >= 1) AND (amount > 0)`),
  ],
)

export const fakeGatewayLink = finance.table(
  'fake_gateway_link',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    gatewayConfigId: uuid('gateway_config_id').notNull(),
    orderCode: bigint('order_code', { mode: 'number' }).notNull(),
    linkId: text('link_id').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    description: text().notNull(),
    status: text().default('pending').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidReference: text('paid_reference'),
    paidAmount: bigint('paid_amount', { mode: 'number' }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_fake_gateway_link', columns: [table.id] }),
    unique('uq_fake_gateway_link_config_order').on(
      table.buildingId,
      table.gatewayConfigId,
      table.orderCode,
    ),
    unique('uq_fake_gateway_link_link_id').on(table.buildingId, table.linkId),
    check(
      'ck_fake_gateway_link_amount',
      sql`(amount > 0) AND ((paid_amount IS NULL) OR (paid_amount > 0))`,
    ),
    check(
      'ck_fake_gateway_link_paid',
      sql`(status = 'paid'::text) <= ((paid_reference IS NOT NULL) AND (paid_at IS NOT NULL))`,
    ),
    check(
      'ck_fake_gateway_link_status',
      sql`status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text, 'expired'::text])`,
    ),
  ],
)

export const feeBatch = finance.table(
  'fee_batch',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    code: text().notNull(),
    name: jsonb().notNull(),
    feeMonth: date('fee_month').notNull(),
    dueDate: date('due_date').notNull(),
    status: text().default('draft').notNull(),
    replacesBatchId: uuid('replaces_batch_id'),
    createdBy: uuid('created_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by'),
    recalledAt: timestamp('recalled_at', { withTimezone: true }),
    recalledBy: uuid('recalled_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    version: integer().default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_fee_batch', columns: [table.id] }),
    index('ix_fee_batch_building_fee_month').on(
      table.buildingId,
      table.feeMonth.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('ix_fee_batch_building_replaces')
      .on(table.buildingId, table.replacesBatchId)
      .where(sql`(replaces_batch_id IS NOT NULL)`),
    foreignKey({
      columns: [table.replacesBatchId],
      foreignColumns: [table.id],
      name: 'fk_fee_batch_replaces',
    }),
    unique('uq_fee_batch_building_code').on(table.buildingId, table.code),
    check(
      'ck_fee_batch_closed',
      sql`((status = 'closed'::text) = (closed_at IS NOT NULL)) AND ((closed_at IS NULL) = (closed_by IS NULL))`,
    ),
    check('ck_fee_batch_code', sql`code ~ '^PH-[0-9]{4}-[0-9]{2,}$'::text`),
    check(
      'ck_fee_batch_fee_month',
      sql`fee_month = (date_trunc('month'::text, (fee_month)::timestamp with time zone))::date`,
    ),
    check('ck_fee_batch_name', sql`platform.is_bilingual(name)`),
    check('ck_fee_batch_not_self', sql`replaces_batch_id IS DISTINCT FROM id`),
    check(
      'ck_fee_batch_published',
      sql`((status = 'draft'::text) = (published_at IS NULL)) AND ((published_at IS NULL) = (published_by IS NULL))`,
    ),
    check(
      'ck_fee_batch_recalled',
      sql`((status = 'recalled'::text) = (recalled_at IS NOT NULL)) AND ((recalled_at IS NULL) = (recalled_by IS NULL))`,
    ),
    check(
      'ck_fee_batch_status',
      sql`status = ANY (ARRAY['draft'::text, 'published'::text, 'recalled'::text, 'closed'::text])`,
    ),
    check('ck_fee_batch_version', sql`version >= 1`),
  ],
)

export const charge = finance.table(
  'charge',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    unitCode: text('unit_code').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    status: text().default('draft').notNull(),
    voidKind: text('void_kind'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    version: integer().default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_charge', columns: [table.id] }),
    index('ix_charge_building_batch').on(table.buildingId, table.batchId, table.status),
    index('ix_charge_building_unit').on(table.buildingId, table.unitId, table.batchId),
    index('ix_charge_building_unit_open')
      .on(table.buildingId, table.unitId)
      .where(sql`(status = 'open'::text)`),
    foreignKey({
      columns: [table.batchId],
      foreignColumns: [feeBatch.id],
      name: 'fk_charge_batch',
    }).onDelete('cascade'),
    unique('uq_charge_batch_unit').on(table.buildingId, table.batchId, table.unitId),
    check('ck_charge_amount', sql`amount > 0`),
    check(
      'ck_charge_status',
      sql`status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text])`,
    ),
    check('ck_charge_version', sql`version >= 1`),
    check(
      'ck_charge_void',
      sql`((status = 'void'::text) = (void_kind IS NOT NULL)) AND ((status = 'void'::text) = (voided_at IS NOT NULL)) AND ((status = 'void'::text) = (voided_by IS NOT NULL))`,
    ),
    check('ck_charge_void_kind', sql`void_kind = ANY (ARRAY['recall'::text, 'single'::text])`),
    check(
      'ck_charge_void_reason',
      sql`((NOT (void_kind IS DISTINCT FROM 'single'::text)) = (void_reason IS NOT NULL)) AND ((void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 5) AND (char_length(btrim(void_reason)) <= 500)))`,
    ),
  ],
)

export const chargeLine = finance.table(
  'charge_line',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    chargeId: uuid('charge_id').notNull(),
    position: smallint().notNull(),
    kind: text().default('fee').notNull(),
    itemName: jsonb('item_name').notNull(),
    quantity: numeric({ precision: 12, scale: 3 }).default(sql`1`).notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_charge_line', columns: [table.id] }),
    index('ix_charge_line_building_charge').on(table.buildingId, table.chargeId),
    foreignKey({
      columns: [table.chargeId],
      foreignColumns: [charge.id],
      name: 'fk_charge_line_charge',
    }).onDelete('cascade'),
    unique('uq_charge_line_charge_position').on(table.chargeId, table.position),
    check(
      'ck_charge_line_amount',
      sql`(kind = 'adjustment'::text) OR (amount = (((((quantity * (1000)::numeric))::bigint * unit_price) + 500) / 1000))`,
    ),
    check('ck_charge_line_item_name', sql`platform.is_bilingual(item_name)`),
    check('ck_charge_line_kind', sql`kind = ANY (ARRAY['fee'::text, 'adjustment'::text])`),
    check(
      'ck_charge_line_note',
      sql`((kind = 'fee'::text) OR ((note IS NOT NULL) AND (btrim(note) <> ''::text))) AND ((note IS NULL) OR (char_length(note) <= 500))`,
    ),
    check('ck_charge_line_position', sql`"position" >= 1`),
    check('ck_charge_line_quantity', sql`quantity >= (0)::numeric`),
    check(
      'ck_charge_line_sign',
      sql`((kind = 'fee'::text) AND (amount > 0)) OR ((kind = 'adjustment'::text) AND (amount <> 0))`,
    ),
    check('ck_charge_line_unit_price', sql`unit_price >= 0`),
  ],
)

export const paymentCustomer = finance.table(
  'payment_customer',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    accountId: uuid('account_id').notNull(),
    provider: text().notNull(),
    providerCustomerId: text('provider_customer_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_payment_customer', columns: [table.id] }),
    unique('uq_payment_customer_account_provider').on(
      table.buildingId,
      table.accountId,
      table.provider,
    ),
    check('ck_payment_customer_provider', sql`provider ~ '^[a-z][a-z0-9]{2,15}$'::text`),
  ],
)

export const paymentIntent = finance.table(
  'payment_intent',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    code: text().notNull(),
    orderCode: bigint('order_code', { mode: 'number' }).notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    status: text().default('creating').notNull(),
    gatewayConfigId: uuid('gateway_config_id').notNull(),
    provider: text().default('stripe').notNull(),
    linkId: text('link_id'),
    qrPayload: text('qr_payload'),
    checkoutUrl: text('checkout_url'),
    receiving: jsonb(),
    createdBy: uuid('created_by').notNull(),
    displayUntil: timestamp('display_until', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    nextCheckAt: timestamp('next_check_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    checkCount: integer('check_count').default(0).notNull(),
    checkFailures: smallint('check_failures').default(0).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    gatewayReference: text('gateway_reference'),
    cancelReason: text('cancel_reason'),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    version: integer().default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_payment_intent', columns: [table.id] }),
    index('ix_payment_intent_building_requery')
      .on(table.buildingId, table.nextCheckAt)
      .where(sql`(status = ANY (ARRAY['creating'::text, 'pending'::text, 'cancelling'::text]))`),
    index('ix_payment_intent_building_unit').on(
      table.buildingId,
      table.unitId,
      table.createdAt.desc().nullsFirst(),
    ),
    unique('uq_payment_intent_building_code').on(table.buildingId, table.code),
    unique('uq_payment_intent_order_code').on(table.orderCode),
    check('ck_payment_intent_amount', sql`amount > 0`),
    check(
      'ck_payment_intent_cancel_reason',
      sql`cancel_reason = ANY (ARRAY['resident'::text, 'staff'::text, 'superseded'::text, 'batch_recalled'::text, 'charge_voided'::text, 'charge_paid'::text])`,
    ),
    check(
      'ck_payment_intent_cancelled',
      sql`(status = 'cancelled'::text) <= (cancelled_at IS NOT NULL)`,
    ),
    check(
      'ck_payment_intent_cancelling',
      sql`(status <> ALL (ARRAY['cancelling'::text, 'cancelled'::text])) OR ((cancel_reason IS NOT NULL) AND (cancel_requested_at IS NOT NULL))`,
    ),
    check('ck_payment_intent_checks', sql`(check_count >= 0) AND (check_failures >= 0)`),
    check('ck_payment_intent_code', sql`code ~ '^TT-[0-9]{6}-[0-9]{4,}$'::text`),
    check('ck_payment_intent_expired', sql`(status = 'expired'::text) <= (expired_at IS NOT NULL)`),
    check('ck_payment_intent_failed', sql`(status = 'failed'::text) <= (failed_at IS NOT NULL)`),
    check(
      'ck_payment_intent_link',
      sql`(status <> ALL (ARRAY['pending'::text, 'expired'::text])) OR (link_id IS NOT NULL)`,
    ),
    check(
      'ck_payment_intent_order_code',
      sql`(order_code >= 1000000) AND (order_code <= '34359738367'::bigint)`,
    ),
    check(
      'ck_payment_intent_paid',
      sql`((status = 'paid'::text) = (paid_at IS NOT NULL)) AND ((paid_at IS NULL) = (gateway_reference IS NULL))`,
    ),
    check('ck_payment_intent_provider', sql`provider ~ '^[a-z][a-z0-9]{2,15}$'::text`),
    check(
      'ck_payment_intent_receiving',
      sql`(receiving IS NULL) OR (jsonb_typeof(receiving) = 'object'::text)`,
    ),
    check(
      'ck_payment_intent_status',
      sql`status = ANY (ARRAY['creating'::text, 'pending'::text, 'cancelling'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'cancelled'::text])`,
    ),
    check('ck_payment_intent_version', sql`version >= 1`),
    check(
      'ck_payment_intent_window',
      sql`(display_until > created_at) AND (expires_at >= display_until)`,
    ),
  ],
)

export const paymentIntentItem = finance.table(
  'payment_intent_item',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    intentId: uuid('intent_id').notNull(),
    chargeId: uuid('charge_id').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_payment_intent_item', columns: [table.id] }),
    uniqueIndex('uq_payment_intent_item_charge_active')
      .on(table.buildingId, table.chargeId)
      .where(sql`(released_at IS NULL)`),
    foreignKey({
      columns: [table.chargeId],
      foreignColumns: [charge.id],
      name: 'fk_payment_intent_item_charge',
    }),
    foreignKey({
      columns: [table.intentId],
      foreignColumns: [paymentIntent.id],
      name: 'fk_payment_intent_item_intent',
    }),
    unique('uq_payment_intent_item_intent_charge').on(
      table.buildingId,
      table.intentId,
      table.chargeId,
    ),
    check('ck_payment_intent_item_amount', sql`amount > 0`),
  ],
)

export const payment = finance.table(
  'payment',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    source: text().notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    payerName: text('payer_name'),
    provider: text(),
    gatewayReference: text('gateway_reference'),
    intentId: uuid('intent_id'),
    bankReference: text('bank_reference'),
    statementLineId: uuid('statement_line_id'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    clientKey: text('client_key'),
    recordedBy: uuid('recorded_by'),
    note: text(),
    status: text().default('posted').notNull(),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // payment and statement_line reference each other (DOC-15 §9.2); the annotation breaks the type cycle.
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ name: 'pk_payment', columns: [table.id] }),
    index('ix_payment_building_bank_reference')
      .on(table.buildingId, table.bankReference)
      .where(sql`(bank_reference IS NOT NULL)`),
    index('ix_payment_building_received').on(
      table.buildingId,
      table.receivedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('ix_payment_building_unit_received').on(
      table.buildingId,
      table.unitId,
      table.receivedAt.desc().nullsFirst(),
    ),
    index('ix_payment_building_unreconciled')
      .on(table.buildingId, table.amount, table.receivedAt)
      .where(
        sql`((source = 'bank_transfer'::text) AND (status = 'posted'::text) AND (reconciled_at IS NULL))`,
      ),
    uniqueIndex('uq_payment_building_statement_line')
      .on(table.buildingId, table.statementLineId)
      .where(sql`((statement_line_id IS NOT NULL) AND (status = 'posted'::text))`),
    foreignKey({
      columns: [table.intentId],
      foreignColumns: [paymentIntent.id],
      name: 'fk_payment_intent',
    }),
    foreignKey({
      columns: [table.statementLineId],
      foreignColumns: [statementLine.id],
      name: 'fk_payment_statement_line',
    }),
    unique('uq_payment_building_client_key').on(table.buildingId, table.clientKey),
    unique('uq_payment_building_intent').on(table.buildingId, table.intentId),
    unique('uq_payment_gateway_reference').on(table.provider, table.gatewayReference),
    check('ck_payment_amount', sql`amount > 0`),
    check(
      'ck_payment_online',
      sql`((source = 'online'::text) AND (provider IS NOT NULL) AND (gateway_reference IS NOT NULL) AND (intent_id IS NOT NULL) AND (client_key IS NULL) AND (recorded_by IS NULL) AND (statement_line_id IS NULL)) OR ((source = ANY (ARRAY['cash'::text, 'bank_transfer'::text])) AND (provider IS NULL) AND (gateway_reference IS NULL) AND (intent_id IS NULL) AND (client_key IS NOT NULL) AND (recorded_by IS NOT NULL) AND (payer_name IS NOT NULL) AND (btrim(payer_name) <> ''::text))`,
    ),
    check(
      'ck_payment_source',
      sql`source = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'online'::text])`,
    ),
    check(
      'ck_payment_statement_line',
      sql`(statement_line_id IS NULL) OR (source = 'bank_transfer'::text)`,
    ),
    check('ck_payment_status', sql`status = ANY (ARRAY['posted'::text, 'void'::text])`),
    check(
      'ck_payment_void',
      sql`((status = 'void'::text) = (voided_at IS NOT NULL)) AND ((voided_at IS NULL) = (voided_by IS NULL)) AND ((voided_at IS NULL) = (void_reason IS NULL))`,
    ),
    check(
      'ck_payment_void_reason',
      sql`(void_reason IS NULL) OR ((char_length(btrim(void_reason)) >= 5) AND (char_length(btrim(void_reason)) <= 500))`,
    ),
    check('ck_payment_void_source', sql`(status = 'posted'::text) OR (source <> 'online'::text)`),
  ],
)

export const allocation = finance.table(
  'allocation',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    chargeId: uuid('charge_id').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    status: text().default('live').notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_allocation', columns: [table.id] }),
    index('ix_allocation_building_charge').on(table.buildingId, table.chargeId),
    uniqueIndex('uq_allocation_charge_live')
      .on(table.buildingId, table.chargeId)
      .where(sql`(status = 'live'::text)`),
    foreignKey({
      columns: [table.chargeId],
      foreignColumns: [charge.id],
      name: 'fk_allocation_charge',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payment.id],
      name: 'fk_allocation_payment',
    }),
    unique('uq_allocation_payment_charge').on(table.buildingId, table.paymentId, table.chargeId),
    check('ck_allocation_amount', sql`amount > 0`),
    check('ck_allocation_status', sql`status = ANY (ARRAY['live'::text, 'void'::text])`),
    check('ck_allocation_void', sql`(status = 'void'::text) = (voided_at IS NOT NULL)`),
  ],
)

export const receipt = finance.table(
  'receipt',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    number: text().notNull(),
    allocationId: uuid('allocation_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    chargeId: uuid('charge_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    amount: bigint({ mode: 'number' }).notNull(),
    snapshot: jsonb().notNull(),
    pdfFile: uuid('pdf_file'),
    status: text().default('issued').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    externalInvoice: jsonb('external_invoice'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_receipt', columns: [table.id] }),
    index('ix_receipt_building_payment').on(table.buildingId, table.paymentId),
    index('ix_receipt_building_unit_issued').on(
      table.buildingId,
      table.unitId,
      table.issuedAt.desc().nullsFirst(),
    ),
    foreignKey({
      columns: [table.allocationId],
      foreignColumns: [allocation.id],
      name: 'fk_receipt_allocation',
    }),
    foreignKey({
      columns: [table.chargeId],
      foreignColumns: [charge.id],
      name: 'fk_receipt_charge',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payment.id],
      name: 'fk_receipt_payment',
    }),
    unique('uq_receipt_building_allocation').on(table.buildingId, table.allocationId),
    unique('uq_receipt_building_number').on(table.buildingId, table.number),
    check('ck_receipt_amount', sql`amount > 0`),
    check(
      'ck_receipt_external_invoice',
      sql`(external_invoice IS NULL) OR (jsonb_typeof(external_invoice) = 'object'::text)`,
    ),
    check('ck_receipt_number', sql`number ~ '^BL-[0-9]{4}-[0-9]{4,}$'::text`),
    check('ck_receipt_snapshot', sql`jsonb_typeof(snapshot) = 'object'::text`),
    check('ck_receipt_status', sql`status = ANY (ARRAY['issued'::text, 'void'::text])`),
    check('ck_receipt_void', sql`(status = 'void'::text) = (voided_at IS NOT NULL)`),
  ],
)

export const gatewayEvent = finance.table(
  'gateway_event',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    provider: text().notNull(),
    reference: text().notNull(),
    orderCode: bigint('order_code', { mode: 'number' }),
    amount: bigint({ mode: 'number' }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    source: text().notNull(),
    payload: jsonb().notNull(),
    intentId: uuid('intent_id'),
    unitId: uuid('unit_id'),
    outcome: text().notNull(),
    paymentId: uuid('payment_id'),
    relatedPaymentId: uuid('related_payment_id'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: 'pk_gateway_event', columns: [table.id] }),
    index('ix_gateway_event_building_intent')
      .on(table.buildingId, table.intentId)
      .where(sql`(intent_id IS NOT NULL)`),
    index('ix_gateway_event_building_open')
      .on(table.buildingId, table.receivedAt.desc().nullsFirst())
      .where(
        sql`((outcome <> ALL (ARRAY['pending'::text, 'posted'::text])) AND (reviewed_at IS NULL))`,
      ),
    index('ix_gateway_event_building_received').on(
      table.buildingId,
      table.receivedAt.desc().nullsFirst(),
      table.id.desc().nullsFirst(),
    ),
    index('ix_gateway_event_building_unit')
      .on(table.buildingId, table.unitId, table.receivedAt.desc().nullsFirst())
      .where(sql`(unit_id IS NOT NULL)`),
    foreignKey({
      columns: [table.intentId],
      foreignColumns: [paymentIntent.id],
      name: 'fk_gateway_event_intent',
    }),
    foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payment.id],
      name: 'fk_gateway_event_payment',
    }),
    foreignKey({
      columns: [table.relatedPaymentId],
      foreignColumns: [payment.id],
      name: 'fk_gateway_event_related_payment',
    }),
    unique('uq_gateway_event_provider_reference').on(table.provider, table.reference),
    check('ck_gateway_event_amount', sql`amount > 0`),
    check(
      'ck_gateway_event_intent',
      sql`(outcome = ANY (ARRAY['pending'::text, 'unknown_order'::text])) OR (intent_id IS NOT NULL)`,
    ),
    check(
      'ck_gateway_event_outcome',
      sql`outcome = ANY (ARRAY['pending'::text, 'posted'::text, 'amount_short'::text, 'amount_over'::text, 'duplicate_transfer'::text, 'charge_already_paid'::text, 'charge_recalled'::text, 'unknown_order'::text, 'refunded'::text, 'disputed'::text])`,
    ),
    check('ck_gateway_event_payload', sql`jsonb_typeof(payload) = 'object'::text`),
    check('ck_gateway_event_posted', sql`(outcome = 'posted'::text) = (payment_id IS NOT NULL)`),
    check('ck_gateway_event_provider', sql`provider ~ '^[a-z][a-z0-9]{2,15}$'::text`),
    check(
      'ck_gateway_event_related',
      sql`(related_payment_id IS NULL) OR (outcome = ANY (ARRAY['refunded'::text, 'disputed'::text]))`,
    ),
    check(
      'ck_gateway_event_review',
      sql`((reviewed_at IS NULL) = (reviewed_by IS NULL)) AND ((reviewed_at IS NULL) = (review_note IS NULL))`,
    ),
    check(
      'ck_gateway_event_review_note',
      sql`(review_note IS NULL) OR ((char_length(btrim(review_note)) >= 5) AND (char_length(btrim(review_note)) <= 1000))`,
    ),
    check(
      'ck_gateway_event_reviewable',
      sql`(reviewed_at IS NULL) OR (outcome <> ALL (ARRAY['pending'::text, 'posted'::text]))`,
    ),
    check(
      'ck_gateway_event_source',
      sql`source = ANY (ARRAY['webhook'::text, 'requery'::text, 'statement'::text])`,
    ),
  ],
)

export const webhookRejection = finance.table(
  'webhook_rejection',
  {
    id: uuid().notNull(),
    buildingId: uuid('building_id').notNull(),
    gatewayConfigId: uuid('gateway_config_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    ip: inet(),
    reason: text().notNull(),
    bodySha256: text('body_sha256').notNull(),
    bodyExcerpt: text('body_excerpt'),
  },
  (table) => [
    primaryKey({ name: 'pk_webhook_rejection', columns: [table.id] }),
    index('ix_webhook_rejection_building_received').on(
      table.buildingId,
      table.receivedAt.desc().nullsFirst(),
    ),
    index('ix_webhook_rejection_received').on(table.receivedAt),
    check(
      'ck_webhook_rejection_excerpt',
      sql`(body_excerpt IS NULL) OR (octet_length(body_excerpt) <= 2048)`,
    ),
    check(
      'ck_webhook_rejection_reason',
      sql`reason = ANY (ARRAY['bad_signature'::text, 'bad_account'::text, 'malformed'::text, 'unknown_config'::text, 'foreign_building'::text])`,
    ),
    check('ck_webhook_rejection_sha256', sql`body_sha256 ~ '^[0-9a-f]{64}$'::text`),
  ],
)

export const documentCounter = finance.table(
  'document_counter',
  {
    buildingId: uuid('building_id').notNull(),
    series: text().notNull(),
    period: text().notNull(),
    last: integer().default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_document_counter',
      columns: [table.buildingId, table.series, table.period],
    }),
    check('ck_document_counter_last', sql`last >= 0`),
    check('ck_document_counter_period', sql`period ~ '^[0-9]{4}([0-9]{2})?$'::text`),
    check(
      'ck_document_counter_series',
      sql`series = ANY (ARRAY['receipt'::text, 'batch'::text, 'intent'::text])`,
    ),
  ],
)

export const financeOutbox = outboxTable(finance)
export const financeInbox = inboxTable(finance)

export type FeeBatchRow = typeof feeBatch.$inferSelect
export type ChargeRow = typeof charge.$inferSelect
export type ChargeLineRow = typeof chargeLine.$inferSelect
export type PaymentIntentRow = typeof paymentIntent.$inferSelect
export type PaymentIntentItemRow = typeof paymentIntentItem.$inferSelect
export type PaymentCustomerRow = typeof paymentCustomer.$inferSelect
export type PaymentRow = typeof payment.$inferSelect
export type AllocationRow = typeof allocation.$inferSelect
export type ReceiptRow = typeof receipt.$inferSelect
export type GatewayEventRow = typeof gatewayEvent.$inferSelect
export type WebhookRejectionRow = typeof webhookRejection.$inferSelect
export type StatementImportRow = typeof statementImport.$inferSelect
export type StatementLineRow = typeof statementLine.$inferSelect
export type ImportJobRow = typeof importJob.$inferSelect
export type FeeNoticeJobRow = typeof feeNoticeJob.$inferSelect
export type DebtReminderRow = typeof debtReminder.$inferSelect
export type FakeGatewayLinkRow = typeof fakeGatewayLink.$inferSelect
export type DocumentCounterRow = typeof documentCounter.$inferSelect
