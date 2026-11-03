import type { IdGenerator, Log } from '@core/kernel'
import { InvariantError } from '@core/kernel'
import type { Envelope, IntegrationEventHandler } from '@core/messaging'
import type { MetricsPort } from '@rms/shared-types'
import { NO_METRICS } from '@rms/shared-types'
import type { RealtimeMapping } from '../../contracts'
import type { RealtimeStore } from '../ports'

/** `pg_notify` refuses 8,000 bytes; the hub refuses 7,500 before it calls it (DOC-52 §9.2, SE-18). */
const MAX_WIRE_BYTES = 7500

/**
 * The generic handler of DOC-52 §9.1: one per mapping of a producer's `integrations/realtime.ts`. It has no inbox row (DOC-09
 * §4.3, mode "none"): the unique `source_message_id` is the once-only effect, so a relay retry writes and sends nothing. There is
 * no age limit on the event: the buffer makes a late event useful to a tab that reconnects (DR-289).
 */
export class RealtimePushHandler<P> implements IntegrationEventHandler {
  readonly name: string
  readonly eventType: string

  constructor(
    private readonly mapping: RealtimeMapping<P>,
    private readonly store: RealtimeStore,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {
    this.name = mapping.handler
    this.eventType = mapping.eventType
  }

  async handle(message: Envelope): Promise<void> {
    const built = this.mapping.build(message.payload as unknown as P, { messageId: message.id })
    if (built === null) return
    const target = 'accountId' in built.target ? built.target : null
    const roles = 'roles' in built.target ? built.target.roles : null
    const row = {
      id: this.ids.next(),
      buildingId: built.buildingId,
      sourceMessageId: message.id,
      type: built.event.type,
      targetAccountId: target?.accountId ?? null,
      targetRoles: roles,
      closeSessionId: built.closeSessionId ?? null,
      data: built.event.data,
    }
    const wire = JSON.stringify({
      b: row.buildingId,
      a: row.targetAccountId,
      r: row.targetRoles,
      c: row.closeSessionId,
      m: { id: row.id, type: row.type, data: row.data, at: '0000-00-00T00:00:00.000Z' },
    })
    if (Buffer.byteLength(wire) >= MAX_WIRE_BYTES) {
      this.logger.error(
        { event: 'realtime_payload_too_large', type: row.type, bytes: Buffer.byteLength(wire) },
        'realtime_payload_too_large',
      )
      throw new InvariantError('realtime_payload_too_large')
    }
    if (await this.store.publish(row))
      this.metrics.inc('sse_events_published_total', { type: row.type })
  }
}

/** The boot check of `installRealtime` (DOC-12 §4.4): unique handler names, known types. */
export function assertMappings(mappings: readonly RealtimeMapping<never>[]): void {
  const names = new Set<string>()
  for (const mapping of mappings) {
    if (names.has(mapping.handler))
      throw new Error(`realtime: two mappings share the handler name ${mapping.handler}`)
    names.add(mapping.handler)
  }
}
