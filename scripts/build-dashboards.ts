/**
 * `bun run ops:dashboards` writes the Grafana dashboards of DOC-40 §7 to `ops/grafana/dashboards/`; `--check` fails when a file
 * differs from what it would write (stage `verify`, like `dependabot:sync`). Edit the lists below, never the JSON.
 * Money (P2, P3) and Backup (P1-21) join with their tasks.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type Dashboard, logs, render, stat, table, timeseries } from './lib/grafana'

const API = 'job="rms-api"'
const GREEN_RED: Array<[number | null, string]> = [
  [null, 'red'],
  [1, 'green'],
]

const overview: Dashboard = {
  uid: 'rms-overview',
  title: 'RMS · Overview',
  description: 'Requests, latency against NFR-03, errors and what is firing.',
  panels: [
    stat('API ready', [{ expr: `min(readiness_ok{${API}})` }], {
      thresholds: GREEN_RED,
      supports: 'ReadinessFailing',
      w: 4,
    }),
    stat('API targets up', [{ expr: `sum(up{${API}})` }], {
      thresholds: GREEN_RED,
      supports: 'ApiDown',
      w: 4,
    }),
    stat('Worker up', [{ expr: `min(up{job="rms-worker"})` }], {
      thresholds: GREEN_RED,
      supports: 'WorkerDown',
      w: 4,
    }),
    stat(
      '5xx ratio (5 min)',
      [
        {
          expr: `sum(rate(http_request_duration_seconds_count{${API},status=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count{${API}}[5m]))`,
        },
      ],
      {
        unit: 'percentunit',
        thresholds: [
          [null, 'green'],
          [0.01, 'orange'],
          [0.02, 'red'],
        ],
        supports: 'ApiErrors',
        w: 6,
      },
    ),
    stat('Alerts firing', [{ expr: 'count(ALERTS{alertstate="firing"}) or vector(0)' }], {
      thresholds: [
        [null, 'green'],
        [1, 'red'],
      ],
      w: 6,
    }),
    timeseries(
      'Request rate by route',
      [
        {
          expr: `sum by (route) (rate(http_request_duration_seconds_count{${API}}[5m]))`,
          legend: '{{route}}',
        },
      ],
      { unit: 'reqps', supports: 'NFR-03' },
    ),
    timeseries(
      'Latency p50, p95, p99',
      [
        {
          expr: `histogram_quantile(0.5, sum by (le) (rate(http_request_duration_seconds_bucket{${API}}[5m])))`,
          legend: 'p50',
        },
        {
          expr: `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${API}}[5m])))`,
          legend: 'p95',
        },
        {
          expr: `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{${API}}[5m])))`,
          legend: 'p99',
        },
      ],
      {
        unit: 's',
        description: 'Lines at 0.3 s (p95 budget) and 0.8 s (p99 budget).',
        thresholds: [
          [null, 'transparent'],
          [0.3, 'orange'],
          [0.8, 'red'],
        ],
        thresholdLines: true,
        supports: 'NFR-03',
      },
    ),
    timeseries(
      'Answers by status',
      [
        {
          expr: `sum by (status) (rate(http_request_duration_seconds_count{${API}}[5m]))`,
          legend: '{{status}}',
        },
      ],
      { unit: 'reqps', supports: 'ApiErrors' },
    ),
    timeseries(
      'Error codes',
      [{ expr: 'sum by (code) (rate(api_errors_total[5m]))', legend: '{{code}}' }],
      { unit: 'reqps', description: 'api_errors_total by the code of DOC-42.' },
    ),
    table('Alerts firing', [{ expr: 'ALERTS{alertstate="firing"}' }], {
      w: 24,
      h: 6,
      transformations: [
        { id: 'organize', options: { excludeByName: { Time: true, Value: true, __name__: true } } },
      ],
    }),
  ],
}

const workerJobs: Dashboard = {
  uid: 'rms-worker-jobs',
  title: 'RMS · Worker and jobs',
  description: 'The outbox, the relay and the scheduled jobs.',
  panels: [
    timeseries(
      'Oldest unpublished outbox message',
      [
        {
          expr: 'max by (schema) (outbox_oldest_unpublished_age_seconds)',
          legend: '{{schema}}',
        },
      ],
      {
        unit: 's',
        thresholds: [
          [null, 'transparent'],
          [120, 'red'],
        ],
        thresholdLines: true,
        supports: 'OutboxLag, RB-04',
      },
    ),
    timeseries(
      'Dead letters',
      [{ expr: 'max by (schema) (outbox_dead_letters)', legend: '{{schema}}' }],
      { supports: 'DeadLetters, RB-05' },
    ),
    stat(
      'Relay: seconds since the last pass',
      [{ expr: 'time() - max(worker_relay_last_pass_timestamp)' }],
      {
        unit: 's',
        thresholds: [
          [null, 'green'],
          [10, 'orange'],
          [30, 'red'],
        ],
        supports: 'the relay check of /health/ready',
        w: 8,
        h: 5,
      },
    ),
    timeseries(
      'Handlers by outcome',
      [{ expr: 'sum by (outcome) (rate(handler_outcomes_total[5m]))', legend: '{{outcome}}' }],
      { unit: 'ops', w: 16, h: 5, supports: 'RB-04, RB-05' },
    ),
    table(
      'Jobs: time since the last success against the limit',
      [
        { expr: 'time() - max by (job_name) (job_last_success_timestamp)', refId: 'A' },
        { expr: 'max by (job_name) (job_stale_after_seconds)', refId: 'B' },
      ],
      {
        w: 24,
        h: 10,
        unit: 's',
        supports: 'JobStale',
        description:
          'A job is stale when column A passes column B. A job that never ran has no row.',
        transformations: [
          { id: 'joinByField', options: { byField: 'job_name', mode: 'outer' } },
          {
            id: 'organize',
            options: {
              excludeByName: { 'Time 1': true, 'Time 2': true },
              renameByName: { 'Value #A': 'seconds since success', 'Value #B': 'stale after' },
            },
          },
        ],
      },
    ),
    timeseries(
      'Failed job runs (1 h)',
      [
        {
          expr: 'sum by (job_name) (increase(job_runs_total{status="failed"}[1h]))',
          legend: '{{job_name}}',
        },
      ],
      { supports: 'RB-04' },
    ),
    timeseries(
      'Job duration p95',
      [
        {
          expr: 'histogram_quantile(0.95, sum by (le, job_name) (rate(job_duration_seconds_bucket[1h])))',
          legend: '{{job_name}}',
        },
      ],
      { unit: 's' },
    ),
  ],
}

const storageDatabase: Dashboard = {
  uid: 'rms-storage-database',
  title: 'RMS · Storage and database',
  description:
    'File storage against the quota, the connection pool, the processes, and (P1-20) PostgreSQL, the backup and the disks of the host.',
  panels: [
    timeseries(
      'File storage used against the quota',
      [{ expr: 'max by (building) (storage_usage_ratio)', legend: '{{building}}' }],
      {
        unit: 'percentunit',
        min: 0,
        thresholds: [
          [null, 'transparent'],
          [0.8, 'orange'],
          [1, 'red'],
        ],
        thresholdLines: true,
        supports: 'StorageQuota, RB-08',
      },
    ),
    timeseries(
      'Transactions waiting for a connection',
      [{ expr: 'max by (instance) (db_pool_waiting)', legend: '{{instance}}' }],
      { supports: 'DbPoolWaiting' },
    ),
    timeseries(
      'Resident memory',
      [{ expr: 'process_resident_memory_bytes', legend: '{{job}} {{instance}}' }],
      { unit: 'bytes', supports: 'NFR-05' },
    ),
    timeseries(
      'CPU',
      [{ expr: 'rate(process_cpu_seconds_total[5m])', legend: '{{job}} {{instance}}' }],
      { unit: 'percentunit' },
    ),
    stat('PostgreSQL up', [{ expr: 'max(pg_up{job="postgres"})' }], {
      thresholds: [
        [null, 'red'],
        [1, 'green'],
      ],
      supports: 'PostgresDown',
      w: 6,
    }),
    stat('Time since the last backup', [{ expr: 'time() - max(backup_last_success_timestamp)' }], {
      unit: 's',
      thresholds: [
        [null, 'green'],
        [86400, 'orange'],
        [93600, 'red'],
      ],
      supports: 'BackupMissing (26 h), RB-07',
      w: 6,
    }),
    timeseries(
      'WAL archive failures in 15 minutes',
      [{ expr: 'increase(pg_stat_archiver_failed_count{job="postgres"}[15m])', legend: 'failed' }],
      { min: 0, supports: 'PostgresArchiveFailing, RB-07' },
    ),
    timeseries(
      'Connections by state',
      [{ expr: 'sum by (state) (pg_stat_activity_count{job="postgres"})', legend: '{{state}}' }],
      { supports: 'DOC-10 §6.3' },
    ),
    timeseries(
      'Disk used',
      [
        {
          expr: '1 - node_filesystem_avail_bytes{job="node", mountpoint=~"/|/srv/rms-data", fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{job="node", mountpoint=~"/|/srv/rms-data", fstype!~"tmpfs|overlay|squashfs"}',
          legend: '{{mountpoint}}',
        },
      ],
      {
        unit: 'percentunit',
        min: 0,
        thresholds: [
          [null, 'transparent'],
          [0.8, 'orange'],
          [0.9, 'red'],
        ],
        thresholdLines: true,
        supports: 'DiskUsage, RB-08',
      },
    ),
    timeseries(
      'Host memory available',
      [{ expr: 'node_memory_MemAvailable_bytes{job="node"}', legend: 'available' }],
      { unit: 'bytes', supports: 'EXP-07' },
    ),
    timeseries(
      'Gauges that failed to refresh',
      [
        {
          expr: 'sum by (gauge) (increase(metrics_collection_errors_total[15m]))',
          legend: '{{gauge}}',
        },
      ],
      { w: 24, h: 6, supports: 'MetricsCollectionFailing' },
    ),
  ],
}

const rateOf = (metric: string, label: string, window = '15m') => ({
  expr: `sum by (${label}) (increase(${metric}[${window}]))`,
  legend: `{{${label}}}`,
})

const identityDashboard: Dashboard = {
  uid: 'rms-identity',
  title: 'RMS · Identity',
  description: 'Sign-ins, OTP, refresh, step-up and the SMS and mail that carry them.',
  panels: [
    stat('SMS provider down', [{ expr: 'max(sms_provider_down)' }], {
      thresholds: [
        [null, 'green'],
        [1, 'red'],
      ],
      supports: 'SmsProviderDown',
      w: 6,
    }),
    stat('OTP challenges in 24 h (cap 3000)', [{ expr: 'max(otp_challenges_24h)' }], {
      thresholds: [
        [null, 'green'],
        [2400, 'orange'],
        [3000, 'red'],
      ],
      supports: 'OtpDailyCapReached, EXP-09',
      w: 6,
    }),
    stat('Staff locked in 15 min', [{ expr: 'sum(increase(auth_lockouts_total[15m]))' }], {
      thresholds: [
        [null, 'green'],
        [5, 'orange'],
        [10, 'red'],
      ],
      supports: 'LockoutSpike',
      w: 6,
    }),
    stat(
      'Refresh reuse in 10 min',
      [{ expr: 'sum(increase(auth_refresh_total{outcome="reuse"}[10m]))' }],
      {
        thresholds: [
          [null, 'green'],
          [2, 'orange'],
          [5, 'red'],
        ],
        supports: 'RefreshTokenReuse',
        w: 6,
      },
    ),
    timeseries('Staff sign-in by outcome', [rateOf('auth_staff_login_total', 'outcome')], {
      supports: 'LockoutSpike',
    }),
    timeseries('OTP requested by outcome', [rateOf('auth_otp_requested_total', 'outcome')], {
      supports: 'OtpDailyCapReached, EXP-09',
    }),
    timeseries('OTP verified by outcome', [rateOf('auth_otp_verify_total', 'outcome')], {
      supports: 'EXP-09',
    }),
    timeseries('Refresh by outcome', [rateOf('auth_refresh_total', 'outcome')], {
      supports: 'RefreshTokenReuse',
    }),
    timeseries('Sessions revoked by reason', [rateOf('auth_sessions_revoked_total', 'reason')]),
    timeseries('Step-up by action and outcome', [
      {
        expr: 'sum by (action, outcome) (increase(auth_step_up_total[15m]))',
        legend: '{{action}} {{outcome}}',
      },
    ]),
    timeseries('SMS by outcome', [rateOf('sms_sent_total', 'outcome')], {
      supports: 'SmsFailures, RB-06',
    }),
    timeseries('Mail by outcome', [rateOf('mail_sent_total', 'outcome')]),
    timeseries('Client errors by app and kind', [
      {
        expr: 'sum by (app, kind) (increase(client_errors_total[1h]))',
        legend: '{{app}} {{kind}}',
      },
    ]),
  ],
}

/** The saved queries of DOC-40 §3.4; the `requestId` box feeds the first. */
const logsDashboard: Dashboard = {
  uid: 'rms-logs',
  title: 'RMS · Logs',
  description: 'Follow one request by its id, and the saved queries of the runbooks.',
  variables: [{ name: 'requestId', label: 'Request id', textbox: '' }],
  panels: [
    logs(
      'Everything one request did (api and worker)',
      '{env=~".+"} | json | requestId="$requestId"',
      { supports: 'RB-09' },
    ),
    logs(
      'Every 5xx',
      '{service=~".*api.*", level="error"} | json | msg="request" | status >= 500',
      { h: 8, supports: 'RB-09' },
    ),
    logs(
      'Why an outbox message died',
      '{service=~".*worker.*", level=~"warn|error"} | json | msg=~"outbox\\\\..*"',
      {
        h: 8,
        w: 12,
        supports: 'RB-05',
      },
    ),
    logs('A job that failed', '{service=~".*worker.*"} | json | msg="job.failed"', {
      h: 8,
      w: 12,
      supports: 'JobStale',
    }),
  ],
}

export const DASHBOARDS: Array<[string, Dashboard]> = [
  ['overview', overview],
  ['worker-jobs', workerJobs],
  ['identity', identityDashboard],
  ['storage-database', storageDatabase],
  ['logs', logsDashboard],
]

const dir = resolve(import.meta.dir, '../ops/grafana/dashboards')
const check = process.argv.includes('--check')
let stale = 0
mkdirSync(dir, { recursive: true })
for (const [name, dashboard] of DASHBOARDS) {
  const file = resolve(dir, `${name}.json`)
  const text = render(dashboard)
  if (check) {
    let current = ''
    try {
      current = readFileSync(file, 'utf8')
    } catch {}
    if (current !== text) {
      console.error(`ops/grafana/dashboards/${name}.json is stale: run bun run ops:dashboards`)
      stale++
    }
  } else writeFileSync(file, text)
}
process.exit(stale > 0 ? 1 : 0)
