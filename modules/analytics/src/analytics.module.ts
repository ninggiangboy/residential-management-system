import type { Database } from '@core/db'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import type { AppModule } from '@core/runtime'
import type { BuildingApi } from '@mod/building/contracts'
import { type Guards, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import type { AnalyticsConfig } from './application/ports'
import { UsageRateLimits } from './application/usage-rate-limits'
import { RecordUsageEvents } from './application/use-cases/record-usage-events'
import { RollUpUsage } from './application/use-cases/roll-up-usage'
import { usageRollupJob } from './infrastructure/jobs/usage-rollup'
import { DrizzleUsageDailyRepository } from './infrastructure/persistence/drizzle-usage-daily-repository'
import { DrizzleUsageEventRepository } from './infrastructure/persistence/drizzle-usage-event-repository'
import { SqlRateLimiter } from './infrastructure/persistence/sql-rate-limiter'
import { usageRoutes } from './presentation/usage-routes'

export interface AnalyticsDeps {
  /** Whether a building is the demo one: its events are discarded (DOC-104 §6.1 step 7). */
  building: Pick<BuildingApi, 'isDemo'>
  guards: Guards
  config: AnalyticsConfig & {
    /** `JOB_USAGE_ROLLUP_GRACE_MINUTES` (DOC-41 §11). */
    rollupGraceMinutes: number
  }
  /** `MetricsPort` of the host (DOC-40 §4.7). */
  metrics?: MetricsPort
}

export interface AnalyticsModuleDeps extends AnalyticsDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

/** What the routes and the job call (DOC-12 §4.5). */
export interface AnalyticsUseCases {
  /** `POST /me/usage-events` (E-173) and `POST /staff/usage-events` (E-174). */
  recordUsageEvents: RecordUsageEvents
  /** One building's run of the job `usage_rollup`. */
  rollUpUsage: RollUpUsage
}

export interface AnalyticsModule extends AppModule<'analytics'> {
  readonly useCases: AnalyticsUseCases
  readonly routes: AnalyticsRoutes
}

export type AnalyticsRoutes = ReturnType<typeof usageRoutes>

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createAnalyticsModule(deps: AnalyticsModuleDeps): AnalyticsModule {
  const { database, clock, ids, config } = deps
  const metrics = deps.metrics ?? NO_METRICS
  const events = new DrizzleUsageEventRepository(database)
  const daily = new DrizzleUsageDailyRepository(database)
  const limits = new UsageRateLimits(new SqlRateLimiter(database), config)
  const recordUsageEvents = new RecordUsageEvents(
    events,
    limits,
    deps.building,
    clock,
    ids,
    config,
    metrics,
  )
  const rollUpUsage = new RollUpUsage(events, daily, database, clock, config)
  return {
    name: 'analytics',
    docs: [
      {
        name: 'usage',
        description:
          'The apps report which screens are opened, which listed controls are pressed and for how long the app is open. Nothing identifies a person.',
      },
    ],
    useCases: { recordUsageEvents, rollUpUsage },
    routes: usageRoutes({ recordUsageEvents, limits, guards: deps.guards }),
    jobs: [usageRollupJob(rollUpUsage, config.rollupGraceMinutes)],
  }
}
