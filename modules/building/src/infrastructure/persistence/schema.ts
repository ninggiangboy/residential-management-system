import { inboxTable, outboxTable } from '@core/messaging'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-17 §1 and §3.1, §3.2: the building, its settings, the payment-gateway configuration, the terms, the files and the job
 * runs, plus the outbox and the inbox of the module (`building.file_delete_requested.v1`, `building.thumbnail_requested.v1`).
 * Constraints and indexes are named as in DOC-14 §11. What drizzle-kit cannot express (`INCLUDE`, the write-once trigger) is
 * in the second migration.
 */
export const building = pgSchema('building')

const citext = customType<{ data: string }>({ dataType: () => 'citext' })

type Bilingual = { vi: string; en?: string }

const stamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const fileObject = building.table(
  'file_object',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    module: text('module').notNull(),
    purpose: text('purpose').notNull(),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    checksum: text('checksum'),
    status: text('status').notNull().default('pending'),
    ownerRef: text('owner_ref'),
    accountKind: text('account_kind').notNull(),
    accountId: uuid('account_id').notNull(),
    ...stamps,
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    attachedAt: timestamp('attached_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'pk_file_object', columns: [t.id] }),
    unique('uq_file_object_building_key').on(t.buildingId, t.objectKey),
    check(
      'ck_file_object_module',
      sql`${t.module} IN ('identity', 'building', 'residency', 'finance', 'tickets', 'vehicles', 'notices', 'wiki', 'reporting')`,
    ),
    check(
      'ck_file_object_purpose',
      sql`${t.purpose} IN ('avatar', 'logo', 'import', 'statement', 'fee_notice_pdf', 'receipt_pdf', 'bulk_zip', 'ticket_media', 'vehicle_plate_photo', 'vehicle_paper', 'notice_attachment', 'notice_image', 'wiki_attachment', 'wiki_image', 'export', 'thumbnail')`,
    ),
    check(
      'ck_file_object_key',
      sql`${t.objectKey} ~ '^[a-z]+/[0-9a-f-]{36}/[a-z]+/[0-9]{4}/(0[1-9]|1[0-2])/[0-9a-f-]{36}\\.[a-z0-9]{1,8}$'`,
    ),
    check('ck_file_object_size', sql`${t.size} >= 0`),
    check(
      'ck_file_object_status',
      sql`${t.status} IN ('pending', 'verified', 'attached', 'deleted')`,
    ),
    check('ck_file_object_account', sql`${t.accountKind} IN ('staff', 'resident', 'system')`),
    check(
      'ck_file_object_stamps',
      sql`(${t.status} = 'pending' AND ${t.verifiedAt} IS NULL AND ${t.attachedAt} IS NULL AND ${t.deletedAt} IS NULL)
        OR (${t.status} = 'verified' AND ${t.verifiedAt} IS NOT NULL AND ${t.attachedAt} IS NULL AND ${t.deletedAt} IS NULL)
        OR (${t.status} = 'attached' AND ${t.verifiedAt} IS NOT NULL AND ${t.attachedAt} IS NOT NULL AND ${t.deletedAt} IS NULL)
        OR (${t.status} = 'deleted' AND ${t.deletedAt} IS NOT NULL)`,
    ),
    index('ix_file_object_building_unattached')
      .on(t.buildingId, t.createdAt)
      .where(sql`${t.status} IN ('pending', 'verified')`),
    index('ix_file_object_building_owner')
      .on(t.buildingId, t.ownerRef)
      .where(sql`${t.ownerRef} IS NOT NULL`),
    index('ix_file_object_building_deleted')
      .on(t.buildingId, t.deletedAt)
      .where(sql`${t.status} = 'deleted'`),
  ],
)

export const buildingTable = building.table(
  'building',
  {
    id: uuid('id').notNull(),
    code: text('code').notNull(),
    name: jsonb('name').$type<Bilingual>().notNull(),
    company: jsonb('company').$type<Record<string, unknown>>().notNull(),
    address: text('address').notNull(),
    hotline: text('hotline'),
    workingHours: jsonb('working_hours').$type<Bilingual>(),
    email: citext('email'),
    logoFile: uuid('logo_file'),
    timeZone: text('time_zone').notNull().default('Asia/Ho_Chi_Minh'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...stamps,
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_building', columns: [t.id] }),
    unique('uq_building_code').on(t.code),
    foreignKey({
      name: 'fk_building_logo_file',
      columns: [t.logoFile],
      foreignColumns: [fileObject.id],
    }),
    check('ck_building_code', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'`),
    check('ck_building_name', sql`platform.is_bilingual(${t.name})`),
    check('ck_building_company', sql`jsonb_typeof(${t.company}) = 'object'`),
    check(
      'ck_building_working_hours',
      sql`${t.workingHours} IS NULL OR platform.is_bilingual(${t.workingHours})`,
    ),
    check('ck_building_time_zone', sql`btrim(${t.timeZone}) <> ''`),
    check('ck_building_version', sql`${t.version} >= 1`),
  ],
)

export const buildingSetting = building.table(
  'building_setting',
  {
    buildingId: uuid('building_id').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ...stamps,
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_building_setting', columns: [t.buildingId] }),
    check('ck_building_setting_data', sql`jsonb_typeof(${t.data}) = 'object'`),
    check('ck_building_setting_version', sql`${t.version} >= 1`),
  ],
)

export const gatewayConfig = building.table(
  'gateway_config',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    provider: text('provider').notNull(),
    driver: text('driver').notNull(),
    secretsEnc: text('secrets_enc').notNull(),
    receivingAccount: jsonb('receiving_account').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('active'),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }),
    lastCheckOk: boolean('last_check_ok'),
    ...stamps,
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_gateway_config', columns: [t.id] }),
    check('ck_gateway_config_provider', sql`${t.provider} IN ('payos', 'vietqr')`),
    check('ck_gateway_config_driver', sql`${t.driver} IN ('payos', 'vietqr', 'fake')`),
    check('ck_gateway_config_status', sql`${t.status} IN ('active', 'disabled')`),
    check(
      'ck_gateway_config_secrets',
      sql`${t.secretsEnc} ~ '^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'`,
    ),
    check('ck_gateway_config_account', sql`jsonb_typeof(${t.receivingAccount}) = 'object'`),
    check('ck_gateway_config_check', sql`(${t.lastCheckAt} IS NULL) = (${t.lastCheckOk} IS NULL)`),
    check('ck_gateway_config_version', sql`${t.version} >= 1`),
    uniqueIndex('uq_gateway_config_building_provider_active')
      .on(t.buildingId, t.provider)
      .where(sql`${t.status} = 'active'`),
  ],
)

export const termsVersion = building.table(
  'terms_version',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    kind: text('kind').notNull(),
    version: integer('version').notNull(),
    text: jsonb('text').$type<Bilingual>().notNull(),
    publishedBy: uuid('published_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_terms_version', columns: [t.id] }),
    unique('uq_terms_version_building_kind_version').on(t.buildingId, t.kind, t.version),
    check('ck_terms_version_kind', sql`${t.kind} IN ('terms', 'privacy')`),
    check('ck_terms_version_version', sql`${t.version} >= 1`),
    check('ck_terms_version_text', sql`platform.is_bilingual(${t.text})`),
  ],
)

export const termsAcceptance = building.table(
  'terms_acceptance',
  {
    buildingId: uuid('building_id').notNull(),
    accountId: uuid('account_id').notNull(),
    versionId: uuid('version_id').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
    appVersion: text('app_version'),
  },
  (t) => [
    primaryKey({ name: 'pk_terms_acceptance', columns: [t.accountId, t.versionId] }),
    foreignKey({
      name: 'fk_terms_acceptance_version',
      columns: [t.versionId],
      foreignColumns: [termsVersion.id],
    }),
    index('ix_terms_acceptance_building_version').on(t.buildingId, t.versionId),
  ],
)

export const jobRun = building.table(
  'job_run',
  {
    id: uuid('id').notNull(),
    name: text('name').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [
    primaryKey({ name: 'pk_job_run', columns: [t.id] }),
    check('ck_job_run_name', sql`${t.name} ~ '^[a-z][a-z0-9_]{2,40}$'`),
    check('ck_job_run_status', sql`${t.status} IN ('succeeded', 'failed')`),
    check('ck_job_run_times', sql`${t.finishedAt} >= ${t.startedAt}`),
    check('ck_job_run_details', sql`jsonb_typeof(${t.details}) = 'object'`),
    index('ix_job_run_started').on(t.startedAt),
    index('ix_job_run_name_success')
      .on(t.name, t.finishedAt.desc().nullsFirst())
      .where(sql`${t.status} = 'succeeded'`),
  ],
)

/** The commands `building` writes for itself: delete an object, make a thumbnail (DR-122). */
export const buildingOutbox = outboxTable(building)
export const buildingInbox = inboxTable(building)
