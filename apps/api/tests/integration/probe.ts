import type { Database } from '@core/db'
import {
  DrizzleInboxGuard,
  type InboxTable,
  type IntegrationEventHandler,
  inboxTable,
  type OutboxTable,
  outboxTable,
} from '@core/messaging'
import { sql } from 'drizzle-orm'
import { pgSchema } from 'drizzle-orm/pg-core'
import type { Sql } from 'postgres'

/**
 * A stand-in for a publishing module until the real ones exist: the schema `probe` with the outbox and inbox of DOC-17 §3.3
 * and a table that records every effect a handler had, so a test can count them. `building.job_run` is DOC-17 §3.2.
 * Created through the `rms_migrator` connection of the cloned database, then granted to `rms_app` as DOC-19 does.
 */

const probeSchema = pgSchema('probe')
export const probeOutbox: OutboxTable = outboxTable(probeSchema)
export const probeInbox: InboxTable = inboxTable(probeSchema)

export async function createProbeModule(admin: Sql, schema = 'probe') {
  await admin.unsafe(`
    CREATE SCHEMA IF NOT EXISTS ${schema};
    CREATE TABLE ${schema}.outbox_messages (
      id uuid PRIMARY KEY, type text NOT NULL, aggregate_id text NOT NULL, payload jsonb NOT NULL, headers jsonb NOT NULL,
      occurred_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
      locked_until timestamptz, published_at timestamptz, dead_at timestamptz, last_error text);
    CREATE INDEX outbox_pending_idx ON ${schema}.outbox_messages (next_attempt_at) WHERE published_at IS NULL AND dead_at IS NULL;
    CREATE TABLE ${schema}.inbox (
      message_id uuid NOT NULL, handler text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (message_id, handler));
    CREATE TABLE ${schema}.effects (
      id bigserial PRIMARY KEY, message_id uuid NOT NULL, handler text NOT NULL, relay text NOT NULL DEFAULT '',
      at timestamptz NOT NULL DEFAULT now());
    GRANT USAGE ON SCHEMA ${schema} TO rms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO rms_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO rms_app;`)
}

export async function createJobRunTable(admin: Sql) {
  await admin.unsafe(`
    CREATE SCHEMA IF NOT EXISTS building;
    CREATE TABLE building.job_run (
      id uuid NOT NULL, name text NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL,
      status text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
      CONSTRAINT pk_job_run PRIMARY KEY (id),
      CONSTRAINT ck_job_run_name CHECK (name ~ '^[a-z][a-z0-9_]{2,40}$'),
      CONSTRAINT ck_job_run_status CHECK (status IN ('succeeded', 'failed')),
      CONSTRAINT ck_job_run_times CHECK (finished_at >= started_at),
      CONSTRAINT ck_job_run_details CHECK (jsonb_typeof(details) = 'object'));
    CREATE INDEX ix_job_run_started ON building.job_run (started_at);
    CREATE INDEX ix_job_run_name_success ON building.job_run (name, finished_at DESC) WHERE status = 'succeeded';
    GRANT USAGE ON SCHEMA building TO rms_app;
    GRANT SELECT, INSERT, DELETE ON building.job_run TO rms_app;`)
}

/** A handler whose effect is one row of `probe.effects`, written once thanks to the inbox. */
export function effectHandler(
  database: Database,
  name: string,
  options: { failTimes?: number; delayMs?: number; relay?: string; log?: string[] } = {},
): IntegrationEventHandler {
  const inbox = new DrizzleInboxGuard(database, probeInbox)
  let failures = options.failTimes ?? 0
  return {
    name,
    eventType: 'probe.thing_happened.v1',
    async handle(message) {
      options.log?.push(`${name}:${message.id}`)
      if (options.delayMs) await Bun.sleep(options.delayMs)
      await inbox.transactional(message.id, name, async () => {
        if (failures > 0) {
          failures--
          throw new Error(`${name} fails`)
        }
        await database.executor.execute(
          sql`insert into probe.effects (message_id, handler, relay) values (${message.id}, ${name}, ${options.relay ?? ''})`,
        )
      })
    },
  }
}
