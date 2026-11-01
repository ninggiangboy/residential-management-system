import { inboxTable, outboxTable } from '@core/messaging'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-16 §5.1 to §5.6: the tables of `residency` and the outbox and inbox of the module. An account of `identity` and a building are referenced by id, with no foreign key (ADR-0014).
 */
export const residency = pgSchema('residency')

const citext = customType<{ data: string }>({ dataType: () => 'citext' })

/** One kind of unit of one building, never deleted, only archived (DOC-16 §5.6, DR-314, DR-315). */
export const unitType = residency.table(
  'unit_type',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    code: text('code').notNull(),
    name: jsonb('name').notNull().$type<{ vi: string; en?: string }>(),
    defaultBedrooms: smallint('default_bedrooms'),
    defaultAreaM2: numeric('default_area_m2', { precision: 8, scale: 2 }),
    status: text('status').notNull().default('active'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_unit_type', columns: [t.id] }),
    uniqueIndex('unit_type_code_key').on(t.buildingId, t.code),
    uniqueIndex('unit_type_name_key').on(t.buildingId, sql`lower(${t.name} ->> 'vi')`),
    // The target of the composite foreign key of `unit`: a unit can never take another building's type.
    uniqueIndex('unit_type_building_id_key').on(t.buildingId, t.id),
    check('unit_type_code_format', sql`${t.code} ~ '^[a-z][a-z0-9_]{1,29}$'`),
    check('unit_type_name_bilingual', sql`platform.is_bilingual(${t.name})`),
    check('unit_type_default_bedrooms_range', sql`${t.defaultBedrooms} BETWEEN 0 AND 20`),
    check(
      'unit_type_default_area_range',
      sql`${t.defaultAreaM2} > 0 AND ${t.defaultAreaM2} <= 2000`,
    ),
    check('unit_type_status_check', sql`${t.status} IN ('active', 'archived')`),
    check(
      'unit_type_archived_check',
      sql`(${t.status} = 'archived') = (${t.archivedAt} IS NOT NULL)`,
    ),
  ],
)

export const unit = residency.table(
  'unit',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    code: text('code').notNull(),
    floor: smallint('floor'),
    bedrooms: smallint('bedrooms'),
    areaM2: numeric('area_m2', { precision: 8, scale: 2 }),
    occupancy: text('occupancy').notNull().default('vacant'),
    note: text('note'),
    unitTypeId: uuid('unit_type_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_unit', columns: [t.id] }),
    foreignKey({
      name: 'unit_unit_type_fk',
      columns: [t.buildingId, t.unitTypeId],
      foreignColumns: [unitType.buildingId, unitType.id],
    }),
    index('unit_type_idx').on(t.buildingId, t.unitTypeId),
    uniqueIndex('unit_code_key').on(t.buildingId, t.code),
    index('unit_code_prefix_idx').using(
      'btree',
      t.buildingId,
      sql`lower(${t.code}) text_pattern_ops`,
    ),
    check('ck_unit_bedrooms', sql`${t.bedrooms} >= 0`),
    check('ck_unit_area', sql`${t.areaM2} > 0`),
    check('ck_unit_occupancy', sql`${t.occupancy} IN ('occupied', 'rented', 'vacant')`),
  ],
)

/** What one building's management knows about one person (DOC-16 §5.2). */
export const residentProfile = residency.table(
  'resident_profile',
  {
    buildingId: uuid('building_id').notNull(),
    accountId: uuid('account_id').notNull(),
    fullName: text('full_name'),
    email: citext('email'),
    cccdEnc: text('cccd_enc'),
    cccdLast4: text('cccd_last4'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    note: text('note'),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_resident_profile', columns: [t.buildingId, t.accountId] }),
    // Name search without diacritics (DR-41).
    index('resident_profile_name_trgm_idx').using(
      'gin',
      sql`lower(platform.immutable_unaccent(${t.fullName})) gin_trgm_ops`,
    ),
    check('ck_resident_profile_cccd_last4', sql`${t.cccdLast4} ~ '^[0-9]{4}$'`),
    check(
      'ck_resident_profile_name_unless_cleared',
      sql`${t.clearedAt} IS NOT NULL OR ${t.fullName} IS NOT NULL`,
    ),
    check('resident_profile_cccd_pair', sql`(${t.cccdEnc} IS NULL) = (${t.cccdLast4} IS NULL)`),
  ],
)

/** One person's right in one unit, from its start to its removal (DOC-16 §5.3). */
export const membership = residency.table(
  'membership',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    accountId: uuid('account_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    memberType: text('member_type').notNull(),
    canPay: boolean('can_pay').notNull().default(false),
    status: text('status').notNull().default('active'),
    lockedBy: text('locked_by'),
    credentialVersion: integer('credential_version').notNull().default(1),
    addedByKind: text('added_by_kind').notNull(),
    addedBy: uuid('added_by').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    note: text('note'),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_membership', columns: [t.id] }),
    foreignKey({ name: 'fk_membership_unit', columns: [t.unitId], foreignColumns: [unit.id] }),
    // Exactly one active or locked owner per unit (FR-16.5).
    uniqueIndex('membership_one_owner_per_unit')
      .on(t.buildingId, t.unitId)
      .where(sql`${t.memberType} = 'owner' AND ${t.status} <> 'removed'`),
    // One membership per account and unit, and the request guard's lookup, which runs before the building is known.
    uniqueIndex('membership_one_per_account_unit')
      .on(t.accountId, t.unitId)
      .where(sql`${t.status} <> 'removed'`),
    index('membership_unit_idx').on(t.buildingId, t.unitId, t.status),
    index('membership_building_active_idx')
      .on(t.buildingId, t.id)
      .where(sql`${t.status} = 'active'`),
    check('ck_membership_type', sql`${t.memberType} IN ('owner', 'family', 'tenant', 'helper')`),
    check('ck_membership_status', sql`${t.status} IN ('active', 'locked', 'removed')`),
    check('ck_membership_locked_by', sql`${t.lockedBy} IN ('owner', 'manager')`),
    check('ck_membership_credential_version', sql`${t.credentialVersion} >= 1`),
    check('ck_membership_added_by_kind', sql`${t.addedByKind} IN ('staff', 'resident')`),
    check(
      'membership_locked_by_iff_locked',
      sql`(${t.status} = 'locked') = (${t.lockedBy} IS NOT NULL)`,
    ),
    check(
      'membership_removed_at_iff_removed',
      sql`(${t.status} = 'removed') = (${t.removedAt} IS NOT NULL)`,
    ),
  ],
)

/** One change of a unit; append-only (DOC-16 §5.4). */
export const unitHistory = residency.table(
  'unit_history',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    kind: text('kind').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: uuid('actor_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    details: jsonb('details').notNull().default({}),
  },
  (t) => [
    primaryKey({ name: 'pk_unit_history', columns: [t.id] }),
    foreignKey({
      name: 'fk_unit_history_unit',
      columns: [t.unitId],
      foreignColumns: [unit.id],
    }),
    index('unit_history_unit_idx').on(t.buildingId, t.unitId, sql`${t.at} DESC`),
    check(
      'ck_unit_history_kind',
      sql`${t.kind} IN ('owner_changed', 'moved_in', 'moved_out', 'member_added', 'member_removed')`,
    ),
    check('ck_unit_history_actor_kind', sql`${t.actorKind} IN ('staff', 'resident', 'system')`),
    check('unit_history_actor_id', sql`(${t.actorKind} = 'system') = (${t.actorId} IS NULL)`),
  ],
)

/** One units-and-owners import: its preview, its file and its fate (DOC-16 §5.5, DR-21). */
export const importJob = residency.table(
  'import_job',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    // The `file_object.id` of the upload: `FilesApi` keeps the object key private (DR-86), so a job holds the id.
    fileKey: text('file_key').notNull(),
    fileName: text('file_name'),
    params: jsonb('params').notNull().default({}),
    result: jsonb('result').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'pk_import_job', columns: [t.id] }),
    // The import history of E-169.
    index('import_job_building_idx').on(t.buildingId, sql`${t.createdAt} DESC`),
    // `import_purge` keeps files and rows 30 days.
    index('import_job_purge_idx').on(t.createdAt),
    check('ck_import_job_kind', sql`${t.kind} IN ('unit_owner')`),
    check(
      'ck_import_job_status',
      sql`${t.status} IN ('validated', 'failed', 'committed', 'expired')`,
    ),
    check(
      'import_job_committed_at_iff_committed',
      sql`(${t.status} = 'committed') = (${t.committedAt} IS NOT NULL)`,
    ),
    check('ck_import_job_expires_after_create', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

export const residencyOutbox = outboxTable(residency)
export const residencyInbox = inboxTable(residency)
