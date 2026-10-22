import type { Clock } from '@core/kernel'

/** A process cache with a time to live read from the injected clock, so a test advances it with `FakeClock` (BD-11). */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>()

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number,
  ) {}

  async get(key: string, load: () => Promise<V>): Promise<V> {
    const now = this.clock.now().getTime()
    const hit = this.entries.get(key)
    if (hit && hit.expiresAt > now) return hit.value
    const value = await load()
    this.entries.set(key, { value, expiresAt: now + this.ttlMs })
    return value
  }

  /** The process that saved a change clears its own entry at once; another process sees it within the TTL (DOC-36 §3.1). */
  invalidate(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }
}
