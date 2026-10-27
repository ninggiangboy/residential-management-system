import { Counter, Gauge, Histogram, Registry } from 'prom-client'

export type { Counter, Gauge, Histogram }

/** One series of a pulled gauge: the label values and the value. */
export interface Sample {
  labels?: Record<string, string>
  value: number
}

export interface MetricsOptions {
  /** `METRICS_CACHE_SECONDS`: a pulled gauge computed less than this long ago is reused (DOC-40 §4 rule 3). */
  cacheSeconds: number
  /** `METRICS_QUERY_TIMEOUT_MS`: a pulled gauge that takes longer keeps its last value. */
  queryTimeoutMs: number
  /** Tests inject a clock for the cache. */
  now?: () => number
}

/**
 * The registry of one process: counters, gauges and histograms in the Prometheus text format, served by `/metrics` on the ops port
 * (DOC-40 §2). `prom-client`'s default metrics are not collected: on Bun 1.4.3 they print `Nan` and a minimum of 9.2e9, which
 * Prometheus rejects, so only the two process metrics of DOC-40 §4.1 are registered (`registerProcessMetrics`).
 */
export class Metrics {
  readonly registry = new Registry()
  /** `metrics_collection_errors_total{gauge}` (DOC-40 §4.1): a pulled gauge that timed out or failed. */
  readonly collectionErrors: Counter<'gauge'>
  private readonly pullers: Array<() => Promise<void>> = []

  constructor(private readonly options: MetricsOptions) {
    this.collectionErrors = this.counter(
      'metrics_collection_errors_total',
      'Database-derived gauges that timed out or failed at a scrape.',
      ['gauge'],
    )
  }

  counter<L extends string>(name: string, help: string, labelNames: readonly L[] = []) {
    return new Counter<L>({
      name,
      help,
      labelNames: [...labelNames],
      registers: [this.registry],
    })
  }

  gauge<L extends string>(name: string, help: string, labelNames: readonly L[] = []) {
    return new Gauge<L>({ name, help, labelNames: [...labelNames], registers: [this.registry] })
  }

  histogram<L extends string>(
    name: string,
    help: string,
    buckets: readonly number[],
    labelNames: readonly L[] = [],
  ) {
    return new Histogram<L>({
      name,
      help,
      buckets: [...buckets],
      labelNames: [...labelNames],
      registers: [this.registry],
    })
  }

  /**
   * A gauge that reads its value at the scrape (DOC-40 §4 rule 3): `read` runs at most once per `cacheSeconds`, gives up after
   * `queryTimeoutMs` and then keeps the last series (and counts `metrics_collection_errors_total{gauge}`), so a slow or dead
   * database never makes the scrape slow or empty. A gauge that has never been read has no series at all: a `0` would pass for
   * "no violations".
   */
  pulled<L extends string>(
    name: string,
    help: string,
    labelNames: readonly L[],
    read: () => Promise<readonly Sample[]>,
    /** `cacheSeconds: 0` reads at every scrape (the readiness gauge must not be stale). */
    own: { cacheSeconds?: number } = {},
  ) {
    const { queryTimeoutMs, now = Date.now } = this.options
    const cacheSeconds = own.cacheSeconds ?? this.options.cacheSeconds
    let last: readonly Sample[] = []
    let readAt = Number.NEGATIVE_INFINITY
    let inFlight: Promise<void> | undefined
    const refresh = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        last = await Promise.race([
          read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), queryTimeoutMs)
          }),
        ])
        readAt = now()
      } catch {
        this.collectionErrors.inc({ gauge: name })
        // The next scrape tries again instead of waiting for the cache to expire.
        readAt = Number.NEGATIVE_INFINITY
      } finally {
        clearTimeout(timer)
      }
    }
    this.pullers.push(async () => {
      if (now() - readAt < cacheSeconds * 1000) return
      // Two scrapes at once share one read.
      inFlight ??= refresh().finally(() => {
        inFlight = undefined
      })
      await inFlight
    })
    // prom-client asks a registered metric for `get()`; this one is a plain object so that it can have no series.
    this.registry.registerMetric({
      name,
      get: () => ({
        name,
        help,
        type: 'gauge',
        aggregator: 'sum',
        values: last.map((sample) => ({ labels: sample.labels ?? {}, value: sample.value })),
      }),
      reset: () => {},
      labelNames: [...labelNames],
    } as never)
  }

  /** `process_cpu_seconds_total` and `process_resident_memory_bytes`, read at the scrape. */
  registerProcessMetrics() {
    let cpuSeen = 0
    const cpu = new Counter({
      name: 'process_cpu_seconds_total',
      help: 'User and system CPU time spent by the process, in seconds.',
      registers: [this.registry],
      collect() {
        const { user, system } = process.cpuUsage()
        const total = (user + system) / 1e6
        this.inc(total - cpuSeen)
        cpuSeen = total
      },
    })
    const memory = new Gauge({
      name: 'process_resident_memory_bytes',
      help: 'Resident memory size of the process, in bytes.',
      registers: [this.registry],
      collect() {
        this.set(process.memoryUsage.rss())
      },
    })
    return { cpu, memory }
  }

  /** The text of a scrape. */
  async render(): Promise<string> {
    // The pulled gauges first, so that a failure they count is in the same scrape.
    await Promise.all(this.pullers.map((refresh) => refresh()))
    return this.registry.metrics()
  }

  get contentType(): string {
    return this.registry.contentType
  }
}
