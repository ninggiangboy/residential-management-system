import { requestContext } from '@core/context'
import type { Database } from '@core/db'
import { type DomainEvent, InvariantError } from '@core/kernel'
import { currentTraceparent } from '@core/telemetry'
import type { OutboxWriter } from '../ports'
import type { OutboxTable } from './tables'

/** What the writer enforces on every event (DOC-09 §3.4, JB-23, MC-02, MC-05). */
export interface OutboxRules {
  /** The module that writes: the first segment of every `type`. */
  source: string
  /** The types the module's catalog row lists (`outboxPolicies`): another type cannot be written. */
  types: ReadonlySet<string>
  /** `OUTBOX_MAX_PAYLOAD_BYTES`. */
  maxPayloadBytes: number
}

const TYPE_FORMAT = /^([a-z][a-z0-9_]*)\.[a-z][a-z0-9_]*\.v[1-9][0-9]*$/

export class DrizzleOutboxWriter implements OutboxWriter {
  constructor(
    private database: Database,
    private table: OutboxTable,
    private newId: () => string,
    private rules?: OutboxRules,
  ) {}

  /** Throws before anything is written: a type outside the catalog, a foreign source, a missing `buildingId`, a payload over the limit. */
  private check(event: DomainEvent): void {
    const { rules } = this
    if (!rules) return
    const source = TYPE_FORMAT.exec(event.type)?.[1]
    if (source !== rules.source)
      throw new InvariantError(`event type ${event.type} does not belong to module ${rules.source}`)
    if (!rules.types.has(event.type))
      throw new InvariantError(`event type ${event.type} is not in the catalog of ${rules.source}`)
    if (!('buildingId' in event.payload))
      throw new InvariantError(`payload of ${event.type} has no buildingId`)
    if (new TextEncoder().encode(JSON.stringify(event.payload)).length > rules.maxPayloadBytes)
      throw new InvariantError(`payload of ${event.type} is over ${rules.maxPayloadBytes} bytes`)
  }

  async add(events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return
    if (!this.database.inTransaction) {
      throw new InvariantError(
        'OutboxWriter.add must be called inside UnitOfWork.run (transactional outbox)',
      )
    }
    for (const event of events) this.check(event)
    // Write the correlation into headers so async handler logs can be traced back to the original request.
    const ctx = requestContext.get()
    const headers: Record<string, string> = ctx
      ? { correlationId: ctx.correlationId, causationId: ctx.requestId }
      : {}
    // Same for the trace: the relay continues from this span, which may run long after the request has ended.
    const traceparent = currentTraceparent()
    if (traceparent) headers.traceparent = traceparent
    await this.database.executor.insert(this.table).values(
      events.map((e) => ({
        id: this.newId(),
        type: e.type,
        aggregateId: e.aggregateId,
        payload: e.payload,
        headers,
        occurredAt: e.occurredAt,
      })),
    )
  }
}
