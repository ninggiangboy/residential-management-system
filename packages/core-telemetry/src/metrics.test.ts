import { describe, expect, test } from 'bun:test'
import { Metrics } from './metrics'

const metricsWith = (now: () => number, queryTimeoutMs = 50) =>
  new Metrics({ cacheSeconds: 10, queryTimeoutMs, now })

const lineOf = (text: string, name: string) =>
  text.split('\n').find((line) => line.startsWith(name))

describe('Metrics', () => {
  test('renders counters, gauges and histograms in the text format', async () => {
    const metrics = metricsWith(() => 0)
    metrics.counter('x_total', 'x', ['kind']).inc({ kind: 'a' })
    metrics.gauge('y', 'y').set(3)
    metrics.histogram('z_seconds', 'z', [0.1, 1]).observe(0.5)
    const text = await metrics.render()
    expect(text).toContain('x_total{kind="a"} 1')
    expect(text).toContain('\ny 3\n')
    expect(text).toContain('z_seconds_bucket{le="1"} 1')
    expect(metrics.contentType).toContain('text/plain')
  })

  test('registers only the two process metrics, with finite values', async () => {
    const metrics = metricsWith(() => 0)
    metrics.registerProcessMetrics()
    const text = await metrics.render()
    expect(text).not.toContain('nodejs_')
    expect(text).not.toMatch(/\bNan\b/)
    expect(Number(lineOf(text, 'process_resident_memory_bytes ')?.split(' ')[1])).toBeGreaterThan(0)
    expect(lineOf(text, 'process_cpu_seconds_total ')).toBeDefined()
  })

  // OB-13: two scrapes within METRICS_CACHE_SECONDS read the database once.
  test('a pulled gauge is read once per cache window', async () => {
    let clock = 0
    let reads = 0
    const metrics = metricsWith(() => clock)
    metrics.pulled('db_gauge', 'g', ['schema'], async () => {
      reads++
      return [{ labels: { schema: 'identity' }, value: reads }]
    })
    await metrics.render()
    clock = 9_000
    await metrics.render()
    expect(reads).toBe(1)
    clock = 10_000
    expect(await metrics.render()).toContain('db_gauge{schema="identity"} 2')
    expect(reads).toBe(2)
  })

  test('two scrapes at once share one read', async () => {
    let reads = 0
    const metrics = metricsWith(() => 0)
    metrics.pulled('db_gauge', 'g', [], async () => {
      reads++
      await Bun.sleep(10)
      return [{ value: 1 }]
    })
    await Promise.all([metrics.render(), metrics.render()])
    expect(reads).toBe(1)
  })

  // OB-12: a slow query keeps the last value and counts the failure; the scrape does not wait for it.
  test('a pulled gauge that times out keeps its last value and counts the error', async () => {
    let clock = 0
    let slow = false
    const metrics = metricsWith(() => clock, 30)
    metrics.pulled('db_gauge', 'g', [], async () => {
      if (slow) await Bun.sleep(500)
      return [{ value: 7 }]
    })
    expect(await metrics.render()).toContain('\ndb_gauge 7\n')
    slow = true
    clock = 20_000
    const begin = performance.now()
    const text = await metrics.render()
    expect(performance.now() - begin).toBeLessThan(300)
    expect(text).toContain('\ndb_gauge 7\n')
    expect(text).toContain('metrics_collection_errors_total{gauge="db_gauge"} 1')
  })

  test('a pulled gauge that throws on the first read has no series', async () => {
    const metrics = metricsWith(() => 0)
    metrics.pulled('db_gauge', 'g', [], async () => {
      throw new Error('down')
    })
    const text = await metrics.render()
    expect(lineOf(text, 'db_gauge')).toBeUndefined()
    expect(text).toContain('metrics_collection_errors_total{gauge="db_gauge"} 1')
  })

  test('a series that disappears from the read disappears from the scrape', async () => {
    let clock = 0
    let rows = [{ labels: { schema: 'a' }, value: 1 }]
    const metrics = metricsWith(() => clock)
    metrics.pulled('db_gauge', 'g', ['schema'], async () => rows)
    expect(await metrics.render()).toContain('db_gauge{schema="a"} 1')
    rows = []
    clock = 20_000
    expect(lineOf(await metrics.render(), 'db_gauge')).toBeUndefined()
  })
})
