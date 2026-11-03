import type { Clock, IdGenerator } from '@core/kernel'
import type { MetricsPort, StaffRole } from '@rms/shared-types'
import { NO_METRICS } from '@rms/shared-types'
import {
  canReplay,
  eventFrame,
  heartbeatFrame,
  instant,
  parseLastEventId,
  REPLAY_LIMIT,
  readyFrame,
} from './frames'
import type { HubStream, LiveEvent, RealtimeStore, StreamHub, Timers } from './ports'
import { realTimers } from './ports'

export interface StreamSettings {
  /** `SSE_MAX_STREAMS_PER_ACCOUNT`, counted per process (DOC-52 §10.3). */
  maxStreamsPerAccount: number
  /** `SSE_HEARTBEAT_SECONDS`. */
  heartbeatSeconds: number
}

export interface OpenStream {
  buildingId: string
  accountId: string
  role: StaffRole
  /** The `sid` of the access token. */
  sessionId: string
  /** The `exp` of the access token: the stream closes then (DOC-52 §10.2). */
  tokenExpiresAt: Date
  /** The `Last-Event-ID` header, as received. */
  lastEventId?: string | null
}

export type OpenResult =
  | { rejected: 'limit' }
  | { rejected?: undefined; stream: ReadableStream<Uint8Array> }

/**
 * The use case behind E-75 (DOC-52 §4, §8.2, §10): opens one stream. The order is the contract: limit check, register with the
 * hub so live events queue, mint the cursor, replay, then `ready`, the replayed events, the queued ones and direct delivery.
 */
export class StaffEventStreams {
  private readonly open = new Map<string, Set<LiveStream>>()

  constructor(
    private readonly store: RealtimeStore,
    private readonly hub: StreamHub,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly settings: StreamSettings,
    private readonly metrics: MetricsPort = NO_METRICS,
    private readonly timers: Timers = realTimers,
  ) {}

  /** `sse_streams_open` (DOC-52 §15): the gauge reads it at the scrape. */
  openCount(): number {
    let n = 0
    for (const set of this.open.values()) n += set.size
    return n
  }

  async execute(params: OpenStream): Promise<OpenResult> {
    const mine = this.open.get(params.accountId)
    if ((mine?.size ?? 0) >= this.settings.maxStreamsPerAccount) {
      this.metrics.inc('sse_stream_opens_total', { outcome: 'limited' })
      return { rejected: 'limit' }
    }
    const live = new LiveStream(params, this.settings, this.clock, this.timers, (stream) =>
      this.forget(stream),
    )
    const set = mine ?? new Set<LiveStream>()
    set.add(live)
    this.open.set(params.accountId, set)
    try {
      const unregister = await this.hub.register(live)
      live.onClose(unregister)
      const cursor = this.ids.next()
      let resumed = false
      let replayed: Array<{
        id: string
        type: LiveEvent['type']
        data: LiveEvent['data']
        at: string
      }> = []
      const lastEventId = parseLastEventId(params.lastEventId)
      if (lastEventId !== undefined && canReplay(lastEventId, this.clock.now())) {
        const rows = await this.store.replay(
          { buildingId: params.buildingId, accountId: params.accountId, role: params.role },
          lastEventId,
          REPLAY_LIMIT + 1,
        )
        if (rows.length <= REPLAY_LIMIT) {
          resumed = true
          replayed = rows.map((row) => ({
            id: row.id,
            type: row.type,
            data: row.data,
            at: instant(row.createdAt),
          }))
        }
      }
      this.metrics.inc('sse_stream_opens_total', { outcome: resumed ? 'resumed' : 'fresh' })
      live.start(readyFrame({ cursor, sessionId: params.sessionId, resumed }), replayed)
      return { stream: live.body }
    } catch (error) {
      live.close('open_failed')
      throw error
    }
  }

  /** Closes every local stream before the HTTP server stops (DOC-52 §10.2, SE-16). */
  closeLive(): void {
    for (const set of [...this.open.values()])
      for (const stream of [...set]) stream.close('shutdown')
  }

  private forget(stream: LiveStream): void {
    const set = this.open.get(stream.accountId)
    set?.delete(stream)
    if (set?.size === 0) this.open.delete(stream.accountId)
  }
}

/** One open stream: queues live events until `start` has written the replay (DOC-52 §8.2 steps 2 and 6). */
class LiveStream implements HubStream {
  readonly buildingId: string
  readonly accountId: string
  readonly role: StaffRole
  readonly sessionId: string
  readonly body: ReadableStream<Uint8Array>
  private controller!: ReadableStreamDefaultController<Uint8Array>
  private readonly encoder = new TextEncoder()
  private queue: LiveEvent[] = []
  private started = false
  private closed = false
  private seen = new Set<string>()
  private cancelHeartbeat: (() => void) | undefined
  private cancelExpiry: (() => void) | undefined
  private cleanups: Array<() => void> = []
  private closeAfterStart: string | undefined

  constructor(
    params: OpenStream,
    private readonly settings: StreamSettings,
    private readonly clock: Clock,
    private readonly timers: Timers,
    private readonly forget: (stream: LiveStream) => void,
  ) {
    this.buildingId = params.buildingId
    this.accountId = params.accountId
    this.role = params.role
    this.sessionId = params.sessionId
    this.body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller
      },
      cancel: () => this.close('client_closed'),
    })
    const ttl = Math.max(0, params.tokenExpiresAt.getTime() - this.clock.now().getTime())
    this.cancelExpiry = this.timers.after(ttl, () => this.close('token_expired'))
  }

  onClose(fn: () => void): void {
    if (this.closed) fn()
    else this.cleanups.push(fn)
  }

  /** Writes `ready`, the replayed events, then the events queued meanwhile, and switches to direct delivery. */
  start(
    ready: string,
    replayed: Array<{ id: string; type: LiveEvent['type']; data: LiveEvent['data']; at: string }>,
  ): void {
    this.write(ready)
    for (const event of replayed) {
      this.seen.add(event.id)
      this.write(eventFrame(event))
    }
    this.started = true
    for (const event of this.queue) this.emit(event)
    this.queue = []
    this.armHeartbeat()
    if (this.closeAfterStart) this.close(this.closeAfterStart)
  }

  deliver(event: LiveEvent): void {
    if (this.closed) return
    if (!this.started) this.queue.push(event)
    else this.emit(event)
  }

  private emit(event: LiveEvent): void {
    if (this.seen.has(event.id)) return
    this.seen.add(event.id)
    this.write(eventFrame(event))
    this.armHeartbeat()
    if (event.closeSessionId === this.sessionId) this.close('session_revoked')
  }

  close(reason: string): void {
    if (this.closed) return
    if (!this.started && reason !== 'client_closed' && reason !== 'open_failed') {
      this.closeAfterStart = reason
      return
    }
    this.closed = true
    this.cancelHeartbeat?.()
    this.cancelExpiry?.()
    for (const fn of this.cleanups) fn()
    this.forget(this)
    try {
      this.controller.close()
    } catch {
      // already closed by the consumer
    }
  }

  private write(frame: string): void {
    if (this.closed) return
    try {
      this.controller.enqueue(this.encoder.encode(frame))
    } catch {
      this.close('write_failed')
    }
  }

  private armHeartbeat(): void {
    this.cancelHeartbeat?.()
    if (this.closed) return
    this.cancelHeartbeat = this.timers.after(this.settings.heartbeatSeconds * 1000, () => {
      this.write(heartbeatFrame())
      this.armHeartbeat()
    })
  }
}
