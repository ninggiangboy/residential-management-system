import { type Clock, type IdGenerator, ValidationError } from '@core/kernel'
import { type MetricsPort, NO_METRICS, type UsageAudience } from '@rms/shared-types'
import { batchIssues, splitByLists, type UsageBatch } from '../../domain/usage-batch'
import type { UsageEventRepository } from '../../domain/usage-event-repository'
import type { AnalyticsConfig, BuildingDirectory } from '../ports'
import { scopeOf } from '../scope-of'
import type { UsageRateLimits } from '../usage-rate-limits'

export interface RecordUsageEventsInput {
  /** `resident` for a resident token and `staff` for a staff token: never read from the body. */
  audience: UsageAudience
  /** The building of the token or of the active membership: never read from the body (DOC-104 §6.1). */
  buildingId: string
  batch: UsageBatch
}

export interface RecordUsageEventsResult {
  /** `false` when `USAGE_ENABLED` is off: the route adds `X-Usage-Enabled: false` so the client stops (DOC-104 §5.4). */
  enabled: boolean
}

/**
 * E-173 and E-174 (DOC-104 §6.1 steps 5 to 9): checks what a schema cannot, spends the session bucket, discards the batch of a demo
 * building or while the switch is off, drops the names that are not in the lists, and writes the rest in one statement.
 *
 * It is the one write path that is not a `UnitOfWork` command with an outbox row and an audit row, on purpose: the batch changes no
 * business state, it is not an act of a person, and a lost batch costs one count (DOC-104 §6.3, DOC-12 §8.3).
 */
export class RecordUsageEvents {
  constructor(
    private readonly events: UsageEventRepository,
    private readonly limits: UsageRateLimits,
    private readonly buildings: BuildingDirectory,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: Pick<AnalyticsConfig, 'enabled'>,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  async execute({
    audience,
    buildingId,
    batch,
  }: RecordUsageEventsInput): Promise<RecordUsageEventsResult> {
    const issues = batchIssues(batch)
    if (issues.length > 0) throw new ValidationError(issues)
    await this.limits.takeSession(batch.sessionId)

    if (await this.buildings.isDemo(buildingId)) {
      this.dropped('demo', batch.events.length)
      return { enabled: this.config.enabled }
    }
    if (!this.config.enabled) {
      this.dropped('disabled', batch.events.length)
      return { enabled: false }
    }

    const { kept, dropped } = splitByLists(batch.events, () => this.ids.next())
    this.dropped('unknown_name', dropped)
    if (kept.length === 0) return { enabled: true }

    await this.events.insertBatch(scopeOf(buildingId), {
      receivedAt: this.clock.now(),
      app: batch.app,
      platform: batch.platform,
      appVersion: batch.appVersion,
      audience,
      sessionId: batch.sessionId,
      rows: kept,
    })

    for (const row of kept) {
      this.metrics.inc('usage_events_total', {
        app: batch.app,
        audience,
        event: row.event,
        name: row.name,
      })
      if (row.durationS !== null)
        this.metrics.observe('usage_foreground_seconds', row.durationS, {
          app: batch.app,
          audience,
        })
    }
    return { enabled: true }
  }

  private dropped(reason: 'unknown_name' | 'disabled' | 'demo', count: number) {
    if (count > 0) this.metrics.add('usage_events_dropped_total', count, { reason })
  }
}
