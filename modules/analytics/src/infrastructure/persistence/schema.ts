import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * DOC-17 §9A: the two tables of the usage record (DR-279, ADR-0028; behavior in DOC-104). Neither has a column for an account,
 * membership, unit, role, device, token, IP address or user agent, and none may be added without a new DR (UA-02). A building is
 * referenced by id, with no foreign key (ADR-0014).
 */
export const analytics = pgSchema('analytics')

/** One screen view, tap, opening or closing of an app that a signed-in client reported (DOC-17 §9A.1). Never updated. */
export const usageEvent = analytics.table(
  'usage_event',
  {
    id: uuid('id').notNull(),
    buildingId: uuid('building_id').notNull(),
    /** The receive time minus `ageMs`, to the second: the phone's own clock is never used (DOC-104 §3). */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    app: text('app').notNull(),
    platform: text('platform').notNull(),
    appVersion: text('app_version').notNull(),
    /** The kind of the token, never the role. */
    audience: text('audience').notNull(),
    sessionId: uuid('session_id').notNull(),
    event: text('event').notNull(),
    /** A screen id, `<Screen>.<control>` for a tap, `Launch`, `Resume` or `Background`. */
    name: text('name').notNull(),
    /** `app_close` only: the seconds of the foreground stretch. */
    durationS: integer('duration_s'),
  },
  (t) => [
    primaryKey({ name: 'pk_usage_event', columns: [t.id] }),
    check('ck_usage_event_app', sql`${t.app} IN ('resident', 'staff', 'web')`),
    check('ck_usage_event_platform', sql`${t.platform} IN ('ios', 'android', 'web')`),
    check(
      'ck_usage_event_version',
      sql`${t.appVersion} ~ '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,4}$'`,
    ),
    check('ck_usage_event_audience', sql`${t.audience} IN ('resident', 'staff')`),
    check(
      'ck_usage_event_event',
      sql`${t.event} IN ('screen_view', 'tap', 'app_open', 'app_close')`,
    ),
    check(
      'ck_usage_event_name',
      sql`char_length(${t.name}) <= 60 AND ${t.name} ~ '^[A-Z][A-Za-z0-9-]*(\\.[a-z][a-z0-9_]*)?$'`,
    ),
    check('ck_usage_event_name_form', sql`(${t.event} = 'tap') = (position('.' IN ${t.name}) > 0)`),
    check(
      'ck_usage_event_lifecycle',
      sql`(${t.event} = 'app_open' AND ${t.name} IN ('Launch', 'Resume')) OR (${t.event} = 'app_close' AND ${t.name} = 'Background') OR ${t.event} IN ('screen_view', 'tap')`,
    ),
    check(
      'ck_usage_event_duration',
      sql`(${t.event} = 'app_close') = (${t.durationS} IS NOT NULL) AND (${t.durationS} IS NULL OR ${t.durationS} BETWEEN 0 AND 86400)`,
    ),
    index('ix_usage_event_building_at').on(t.buildingId, t.occurredAt),
  ],
)

/**
 * The daily rollup (DOC-17 §9A.2): one day in the building's time zone, app, platform, audience, event and name. It holds no
 * session id and no time of day, so it cannot be joined back to a person or to a moment.
 */
export const usageDaily = analytics.table(
  'usage_daily',
  {
    buildingId: uuid('building_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    app: text('app').notNull(),
    platform: text('platform').notNull(),
    audience: text('audience').notNull(),
    event: text('event').notNull(),
    name: text('name').notNull(),
    events: integer('events').notNull(),
    sessions: integer('sessions').notNull(),
    /** The sum of `duration_s` of the `app_close` rows of the group; 0 for every other event. */
    seconds: bigint('seconds', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: 'pk_usage_daily',
      columns: [t.buildingId, t.day, t.app, t.platform, t.audience, t.event, t.name],
    }),
    check('ck_usage_daily_app', sql`${t.app} IN ('resident', 'staff', 'web')`),
    check('ck_usage_daily_platform', sql`${t.platform} IN ('ios', 'android', 'web')`),
    check('ck_usage_daily_audience', sql`${t.audience} IN ('resident', 'staff')`),
    check(
      'ck_usage_daily_event',
      sql`${t.event} IN ('screen_view', 'tap', 'app_open', 'app_close')`,
    ),
    check(
      'ck_usage_daily_counts',
      sql`${t.events} >= 1 AND ${t.sessions} BETWEEN 1 AND ${t.events}`,
    ),
    check('ck_usage_daily_seconds', sql`${t.event} = 'app_close' OR ${t.seconds} = 0`),
  ],
)
