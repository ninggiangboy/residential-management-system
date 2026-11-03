/**
 * The use-case wrapper of DOC-12 §8.1 item 4: a transaction that fails with SQLSTATE `40001` (serialization) or `40P01`
 * (deadlock) runs again whole, at most 3 more times, after a 20–60 ms jitter (FR-08.8, DOC-23 §6.1, DOC-22 §11). Any other error,
 * or a fourth failure, propagates. The error chain is read for its `code` (drizzle wraps the driver error in `cause`), so the
 * application layer needs no driver import.
 */
const SERIALIZATION_RETRIES = 3

export interface RetryOptions {
  readonly retries?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
  /** Called before each retry, for the `settle.retry` log line (DOC-23 §14). */
  readonly onRetry?: (sqlstate: string, attempt: number) => void
}

const RETRYABLE = new Set(['40001', '40P01'])

/** The SQLSTATE of a retryable failure, looked up through `cause` at most three levels deep; `null` otherwise. */
export function retryableSqlState(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth++) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && RETRYABLE.has(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return null
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function withSerializationRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? SERIALIZATION_RETRIES
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  for (let attempt = 0; ; attempt++) {
    try {
      return await run()
    } catch (error) {
      const sqlstate = retryableSqlState(error)
      if (sqlstate === null || attempt >= retries) throw error
      options.onRetry?.(sqlstate, attempt + 1)
      await sleep(20 + Math.floor(random() * 41))
    }
  }
}
