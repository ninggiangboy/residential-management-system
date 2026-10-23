import { inboxTable, outboxTable } from '@core/messaging'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  doublePrecision,
  foreignKey,
  index,
  inet,
  integer,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-16 §4.1, §4.4, §4.5, §4.6: the staff side of `identity` (P1-10), plus the outbox and inbox of the module
 * (`identity.mail_requested.v1`, `identity.session_revoked.v1`). The resident tables of §4.2 and §4.3 (`resident_account`,
 * `otp_challenge`) are P1-11, in the third migration. Names follow DOC-14 §11. What drizzle-kit cannot express (the deferrable
 * foreign key of `replaced_by_id`) is in the second migration.
 */
export const identity = pgSchema('identity')

const citext = customType<{ data: string }>({ dataType: () => 'citext' })

export const staffAccount = identity.table(
  'staff_account',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('invited'),
    passwordHash: text('password_hash'),
    failedAttempts: smallint('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    language: text('language').notNull().default('vi'),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    avatarKey: text('avatar_key'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_staff_account', columns: [t.id] }),
    uniqueIndex('uq_staff_account_email').on(t.email),
    index('ix_staff_account_building_role').on(t.buildingId, t.role, t.status),
    check('ck_staff_account_role', sql`${t.role} IN ('admin', 'manager', 'technician', 'guard')`),
    check(
      'ck_staff_account_status',
      sql`${t.status} IN ('invited', 'active', 'locked', 'disabled')`,
    ),
    check('ck_staff_account_attempts', sql`${t.failedAttempts} >= 0`),
    check('ck_staff_account_language', sql`${t.language} IN ('vi', 'en')`),
    check(
      'ck_staff_account_password',
      sql`${t.status} = 'invited' OR ${t.passwordHash} IS NOT NULL`,
    ),
  ],
)

/** A phone number, one account (DOC-16 §4.2). It holds no rights: those are memberships of `residency`. */
export const residentAccount = identity.table(
  'resident_account',
  {
    id: uuid('id').notNull(),
    phone: text('phone').notNull(),
    displayName: text('display_name'),
    avatarKey: text('avatar_key'),
    language: text('language').notNull().default('vi'),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    status: text('status').notNull().default('active'),
    isDemo: boolean('is_demo').notNull().default(false),
    lastAppOpenAt: timestamp('last_app_open_at', { withTimezone: true }),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    deletionApprovedAt: timestamp('deletion_approved_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'pk_resident_account', columns: [t.id] }),
    uniqueIndex('resident_account_phone_key').on(t.phone),
    // A suffix match of a phone fragment becomes a prefix match on the reversed number (DR-41).
    index('resident_account_phone_suffix_idx').using(
      'btree',
      sql`reverse(${t.phone}) text_pattern_ops`,
    ),
    index('resident_account_deletion_idx')
      .on(t.deletionApprovedAt)
      .where(sql`${t.status} = 'deletion_requested' AND ${t.deletionApprovedAt} IS NOT NULL`),
    check(
      'ck_resident_account_phone',
      sql`${t.phone} ~ '^[+][1-9][0-9]{6,14}$' OR ${t.phone} ~ '^deleted:[0-9a-f-]{36}$'`,
    ),
    check('ck_resident_account_language', sql`${t.language} IN ('vi', 'en')`),
    check(
      'ck_resident_account_status',
      sql`${t.status} IN ('active', 'deletion_requested', 'deleted')`,
    ),
    check(
      'ck_resident_account_name_unless_deleted',
      sql`${t.status} = 'deleted' OR ${t.displayName} IS NOT NULL`,
    ),
    check(
      'ck_resident_account_deletion_dates',
      sql`(${t.status} = 'active' AND ${t.deletionRequestedAt} IS NULL AND ${t.deletionApprovedAt} IS NULL AND ${t.deletedAt} IS NULL)
        OR (${t.status} = 'deletion_requested' AND ${t.deletionRequestedAt} IS NOT NULL AND ${t.deletedAt} IS NULL)
        OR (${t.status} = 'deleted' AND ${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      'ck_resident_account_deleted_phone',
      sql`(${t.status} = 'deleted') = (${t.phone} LIKE 'deleted:%')`,
    ),
  ],
)

/** One SMS code sent to one phone (DOC-16 §4.3). No building: a challenge exists before the person has chosen a unit. */
export const otpChallenge = identity.table(
  'otp_challenge',
  {
    id: uuid('id').notNull(),
    phone: text('phone').notNull(),
    codeHmac: text('code_hmac').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resendAfter: timestamp('resend_after', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_otp_challenge', columns: [t.id] }),
    // One live challenge per phone (DR-37): a new request first consumes the older one.
    uniqueIndex('otp_challenge_one_live_per_phone').on(t.phone).where(sql`${t.consumedAt} IS NULL`),
    index('otp_challenge_created_idx').on(t.createdAt),
    check('ck_otp_challenge_attempts', sql`${t.attempts} BETWEEN 0 AND 5`),
    check('ck_otp_challenge_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

export const passwordToken = identity.table(
  'password_token',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    staffId: uuid('staff_id').notNull(),
    kind: text('kind').notNull(),
    action: text('action'),
    attempts: smallint('attempts').notNull().default(0),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_password_token', columns: [t.id] }),
    foreignKey({
      name: 'fk_password_token_staff_account',
      columns: [t.staffId],
      foreignColumns: [staffAccount.id],
    }),
    // A link is found by its hash; a step-up code is not unique across staff (six digits), so it is found by staff and action.
    uniqueIndex('uq_password_token_link_hash')
      .on(t.tokenHash)
      .where(sql`${t.kind} IN ('reset', 'invite')`),
    // One live token per staff member, kind and action: issuing a new one consumes the older first (DR-39, FR-50.1).
    uniqueIndex('uq_password_token_one_live')
      .on(t.staffId, t.kind, sql`(COALESCE(${t.action}, ''))`)
      .where(sql`${t.consumedAt} IS NULL`),
    index('ix_password_token_created').on(t.createdAt),
    check('ck_password_token_kind', sql`${t.kind} IN ('reset', 'invite', 'step_up')`),
    check(
      'ck_password_token_action',
      sql`${t.action} IS NULL OR ${t.action} IN ('gateway_config', 'admin_change', 'staff_email')`,
    ),
    check(
      'ck_password_token_action_kind',
      sql`(${t.kind} = 'step_up') = (${t.action} IS NOT NULL)`,
    ),
    check('ck_password_token_attempts', sql`${t.attempts} BETWEEN 0 AND 5`),
    check('ck_password_token_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
)

export const refreshFamily = identity.table(
  'refresh_family',
  {
    id: uuid('id').notNull(),
    kind: text('kind').notNull(),
    accountId: uuid('account_id').notNull(),
    buildingId: uuid('building_id'),
    userAgent: text('user_agent'),
    client: text('client').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    primaryKey({ name: 'pk_refresh_family', columns: [t.id] }),
    index('ix_refresh_family_account').on(t.kind, t.accountId).where(sql`${t.revokedAt} IS NULL`),
    index('ix_refresh_family_expiry').on(t.absoluteExpiresAt),
    check('ck_refresh_family_kind', sql`${t.kind} IN ('staff', 'resident')`),
    check('ck_refresh_family_client', sql`${t.client} IN ('web', 'app')`),
    check(
      'ck_refresh_family_reason',
      sql`${t.revokedReason} IN ('sign_out', 'user_revoked', 'token_reuse', 'cap_exceeded', 'account_locked', 'account_disabled', 'role_changed', 'phone_changed', 'password_changed', 'deleted')`,
    ),
    check('ck_refresh_family_building', sql`(${t.kind} = 'staff') = (${t.buildingId} IS NOT NULL)`),
    check(
      'ck_refresh_family_revocation',
      sql`(${t.revokedAt} IS NULL) = (${t.revokedReason} IS NULL)`,
    ),
  ],
)

export const refreshToken = identity.table(
  'refresh_token',
  {
    id: uuid('id').notNull(),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // The foreign key is DEFERRABLE INITIALLY DEFERRED (second migration): the successor is inserted after the consume.
    replacedById: uuid('replaced_by_id'),
  },
  (t) => [
    primaryKey({ name: 'pk_refresh_token', columns: [t.id] }),
    foreignKey({
      name: 'fk_refresh_token_refresh_family',
      columns: [t.familyId],
      foreignColumns: [refreshFamily.id],
    }).onDelete('cascade'),
    uniqueIndex('uq_refresh_token_hash').on(t.tokenHash),
    index('ix_refresh_token_family').on(t.familyId),
    check(
      'ck_refresh_token_replaced',
      sql`${t.replacedById} IS NULL OR ${t.revokedAt} IS NOT NULL`,
    ),
  ],
)

export const rateBucket = identity.table(
  'rate_bucket',
  {
    key: text('key').notNull(),
    tokens: doublePrecision('tokens').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'pk_rate_bucket', columns: [t.key] }),
    index('ix_rate_bucket_updated').on(t.updatedAt),
  ],
)

export const identityOutbox = outboxTable(identity)
export const identityInbox = inboxTable(identity)
