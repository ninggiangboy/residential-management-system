import type { Database } from '@core/db'
import type { Log } from '@core/kernel'
import type { StaffRole } from '@rms/shared-types'
import type { HubStream, LiveEvent, StreamHub } from '../application/ports'
import { reaches } from '../application/targeting'

const CHANNEL = 'realtime'

/** The message `pg_notify` carries (DOC-52 §9.2): building, target account, target roles, session to close, the event. */
interface Wire {
  b: string
  a: string | null
  r: StaffRole[] | null
  c: string | null
  m: { id: string; type: LiveEvent['type']; data: Record<string, unknown>; at: string }
}

/**
 * One per `api` process (DOC-52 §9.3, ADR-0024). It opens ONE `LISTEN realtime` connection, direct and outside the pool, the first
 * time a stream registers, and filters each notification by DOC-52 §7 before it reaches a stream. A `LISTEN` connection that was
 * lost and is listening again closes every local stream (`listen_reconnected`): the notifications sent while it was down are lost
 * to it, and the tabs reconnect and replay from the buffer (DR-289). A process that never serves a stream never listens.
 */
export class PgRealtimeHub implements StreamHub {
  private readonly streams = new Set<HubStream>()
  private listening: Promise<unknown> | undefined
  private stopped = false
  private firstListen = true

  constructor(
    private readonly database: Database,
    private readonly logger: Log,
  ) {}

  async register(stream: HubStream): Promise<() => void> {
    this.streams.add(stream)
    this.listening ??= this.listen()
    try {
      await this.listening
    } catch (error) {
      this.streams.delete(stream)
      this.listening = undefined
      throw error
    }
    return () => {
      this.streams.delete(stream)
    }
  }

  closeLive(reason: string): void {
    for (const stream of [...this.streams]) stream.close(reason)
  }

  /** Stops listening for good (shutdown). */
  async stop(): Promise<void> {
    this.stopped = true
    this.closeLive('shutdown')
    const meta = (await this.listening?.catch(() => undefined)) as
      | { unlisten?: () => Promise<void> }
      | undefined
    await meta?.unlisten?.().catch(() => undefined)
  }

  private listen() {
    return this.database.client.listen(
      CHANNEL,
      (payload) => this.dispatch(payload),
      () => {
        if (this.stopped) return
        if (this.firstListen) {
          this.firstListen = false
          return
        }
        this.logger.warn({ event: 'realtime_listen_reconnected' }, 'realtime_listen_reconnected')
        this.closeLive('listen_reconnected')
      },
    )
  }

  private dispatch(payload: string): void {
    let wire: Wire
    try {
      wire = JSON.parse(payload) as Wire
    } catch {
      this.logger.error({ event: 'realtime_bad_notification' }, 'realtime_bad_notification')
      return
    }
    const target = { buildingId: wire.b, accountId: wire.a, roles: wire.r }
    const event: LiveEvent = { ...wire.m, ...(wire.c ? { closeSessionId: wire.c } : {}) }
    for (const stream of [...this.streams]) if (reaches(target, stream)) stream.deliver(event)
  }
}
