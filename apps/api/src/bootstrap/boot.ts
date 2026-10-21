import type { Logger } from '@core/telemetry'

/** The first connection is retried this long after a host reboot, when PostgreSQL still waits for Docker (DR-161, DOC-38 §5.1). */
export const DATABASE_WAIT_MS = 30_000
const RETRY_INTERVAL_MS = 1_000

/** Exit code of a process that could not reach its database; the configuration was valid (not 78), Docker restarts it. */
export const EXIT_DATABASE_UNREACHABLE = 1

export class DatabaseUnreachableError extends Error {
  constructor(waitedMs: number, options?: ErrorOptions) {
    super(`the database did not answer within ${Math.round(waitedMs / 1000)} s`, options)
    this.name = 'DatabaseUnreachableError'
  }
}

export interface WaitOptions {
  timeoutMs?: number
  intervalMs?: number
  logger?: Pick<Logger, 'warn'>
  /** Injected by tests; the real clock and timer otherwise. */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Retries `ping` until it answers or `timeoutMs` has passed; the last failure is the `cause` of the error. */
export async function waitForDatabase(
  database: { ping(): Promise<unknown> },
  {
    timeoutMs = DATABASE_WAIT_MS,
    intervalMs = RETRY_INTERVAL_MS,
    logger,
    now = Date.now,
    sleep = Bun.sleep,
  }: WaitOptions = {},
): Promise<void> {
  const started = now()
  for (let attempt = 1; ; attempt++) {
    try {
      await database.ping()
      return
    } catch (cause) {
      const waited = now() - started
      if (waited + intervalMs > timeoutMs) throw new DatabaseUnreachableError(waited, { cause })
      logger?.warn({ attempt, waitedMs: waited }, 'database_wait')
      await sleep(intervalMs)
    }
  }
}
