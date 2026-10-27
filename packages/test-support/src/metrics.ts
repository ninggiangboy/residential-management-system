/**
 * A `MetricsPort` (`@rms/shared-types`) that remembers what it was told, for the tests that look at a counter: `count('auth_refresh_total',
 * { outcome: 'reuse' })` is how many times that series was incremented. It has no dependency on the type, which it satisfies by shape.
 */
export function recordingMetrics() {
  const counts = new Map<string, number>()
  const observed = new Map<string, number[]>()
  const key = (name: string, labels: Record<string, string> = {}) =>
    `${name}{${Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => `${label}=${value}`)
      .join(',')}}`
  return {
    inc(name: string, labels?: Record<string, string>) {
      counts.set(key(name, labels), (counts.get(key(name, labels)) ?? 0) + 1)
    },
    add(name: string, by: number, labels?: Record<string, string>) {
      counts.set(key(name, labels), (counts.get(key(name, labels)) ?? 0) + by)
    },
    observe(name: string, seconds: number) {
      observed.set(name, [...(observed.get(name) ?? []), seconds])
    },
    /** How many times a series was incremented (0 if never). */
    count: (name: string, labels?: Record<string, string>) => counts.get(key(name, labels)) ?? 0,
    /** The values observed for a histogram. */
    observations: (name: string) => observed.get(name) ?? [],
    /** Every series that was touched, as `name{label=value}`: for a test that wants "nothing else". */
    series: () => [...counts.keys()].sort(),
  }
}
