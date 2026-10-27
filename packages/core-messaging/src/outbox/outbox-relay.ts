import { requestContext } from '@core/context'
import type { Database } from '@core/db'
import { withAdvisoryXactLock } from '@core/db'
import type { Logger } from '@core/telemetry'
import { contextFromTraceparent, recordSpanError, SpanKind, withSpan } from '@core/telemetry'
import { and, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { Envelope, MessageHeaders } from '../envelope'
import { RetryLaterError } from '../errors'
import type { MessagePublisher } from '../ports'
import type { OutboxPolicy } from './config'
import type { InboxTable, OutboxTable } from './tables'

export interface OutboxSource {
  /** Name of the module emitting the event (written to envelope.source); also the schema. */
  name: string
  table: OutboxTable
  /** The inbox of the same schema, cleaned with the outbox (DOC-38 §2.5). */
  inboxTable?: InboxTable
}

export interface OutboxRelayOptions {
  pollIntervalMs: number
  batchSize?: number
  /**
   * How many aggregates are processed at the same time within a batch. Messages of one aggregate always run
   * one after another, in id order. Keep it below the DB pool size: each in-flight message holds a connection.
   */
  concurrency?: number
  leaseSeconds?: number
  /** The class of a message type: how many attempts it gets (DOC-09 §4.2). */
  policy?: (type: string) => OutboxPolicy
  /** Used when `policy` is not given. */
  maxAttempts?: number
  /** Backoff after a failed attempt: `min(base × 2^(attempts − 1), max)` seconds (DOC-38 §2.3). */
  backoffBaseSeconds?: number
  backoffMaxSeconds?: number
  retentionDays?: number
  /** At most one cleanup pass per source this often. */
  cleanupIntervalMs?: number
  /** Maximum time a message may be deferred by RetryLaterError (rate limit) before it is considered dead. */
  deferBudgetMs?: number
  /** Default delay when RetryLaterError carries no retryAfterMs. */
  defaultDeferMs?: number
  /**
   * The message types this build knows (the `outboxPolicies` of its modules). A message of another type was written by a newer
   * release, during a deploy: this build has no handler to run, and a bus with no handler for a type reports success, so the
   * message would be marked published and lost. It is deferred instead, until a build that knows the type claims it.
   * A known type with no handler is still published: a catalogued event may have no consumer yet.
   */
  knownTypes?: ReadonlySet<string>
  /** How long a message of an unknown type waits before it is claimed again. */
  unknownTypeDeferMs?: number
}

type ClaimedRow = {
  id: string
  type: string
  aggregateId: string
  occurredAt: Date
  payload: Record<string, unknown>
  headers: Record<string, string>
  attempts: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Reads each module's outbox and pushes through the MessagePublisher. Safe to run on multiple instances:
 * claims with `FOR UPDATE SKIP LOCKED` + a lease, so each message is handled by one instance at a time.
 */
export class OutboxRelay {
  private running = false
  private paused = false
  private loop?: Promise<void>
  /** The batch being processed right now, if any. */
  private working?: Promise<number>
  private lastCleanup = 0
  private lastPass: number | undefined

  private readonly batchSize: number
  private readonly concurrency: number
  private readonly leaseSeconds: number
  private readonly policy: (type: string) => OutboxPolicy
  private readonly backoffBaseSeconds: number
  private readonly backoffMaxSeconds: number
  private readonly retentionDays: number
  private readonly cleanupIntervalMs: number
  private readonly deferBudgetMs: number
  private readonly defaultDeferMs: number
  private readonly knownTypes: ReadonlySet<string> | undefined
  private readonly unknownTypeDeferMs: number

  constructor(
    private database: Database,
    private sources: OutboxSource[],
    private publisher: MessagePublisher,
    private logger: Logger,
    private options: OutboxRelayOptions,
  ) {
    this.batchSize = options.batchSize ?? 50
    this.concurrency = Math.max(1, options.concurrency ?? 4)
    this.leaseSeconds = options.leaseSeconds ?? 60
    const maxAttempts = options.maxAttempts ?? 8
    this.policy = options.policy ?? (() => ({ maxAttempts }))
    this.backoffBaseSeconds = options.backoffBaseSeconds ?? 5
    this.backoffMaxSeconds = options.backoffMaxSeconds ?? 900
    this.retentionDays = options.retentionDays ?? 7
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 10 * 60_000
    this.deferBudgetMs = options.deferBudgetMs ?? 24 * 3600_000
    this.defaultDeferMs = options.defaultDeferMs ?? 30_000
    this.knownTypes = options.knownTypes
    this.unknownTypeDeferMs = options.unknownTypeDeferMs ?? 10_000
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.loop = this.run()
  }

  /** Stops taking new batches and waits for the in-flight batch to finish. */
  async stop(): Promise<void> {
    this.running = false
    await this.loop
  }

  /**
   * Stops pulling from the outbox but keeps the loop alive: resolves once the batch in flight has finished, so nothing is
   * cut short. What is not published yet stays in the tables for whoever runs next. Safe to call before `start`.
   */
  async pause(): Promise<void> {
    this.paused = true
    await this.working
  }

  resume(): void {
    this.paused = false
  }

  /**
   * True when the loop finished a pass (a pass that found nothing, or a paused one, counts) within `maxAgeMs`: the
   * readiness check of the worker (DOC-38 §5.2). False before the first pass and when the loop is stalled.
   */
  isFresh(maxAgeMs: number): boolean {
    return this.lastPass !== undefined && Date.now() - this.lastPass <= maxAgeMs
  }

  /** The modules whose outbox this relay reads, in order (JB-24 compares them with `outbox:list`). */
  get sourceNames(): string[] {
    return this.sources.map((source) => source.name)
  }

  /** When the loop last finished a pass, for the gauge `worker_relay_last_pass_timestamp` (DOC-38 §8). */
  get lastPassAt(): Date | undefined {
    return this.lastPass === undefined ? undefined : new Date(this.lastPass)
  }

  private async run(): Promise<void> {
    while (this.running) {
      let processed = 0
      if (!this.paused) {
        this.working = this.tick()
        processed = await this.working
        this.working = undefined
      }
      this.lastPass = Date.now()
      // Keep going immediately while there is work, sleep only when idle (or paused).
      if (processed === 0) await sleep(this.options.pollIntervalMs)
    }
  }

  private async tick(): Promise<number> {
    let processed = 0
    try {
      for (const source of this.sources) {
        if (this.paused) break
        processed += await this.drain(source)
      }
      if (!this.paused) await this.maybeCleanup()
    } catch (err) {
      this.logger.error({ err }, 'outbox_tick_failed')
    }
    return processed
  }

  /** Processes one batch of one source; returns the number of messages claimed. */
  async drain(source: OutboxSource): Promise<number> {
    const { table } = source
    // One clock: due-ness and lease expiry are compared with the database's `now()`, the same clock that sets the lease.
    const now = sql`now()`
    const claimed = await this.database.db
      .update(table)
      .set({
        lockedUntil: sql`now() + make_interval(secs => ${this.leaseSeconds})`,
        attempts: sql`${table.attempts} + 1`,
      })
      .where(
        inArray(
          table.id,
          this.database.db
            .select({ id: table.id })
            .from(table)
            .where(
              and(
                isNull(table.publishedAt),
                isNull(table.deadAt),
                lte(table.nextAttemptAt, now),
                or(isNull(table.lockedUntil), lt(table.lockedUntil, now)),
              ),
            )
            .orderBy(table.id)
            .limit(this.batchSize)
            .for('update', { skipLocked: true }),
        ),
      )
      .returning()

    // Ordering: RETURNING has no defined order and ids are UUIDv7 (time-ordered), so sort by id, then run the
    // messages of one aggregate strictly in sequence while different aggregates proceed in parallel.
    const byAggregate = new Map<string, typeof claimed>()
    for (const row of [...claimed].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const group = byAggregate.get(row.aggregateId) ?? []
      group.push(row)
      byAggregate.set(row.aggregateId, group)
    }
    const queue = [...byAggregate.values()]
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const row of group) await this.process(source, row)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.concurrency, queue.length) }, worker))
    return claimed.length
  }

  private async process(source: OutboxSource, row: ClaimedRow): Promise<void> {
    const { table } = source
    if (this.knownTypes && !this.knownTypes.has(row.type)) {
      this.logger.warn({ messageId: row.id, type: row.type }, 'outbox_unknown_type')
      const reason = new RetryLaterError(
        `no build of this worker knows the type ${row.type}`,
        this.unknownTypeDeferMs,
      )
      await this.safely(row, () => this.defer(source, row, [reason]))
      return
    }
    const envelope: Envelope = {
      id: row.id,
      type: row.type,
      source: source.name,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt.toISOString(),
      payload: row.payload,
      headers: row.headers as MessageHeaders,
    }
    // A handler line carries the correlation id of the message as its request id, so a line of the worker joins the request
    // that began the chain (DOC-40 §3.1); the events a handler writes in turn keep it (causation = this message).
    const correlationId = row.headers.correlationId ?? row.id
    const context = { requestId: correlationId, correlationId }
    // Continues the trace of whatever wrote the event (a request, or a handler that emitted a follow-up event).
    const published = await requestContext.run(context, () =>
      withSpan(
        `outbox.relay ${row.type}`,
        {
          kind: SpanKind.CONSUMER,
          parent: contextFromTraceparent(row.headers.traceparent),
          attributes: {
            'messaging.system': 'outbox',
            'messaging.message.id': row.id,
            'messaging.destination.name': row.type,
            'outbox.source': source.name,
            'outbox.attempt': row.attempts,
            'app.correlation_id': row.headers.correlationId,
          },
        },
        async (span) => {
          try {
            await this.publisher.publish(envelope)
            return true
          } catch (err) {
            // Deferred by a rate limit is the system working as designed; only real failures mark the span.
            if (!isDeferral(err)) recordSpanError(span, err)
            else span.setAttribute('outbox.deferred', true)
            await this.safely(row, () => this.recordFailure(source, row, err))
            return false
          }
        },
      ),
    )
    if (!published) return
    // Published but not yet marked: if marking fails the lease expires and the message is redelivered (at-least-once).
    await this.safely(row, () =>
      this.database.db
        .update(table)
        .set({ publishedAt: sql`now()`, lockedUntil: null, lastError: null })
        .where(inArrayId(table, row.id)),
    )
  }

  /** One message's bookkeeping failing must not abandon the rest of the batch: its lease will expire and it is retried. */
  private async safely(row: { id: string }, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn()
    } catch (err) {
      this.logger.error({ err, messageId: row.id }, 'outbox_bookkeeping_failed')
    }
  }

  /** DOC-38 §2.3: back off `min(base × 2^(attempts − 1), max)`, or die at the class limit of the type. */
  private async recordFailure(
    source: OutboxSource,
    row: { id: string; type: string; attempts: number; occurredAt: Date },
    err: unknown,
  ) {
    const errors = flattenErrors(err)
    // Every error here means "retry later" (e.g. rate limited) → defer to the right time, without counting an attempt.
    if (
      errors.length > 0 &&
      errors.every((e): e is RetryLaterError => e instanceof RetryLaterError)
    ) {
      return this.defer(source, row, errors)
    }

    const { table } = source
    const message = err instanceof Error ? err.message : String(err)
    const { maxAttempts } = this.policy(row.type)
    const dead = row.attempts >= maxAttempts
    this.logger.warn(
      { messageId: row.id, type: row.type, attempts: row.attempts, dead, err: message },
      dead ? 'outbox_dead_letter' : 'outbox_publish_failed',
    )
    await this.database.db
      .update(table)
      .set({
        lockedUntil: null,
        lastError: message.slice(0, 2000),
        nextAttemptAt: sql`now() + make_interval(secs => least(${this.backoffBaseSeconds} * power(2, ${table.attempts} - 1), ${this.backoffMaxSeconds}))`,
        deadAt: dead ? sql`now()` : null,
      })
      .where(inArrayId(table, row.id))
  }

  /**
   * Defers the message until the provider/limiter allows it. `attempts` is given back (the relay incremented it on claim)
   * so a long rate-limit spell does not push the message to dead; bounded by a time budget counted from when the event occurred.
   */
  private async defer(
    source: OutboxSource,
    row: { id: string; attempts: number; occurredAt: Date },
    errors: RetryLaterError[],
  ) {
    const { table } = source
    const message = errors.map((e) => e.message).join('; ')
    const hinted = Math.max(0, ...errors.map((e) => e.retryAfterMs ?? 0))
    const delaySeconds = (hinted > 0 ? hinted : this.defaultDeferMs) / 1000
    this.logger.info({ messageId: row.id, delaySeconds, reason: message }, 'outbox_deferred')
    await this.database.db
      .update(table)
      .set({
        lockedUntil: null,
        attempts: sql`greatest(${table.attempts} - 1, 0)`,
        lastError: `deferred: ${message}`.slice(0, 2000),
        // 0-10 % jitter so messages deferred together do not all return at the same instant.
        nextAttemptAt: sql`now() + make_interval(secs => ${delaySeconds} * (1 + 0.1 * random()))`,
        deadAt: sql`case when ${table.occurredAt} < now() - make_interval(secs => ${this.deferBudgetMs / 1000}) then now() end`,
      })
      .where(inArrayId(table, row.id))
  }

  private async maybeCleanup(): Promise<void> {
    if (Date.now() - this.lastCleanup < this.cleanupIntervalMs) return
    this.lastCleanup = Date.now()
    for (const source of this.sources) await this.cleanup(source)
  }

  /**
   * Deletes published messages and delivered inbox rows past retention (the payload may contain one-time tokens). One
   * instance does it: the others skip without waiting (DOC-38 §2.5). Dead letters are never deleted.
   */
  async cleanup(source: OutboxSource): Promise<void> {
    const { name, table, inboxTable } = source
    await withAdvisoryXactLock(this.database, `outbox-cleanup:${name}`, async () => {
      const cutoff = sql`now() - make_interval(days => ${this.retentionDays})`
      await this.database.executor
        .delete(table)
        .where(and(isNotNull(table.publishedAt), lt(table.publishedAt, cutoff)))
      if (inboxTable)
        await this.database.executor.delete(inboxTable).where(lt(inboxTable.processedAt, cutoff))
    })
  }
}

function isDeferral(err: unknown): boolean {
  const errors = flattenErrors(err)
  return errors.length > 0 && errors.every((e) => e instanceof RetryLaterError)
}

/** Bus that collects errors from several handlers into an AggregateError. */
function flattenErrors(err: unknown): unknown[] {
  return err instanceof AggregateError ? err.errors.flatMap(flattenErrors) : [err]
}

function inArrayId(table: OutboxTable, id: string) {
  return inArray(table.id, [id])
}
