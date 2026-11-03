import type { Database } from '@core/db'
import type { RequestSample } from '@core/http'
import type { OutboxStats } from '@core/messaging'
import type { JobRunEvent, SqlJobRunStore } from '@core/runtime'
import { Metrics } from '@core/telemetry'
import type { AuditMetrics } from '@mod/audit'
import type { UsageReporter } from '@mod/building'
import type {
  CounterLabels,
  CounterName,
  HistogramLabels,
  HistogramName,
  MetricsPort,
} from '@rms/shared-types'

/**
 * The metric catalog of DOC-40 §4 as code: every name, type and label set below is a row of that document, and the test
 * `metrics.test.ts` (OB-01) fails when the two differ. A metric is added in the same change as its row (DOC-12 §14 rule 13).
 */

/** NFR-03: p95 ≤ 0.3 s and p99 ≤ 0.8 s, so the buckets surround both (DOC-40 §4.1). */
const HTTP_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1.5, 3, 6, 12]
const JOB_BUCKETS = [0.1, 0.5, 1, 5, 30, 120, 600]
/** The semantic version of a native app (DOC-50 §3): anything else is one `invalid` series, so a client cannot make labels. */
const SEMVER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
const NATIVE_APPS = new Set(['resident', 'staff'])

/** Every counter of `CounterLabels` with its help text and label names: the type makes a missing row a compile error. */
const COUNTERS: {
  [N in CounterName]: { help: string; labels: Array<keyof NonNullable<CounterLabels[N]>> }
} = {
  auth_staff_login_total: { help: 'Staff sign-ins, by outcome.', labels: ['outcome'] },
  auth_lockouts_total: { help: 'Staff accounts locked by failed passwords.', labels: [] },
  auth_otp_requested_total: { help: 'OTP requests, by outcome.', labels: ['outcome'] },
  auth_otp_verify_total: { help: 'OTP verifications, by outcome.', labels: ['outcome'] },
  otp_daily_cap_reached_total: { help: 'Times the daily OTP cap refused a request.', labels: [] },
  auth_refresh_total: { help: 'Token refreshes, by outcome.', labels: ['outcome'] },
  auth_sessions_revoked_total: { help: 'Sessions revoked, by reason.', labels: ['reason'] },
  auth_step_up_total: {
    help: 'Step-up codes, by action and outcome.',
    labels: ['action', 'outcome'],
  },
  sms_sent_total: { help: 'SMS commands, by outcome.', labels: ['outcome'] },
  mail_sent_total: { help: 'Mail commands, by outcome.', labels: ['outcome'] },
  membership_changes_total: {
    help: 'Membership changes, by change and actor.',
    labels: ['change', 'actor'],
  },
  membership_guard_refusals_total: {
    help: 'Requests refused by the unit guard, by reason.',
    labels: ['reason'],
  },
  member_invitations_total: { help: 'Member invitations, by outcome.', labels: ['outcome'] },
  owner_transfers_total: {
    help: 'Ownership transfers, by whether members were kept.',
    labels: ['keep_members'],
  },
  import_commits_total: { help: 'Import commits, by outcome.', labels: ['outcome'] },
  client_errors_total: {
    help: 'Errors reported by the clients, by app and kind.',
    labels: ['app', 'kind'],
  },
  usage_events_total: {
    help: 'Usage events written, by app, audience, event and name (DR-279).',
    labels: ['app', 'audience', 'event', 'name'],
  },
  usage_events_dropped_total: {
    help: 'Usage events discarded after validation, by reason (DR-279).',
    labels: ['reason'],
  },
  inbox_entries_created_total: {
    help: 'Inbox entries inserted, by template key (DOC-31 §10).',
    labels: ['template_key'],
  },
  push_sent_total: { help: 'Push sends, by outcome (DOC-31 §10).', labels: ['outcome'] },
  push_receipts_total: {
    help: 'Push receipts read, by outcome (DOC-31 §10).',
    labels: ['outcome'],
  },
  delivery_failed_total: {
    help: 'Deliveries that failed at the provider, by channel and reason (DOC-42 §8.5).',
    labels: ['channel', 'reason'],
  },
  provider_auth_failed_total: {
    help: 'Provider answers that refused our credentials, by provider (DOC-42 §7.1).',
    labels: ['provider'],
  },
  sse_stream_opens_total: {
    help: 'Opens of the staff event stream, by outcome (DOC-52 §15).',
    labels: ['outcome'],
  },
  sse_events_published_total: {
    help: 'Events written to the replay buffer, by type (DOC-52 §15).',
    labels: ['type'],
  },
}

const HISTOGRAMS: {
  [N in HistogramName]: {
    help: string
    buckets: number[]
    labels: Array<keyof NonNullable<HistogramLabels[N]>>
  }
} = {
  import_validate_duration_seconds: {
    help: 'Duration of the synchronous validation of an import (NFR-12: 2,000 rows in 10 s).',
    buckets: [0.5, 1, 2, 5, 10, 20],
    labels: [],
  },
  demo_reset_duration_seconds: {
    help: 'Duration of a reset of the demo building (DOC-36 §10.2: 10 s on the staging host).',
    buckets: [1, 2, 5, 10, 20, 60],
    labels: [],
  },
  usage_foreground_seconds: {
    help: 'Seconds of one foreground stretch of an app, one observation per app_close written (DR-279).',
    buckets: [10, 30, 60, 180, 600, 1800, 3600],
    labels: ['app', 'audience'],
  },
}

export interface MetricsSettings {
  /** `METRICS_CACHE_SECONDS`. */
  cacheSeconds: number
  /** `METRICS_QUERY_TIMEOUT_MS`. */
  queryTimeoutMs: number
}

/** The registry of this process with the metrics that the code increments; the database-derived gauges join in `registerPulledMetrics`. */
export function createAppMetrics(settings: MetricsSettings) {
  const metrics = new Metrics(settings)
  metrics.registerProcessMetrics()

  const httpDuration = metrics.histogram(
    'http_request_duration_seconds',
    'Duration of HTTP requests, by route template and status.',
    HTTP_BUCKETS,
    ['method', 'route', 'status'],
  )
  const apiErrors = metrics.counter('api_errors_total', 'Error answers, by error code.', [
    'code',
    'status',
  ])
  const idempotency = metrics.counter(
    'idempotency_total',
    'Requests that carried an Idempotency-Key, by outcome.',
    ['outcome'],
  )
  const rateLimited = metrics.counter(
    'rate_limited_total',
    'Requests refused by a rate-limit bucket, by bucket family (details.scope of the 429).',
    ['scope'],
  )
  const appVersions = metrics.counter(
    'app_version_requests_total',
    'Requests of the native apps, by app and version.',
    ['app', 'version'],
  )
  const handlerOutcomes = metrics.counter(
    'handler_outcomes_total',
    'Outbox event handlers, by outcome.',
    ['handler', 'outcome'],
  )
  const jobRuns = metrics.counter('job_runs_total', 'Runs of a job, by status.', [
    'job_name',
    'status',
  ])
  const jobDuration = metrics.histogram(
    'job_duration_seconds',
    'Duration of a job run.',
    JOB_BUCKETS,
    ['job_name'],
  )
  const auditPurged = metrics.counter(
    'audit_purge_rows_total',
    'Audit rows purged, by retention class.',
    ['class'],
  )
  const auditWriteFailures = metrics.counter(
    'audit_write_failures_total',
    'Audit rows that could not be written.',
  )
  const storageUsage = metrics.gauge(
    'storage_usage_ratio',
    'File storage used against the quota of the building.',
    ['building'],
  )

  const counters = new Map(
    (Object.entries(COUNTERS) as Array<[CounterName, (typeof COUNTERS)[CounterName]]>).map(
      ([name, { help, labels }]) => [name, metrics.counter(name, help, labels as string[])],
    ),
  )
  const histograms = new Map(
    (Object.entries(HISTOGRAMS) as Array<[HistogramName, (typeof HISTOGRAMS)[HistogramName]]>).map(
      ([name, { help, buckets, labels }]) => [
        name,
        metrics.histogram(name, help, buckets, labels as string[]),
      ],
    ),
  )
  /** What the modules receive (`MetricsPort`): the compiler holds names and label values to DOC-40, the maps below hold the series. */
  const port: MetricsPort = {
    inc: (name, ...labels) =>
      counters.get(name)?.inc(((labels as unknown[])[0] ?? {}) as Record<string, string>),
    add: (name, by, ...labels) =>
      counters.get(name)?.inc(((labels as unknown[])[0] ?? {}) as Record<string, string>, by),
    observe: (name, seconds, ...labels) =>
      histograms
        .get(name)
        ?.observe(((labels as unknown[])[0] ?? {}) as Record<string, string>, seconds),
  }

  return {
    metrics,
    port,
    /** Passed to `requestLogPlugin({ observe })`. */
    request(sample: RequestSample) {
      httpDuration.observe(
        { method: sample.method, route: sample.route, status: String(sample.status) },
        sample.seconds,
      )
      if (sample.code) apiErrors.inc({ code: sample.code, status: String(sample.status) })
      // The scope is chosen by our code, never by the caller; the clean-up keeps it a label even if a bucket is named oddly.
      if (sample.scope)
        rateLimited.inc({ scope: sample.scope.replace(/[^a-z0-9]+/gi, '_').slice(0, 32) })
      if (sample.appId && NATIVE_APPS.has(sample.appId))
        appVersions.inc({
          app: sample.appId,
          version:
            sample.appVersion && SEMVER.test(sample.appVersion) ? sample.appVersion : 'invalid',
        })
    },
    /** Passed to `createIdempotent`. */
    idempotency: (outcome: 'first' | 'replay' | 'reuse' | 'in_progress') =>
      idempotency.inc({ outcome }),
    /** Passed to `createRuntime({ onHandler })`. */
    handler: (handler: string, outcome: 'ok' | 'deferred' | 'failed') =>
      handlerOutcomes.inc({ handler, outcome }),
    /** Passed to `createRuntime({ jobs: { onRun } })`: a run that another process holds the lock for did not run. */
    jobRun(event: JobRunEvent) {
      if (event.status === 'skipped_locked') return
      jobRuns.inc({ job_name: event.name, status: event.status })
      jobDuration.observe({ job_name: event.name }, event.durationMs / 1000)
    },
    /** `AuditMetrics`. */
    audit: {
      writeFailed: () => auditWriteFailures.inc(),
      purged: (scope, rows) => auditPurged.inc({ class: scope }, rows),
    } satisfies AuditMetrics,
    /** `UsageReporter`: a demo building is left out of the system-wide gauge (DOC-36 §9.3, BD-36). */
    usage: {
      report(buildingId, ratio, isDemo) {
        if (!isDemo) storageUsage.set({ building: buildingId }, ratio)
      },
    } satisfies UsageReporter,
  }
}

export type AppMetrics = ReturnType<typeof createAppMetrics>

export interface PulledSources {
  database: Database
  /** `building.job_run`, for the gauges that are the result of a job. */
  jobRuns: Pick<SqlJobRunStore, 'lastSuccessDetails'>
  /** The outboxes of the installed modules. */
  outboxes: OutboxStats
  /** Readiness as `/health/ready` answers it: the database, the relay of a worker, not stopping. */
  ready: () => Promise<boolean>
  /** Only a `worker` role runs the relay and the jobs. */
  worker?: {
    relayLastPassAt: () => Date | undefined
    jobLastSuccess: () => ReadonlyMap<string, Date>
  }
}

const seconds = (date: Date) => date.getTime() / 1000

/**
 * The gauges that are read at the scrape (DOC-40 §4 rule 3): the database ones exist in every process, so they are there when
 * the worker is down; the alerts take `max(...)`.
 */
export function registerPulledMetrics(
  { metrics }: Pick<AppMetrics, 'metrics'>,
  { database, jobRuns, outboxes, ready, worker }: PulledSources,
  settings: MetricsSettings,
) {
  metrics.pulled(
    'db_pool_waiting',
    'Transactions started beyond the connection pool size (a lower bound).',
    [],
    async () => [{ value: database.poolWaiting }],
    { cacheSeconds: 0 },
  )

  // Never cached, and never "no data": a hung dependency is 0, not the last good value.
  const readyWithin = Math.max(100, settings.queryTimeoutMs - 200)
  metrics.pulled(
    'readiness_ok',
    '1 when the process answers /health/ready with 200, else 0.',
    [],
    async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const ok = await Promise.race([
        ready().catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), readyWithin)
        }),
      ]).finally(() => clearTimeout(timer))
      return [{ value: ok ? 1 : 0 }]
    },
    { cacheSeconds: 0 },
  )

  metrics.pulled(
    'outbox_oldest_unpublished_age_seconds',
    'Age of the oldest outbox message that is neither published nor dead; 0 when none.',
    ['schema'],
    async () =>
      (await outboxes.oldestUnpublishedAgeSeconds()).map(({ source, seconds }) => ({
        labels: { schema: source },
        value: seconds,
      })),
  )

  metrics.pulled(
    'outbox_dead_letters',
    'Outbox messages in the dead-letter state.',
    ['schema'],
    async () =>
      (await outboxes.deadLetters()).map(({ source, count }) => ({
        labels: { schema: source },
        value: count,
      })),
  )

  // DOC-22 §12, DOC-40 §4.2: the rows the last successful `invariant_check` found, read from its `job_run` row so that every
  // process exports the same value, the worker down or not. The job skips demo buildings, so none is counted (DOC-40 §4 rule 4).
  // A failed run does not move it (the alert `InvariantCheckStale` is for that); no run yet is 0.
  metrics.pulled(
    'ledger_invariant_violations',
    'Rows over the 19 queries of the last successful nightly ledger check (demo buildings excluded).',
    [],
    async () => [
      { value: Number((await jobRuns.lastSuccessDetails('invariant_check'))?.violations ?? 0) },
    ],
  )

  if (!worker) return
  metrics.pulled(
    'worker_relay_last_pass_timestamp',
    'Unix time of the last finished pass of the outbox relay.',
    [],
    async () => {
      const at = worker.relayLastPassAt()
      return at ? [{ value: seconds(at) }] : []
    },
    { cacheSeconds: 0 },
  )
  metrics.pulled(
    'job_last_success_timestamp',
    'Unix time of the last successful run of a job.',
    ['job_name'],
    async () =>
      [...worker.jobLastSuccess()].map(([name, at]) => ({
        labels: { job_name: name },
        value: seconds(at),
      })),
    { cacheSeconds: 0 },
  )
}
