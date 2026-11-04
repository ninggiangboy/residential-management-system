import {
  type Clock,
  type Log,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { type BatchRecalledPayload, FINANCE_EVENTS } from '../../contracts'
import {
  BatchHasPaymentsError,
  checkedReason,
  InvalidTransitionError,
  versionConflict,
} from '../../domain/errors'
import type { FeeBatchRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { monthOf, unitChunks } from '../fan-out'
import type { IntentCancellation } from '../intent-cancellation'
import { withSerializationRetry } from '../serialization-retry'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const RECALL_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface Recalled {
  readonly batch: FeeBatchRecord
  readonly chargeCount: number
  readonly intentIds: readonly string[]
}

/**
 * `POST /staff/fee-batches/{id}/recall { reason }` with `If-Match` (DOC-21 §3.5, FR-04). In one transaction: the batch `published
 * → recalled` (`… AND version = :v`, which locks the row); the expected count of charges that are not `void`, read after the lock
 * (DR-97); `open → void` (`void_kind = 'recall'`) for the batch; a count that differs means a charge is paid, so everything rolls
 * back and the answer is 409 `batch_has_payments {paidCount}` (FR-04.2). Then every active intent holding one of the charges is
 * cancelled as a whole (`IntentCancellation`, FR-04.1), the chunked `finance.batch_recalled.v1` and the audit row with the reason
 * commit with it. The arbiter of the race with a settlement is the charge row (DOC-22 §10); a deadlock with `settle()` is
 * retried whole (DOC-23 §7.2).
 */
export class RecallFeeBatch {
  private readonly auditedRecall: ReturnType<RecallFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    private readonly cancellation: IntentCancellation,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly logger: Log,
  ) {
    this.auditedRecall = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    input: { readonly reason: string; readonly version: number | undefined },
  ): Promise<Recalled> {
    requireRole(staff, RECALL_FEE_BATCH_ROLES)
    const reason = checkedReason(input.reason)
    const { version } = input
    if (version === undefined) throw new PreconditionRequiredError()
    const started = this.clock.now().getTime()
    try {
      const out = await withSerializationRetry(() =>
        this.uow.run(() => this.auditedRecall(staff, batchId, version, reason)),
      )
      this.logger.info(
        {
          event: 'fee_batch.recalled',
          buildingId: staff.scope.buildingId,
          batchId,
          actor: staff.staffId,
          charges: out.chargeCount,
          intents: out.intentIds.length,
          ms: this.clock.now().getTime() - started,
        },
        'fee batch recalled',
      )
      return out
    } catch (error) {
      if (error instanceof BatchHasPaymentsError)
        this.logger.info(
          {
            event: 'fee_batch.recall_refused',
            buildingId: staff.scope.buildingId,
            batchId,
            actor: staff.staffId,
            paidCount: (error.details as { paidCount: number }).paidCount,
          },
          'fee batch recall refused',
        )
      throw error
    }
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.recall',
        object: (out: Recalled) => ({ type: 'fee_batch', id: out.batch.id }),
        reason: (_staff: StaffContext, _batchId: string, _version: number, reason: string) =>
          reason,
      },
      async (staff: StaffContext, batchId: string, version: number, _reason: string) => {
        const scope = staff.scope
        const batch = await this.batches.markRecalled(scope, batchId, staff.staffId, version)
        if (!batch) throw await this.refusal(staff, batchId)
        const expected = await this.batches.countNotVoid(scope, batchId)
        const voided = await this.batches.voidOpenCharges(scope, batchId, staff.staffId)
        // DOC-21 §3.5 step 3: a paid charge was not voided; the throw rolls back the batch status too (FNM-S04).
        if (voided.length !== expected) throw new BatchHasPaymentsError(expected - voided.length)
        const { intentIds } = await this.cancellation.cancelHolding(
          scope,
          voided.map((c) => c.chargeId),
          'batch_recalled',
        )
        const unitIds = [...new Set(voided.map((c) => c.unitId))]
        const now = this.clock.now()
        await this.outbox.add(
          unitChunks(unitIds).map((chunk) => ({
            type: FINANCE_EVENTS.batchRecalled,
            aggregateId: batch.id,
            payload: {
              buildingId: scope.buildingId,
              batchId: batch.id,
              code: batch.code,
              feeMonth: monthOf(batch.feeMonth),
              ...chunk,
            } satisfies BatchRecalledPayload,
            occurredAt: now,
          })),
        )
        return {
          result: { batch, chargeCount: voided.length, intentIds },
          changes: [{ field: 'status', before: 'published', after: 'recalled' }],
        }
      },
    )
  }

  /** 0 rows at step 1: a closed or recalled batch is 409 `invalid_transition` (FR-04.4), a stale version 409 `version_conflict`. */
  private async refusal(staff: StaffContext, batchId: string): Promise<Error> {
    const fresh = await this.batches.find(staff.scope, batchId)
    if (!fresh) return new NotFoundError()
    if (fresh.status !== 'published')
      return new InvalidTransitionError('fee_batch', fresh.status, 'recall')
    return versionConflict(fresh)
  }
}
