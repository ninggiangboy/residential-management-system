import type { Database } from '@core/db'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import type { AppModule } from '@core/runtime'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { assertMappings, RealtimePushHandler } from './application/handlers/realtime-push-handler'
import { StaffEventStreams, type StreamSettings } from './application/staff-event-streams'
import type { RealtimeMapping } from './contracts'
import { realtimePurgeJob } from './infrastructure/jobs/realtime-purge'
import { DrizzleRealtimeStore } from './infrastructure/persistence/drizzle-realtime-store'
import { PgRealtimeHub } from './infrastructure/pg-realtime-hub'

export interface RealtimeDeps {
  /** The producers' `integrations/realtime.ts` mappings, handed in by `apps/api` (DOC-12 §4.4). */
  mappings: readonly RealtimeMapping<never>[]
  config: StreamSettings
  metrics?: MetricsPort
}

export interface RealtimeModuleDeps extends RealtimeDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

export interface RealtimeModule extends AppModule<'realtime'> {
  /** E-75 opens a stream through this (DOC-52 §4). */
  readonly streams: StaffEventStreams
}

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createRealtimeModule(deps: RealtimeModuleDeps): RealtimeModule {
  const { database, clock, ids, logger, config } = deps
  const metrics = deps.metrics ?? NO_METRICS
  assertMappings(deps.mappings)
  const store = new DrizzleRealtimeStore(database)
  const hub = new PgRealtimeHub(database, logger)
  const streams = new StaffEventStreams(store, hub, clock, ids, config, metrics)
  return {
    name: 'realtime',
    docs: [
      {
        name: 'realtime',
        description:
          'The server-sent events stream of the web CMS: ids and codes that tell a screen to refetch, never personal data or money.',
      },
    ],
    streams,
    handlers: deps.mappings.map(
      (mapping) => new RealtimePushHandler(mapping, store, ids, logger, metrics),
    ),
    jobs: [realtimePurgeJob(store)],
    async close() {
      streams.closeLive()
      await hub.stop()
    },
  }
}
