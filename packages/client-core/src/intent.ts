/** One user intent: the key is created once and reused on every retry of that intent (DOC-50 §8.1). */
export interface Intent {
  key: string
  bodyHash: string
}

/** A canonical form of a JSON-like body, so key order never changes the intent. */
export function canonicalBody(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBody).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalBody(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/**
 * `newIntent(randomId)` returns a function: the same `Intent` while the canonical body is unchanged, a new one when it changes (CL-06).
 * `reset()` forgets it (on success, on cancel). The key is a UUIDv4 from `randomId`, 36 characters of `[A-Za-z0-9-]`.
 */
export function newIntent(randomId: () => string) {
  let current: Intent | undefined
  return {
    for(body: unknown): Intent {
      const bodyHash = canonicalBody(body)
      if (!current || current.bodyHash !== bodyHash) current = { key: randomId(), bodyHash }
      return current
    },
    reset(): void {
      current = undefined
    },
  }
}
