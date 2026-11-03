import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createLogger } from '@core/telemetry'
import { buildApp, buildOpsApp } from '../app'
import { loadAppConfig } from './config'
import { localEnv } from './config/support'
import { createContainer } from './container'
import { createAppMetrics } from './metrics'

/** No database is needed for the names and the labels: the pulled gauges that fail to read are series-less. */
const container = createContainer(
  loadAppConfig({ ...localEnv(), DATABASE_URL: 'postgres://rms_app:x@127.0.0.1:1/rms' }),
  createLogger('silent'),
)

const DOC_40 = readFileSync(
  new URL('../../../../docs/06-design/observability.md', import.meta.url),
  'utf8',
)

/** The phases whose metrics are registered: `P1`, the provider counters of P1-22, the rows of P2-12 (counters only until `sse_streams_open`) and P2-11. */
const BUILT_PHASE = /^(P1(?![-\d])|P1-22|P2-12|P2-11)/

/** The rows of the tables of DOC-40 §4 that end in a phase: the metrics this task has to register (a `P1` first). */
function catalogOfPhaseOne(): string[] {
  const names: string[] = []
  for (const line of DOC_40.split('\n')) {
    const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim())
    if (cells.length < 6) continue
    const phase = cells.at(-2) ?? ''
    if (!BUILT_PHASE.test(phase)) continue
    names.push(
      ...[...(cells[1] ?? '').matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1] ?? ''),
    )
  }
  return names
}

/** Not scrapeable: the process exits (DOC-40 §4.4). */
const NOT_SCRAPED = new Set(['boot_guard_failures_total'])

describe('OB-01: the registry and the catalog of DOC-40 §4 are the same set', () => {
  test('every P1 row is registered and nothing else is', () => {
    const documented = catalogOfPhaseOne().filter((name) => !NOT_SCRAPED.has(name))
    const registered = container.metrics.metrics.registry
      .getMetricsAsArray()
      .map((metric) => (metric as unknown as { name: string }).name)
    expect([...registered].sort()).toEqual([...new Set(documented)].sort())
  })
})

describe('OB-03: /metrics is on the ops port only', () => {
  test('the public port answers 404 and the ops port the text format', async () => {
    const publicAnswer = await buildApp(container).handle(new Request('http://localhost/metrics'))
    expect(publicAnswer.status).toBe(404)
    const prefixed = await buildApp(container).handle(
      new Request('http://localhost/api/v1/metrics'),
    )
    expect(prefixed.status).toBe(404)
    const ops = await buildOpsApp(container).handle(new Request('http://localhost/metrics'))
    expect(ops.status).toBe(200)
    expect(ops.headers.get('content-type')).toContain('text/plain')
    expect(await ops.text()).toContain('# TYPE process_resident_memory_bytes gauge')
  })
})

describe('the request metrics', () => {
  const own = createAppMetrics({ cacheSeconds: 10, queryTimeoutMs: 1500 })
  const observed = async () => {
    const text = await own.metrics.render()
    return text.split('\n').filter((line) => line && !line.startsWith('#'))
  }

  test('a request is counted by route template, status and error code', async () => {
    own.request({
      method: 'GET',
      route: '/api/v1/units/:id',
      status: 404,
      code: 'not_found',
      seconds: 0.02,
    })
    const lines = await observed()
    expect(lines).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/v1/units/:id",status="404"} 1',
    )
    expect(lines).toContain('api_errors_total{code="not_found",status="404"} 1')
  })

  test('only the native apps are counted by version, and an odd version is one `invalid` series', async () => {
    const send = (appId?: string, appVersion?: string) =>
      own.request({
        method: 'GET',
        route: '/x',
        status: 200,
        seconds: 0.01,
        appId,
        appVersion,
      })
    send('resident', '1.4.2')
    send('resident', '1.4.2')
    send('staff', '2.0.0; DROP TABLE')
    send('resident')
    send('web')
    send(undefined, '9.9.9')
    const lines = await observed()
    expect(lines).toContain('app_version_requests_total{app="resident",version="1.4.2"} 2')
    expect(lines).toContain('app_version_requests_total{app="staff",version="invalid"} 1')
    expect(lines).toContain('app_version_requests_total{app="resident",version="invalid"} 1')
    expect(lines.filter((line) => line.startsWith('app_version_requests_total'))).toHaveLength(3)
  })

  test('a demo building stays out of storage_usage_ratio (BD-36)', async () => {
    own.usage.report('00000000-0000-7000-8000-000000000001', 0.9, true)
    own.usage.report('00000000-0000-7000-8000-000000000002', 0.4, false)
    const lines = await observed()
    expect(lines.filter((line) => line.startsWith('storage_usage_ratio'))).toEqual([
      'storage_usage_ratio{building="00000000-0000-7000-8000-000000000002"} 0.4',
    ])
  })

  test('a job run is counted once, and a run another process held the lock for is not', async () => {
    own.jobRun({
      name: 'orphan_uploads',
      status: 'succeeded',
      durationMs: 250,
      did: 3,
      recorded: true,
    })
    own.jobRun({
      name: 'orphan_uploads',
      status: 'skipped_locked',
      durationMs: 1,
      did: 0,
      recorded: false,
    })
    const lines = await observed()
    expect(lines).toContain('job_runs_total{job_name="orphan_uploads",status="succeeded"} 1')
    expect(lines.some((line) => line.includes('skipped_locked'))).toBe(false)
    expect(lines).toContain('job_duration_seconds_count{job_name="orphan_uploads"} 1')
  })
})

describe('OB-02: no label carries a person', () => {
  test('label names are a closed set and no value looks like a phone number or an email', async () => {
    const forbidden = new Set(['id', 'accountId', 'unitId', 'requestId', 'email', 'phone'])
    for (const metric of container.metrics.metrics.registry.getMetricsAsArray()) {
      for (const label of (metric as unknown as { labelNames?: string[] }).labelNames ?? [])
        expect(
          forbidden.has(label),
          `${(metric as unknown as { name: string }).name}.${label}`,
        ).toBe(false)
    }
    const text = await container.metrics.metrics.render()
    expect(text).not.toMatch(/="\+?\d{9,}"/)
    expect(text).not.toMatch(/="[^"]*@[^"]*"/)
  })
})
