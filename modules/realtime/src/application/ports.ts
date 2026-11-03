import type { StaffRole } from '@rms/shared-types'
import type { RealtimeEventType } from '../contracts'

/** One row of `realtime.events` as the publisher writes it (DOC-17 §9.1). */
export interface EventRow {
  id: string
  buildingId: string
  sourceMessageId: string
  type: RealtimeEventType
  targetAccountId: string | null
  targetRoles: readonly StaffRole[] | null
  closeSessionId: string | null
  data: Record<string, unknown>
}

/** A row the replay returns (DOC-52 §8.2). */
export interface ReplayRow {
  id: string
  type: RealtimeEventType
  data: Record<string, unknown>
  createdAt: Date
}

/** The table behind the stream (DOC-52 §8, §9.1). */
export interface RealtimeStore {
  /**
   * The one statement of DOC-52 §9.1: inserts the row and calls `pg_notify` in the same statement, so the notification is
   * delivered at commit and a repeated source message writes and sends nothing. True when the row was inserted.
   */
  publish(row: EventRow): Promise<boolean>
  /** The replay query of DOC-52 §8.2: the stream's building, account or role, from the time of `lastEventId` minus 5 s, `limit` rows. */
  replay(
    scope: { buildingId: string; accountId: string; role: StaffRole },
    lastEventId: string,
    limit: number,
  ): Promise<ReplayRow[]>
  /** Deletes events older than `cutoff`, at most `batch` (the job `realtime_purge`); returns how many. */
  purgeOlderThan(cutoff: Date, batch: number): Promise<number>
}

/** An event as a stream receives it: the message of DOC-52 §5 and the session to close (§6.6). */
export interface LiveEvent {
  id: string
  type: RealtimeEventType
  data: Record<string, unknown>
  at: string
  closeSessionId?: string
}

/** What the hub knows of one open stream (DOC-52 §7, §9.3). */
export interface HubStream {
  readonly buildingId: string
  readonly accountId: string
  readonly role: StaffRole
  readonly sessionId: string
  deliver(event: LiveEvent): void
  close(reason: string): void
}

/** One per `api` process: fans a notification out to the local streams (DOC-52 §9.3). */
export interface StreamHub {
  /** Registers a stream; the first one opens the `LISTEN` connection. Returns the unregister function. */
  register(stream: HubStream): Promise<() => void>
  /** Closes every local stream (shutdown, DOC-52 §10.2). */
  closeLive(reason: string): void
}

/** Timers a test can drive by hand. */
export interface Timers {
  after(ms: number, fn: () => void): () => void
}

export const realTimers: Timers = {
  after(ms, fn) {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
}
