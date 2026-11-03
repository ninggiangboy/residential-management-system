import {
  type IdGenerator,
  type Log,
  NotFoundError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { LocalDate, StaffContext, StaffRole } from '@rms/shared-types'
import type { BatchCounter } from '../../domain/batch-counter'
import { batchCode, monthPeriod } from '../../domain/document-codes'
import { InvalidTransitionError } from '../../domain/errors'
import type { FeeBatchRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const REISSUE_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface ReissueFeeBatchInput {
  /** The new draft's due date; the old one when absent. The publish check tests it (DOC-21 §3.7). */
  readonly dueDate?: LocalDate
}

export interface Reissued {
  readonly batch: FeeBatchRecord
  readonly chargeCount: number
}

/**
 * `POST /staff/fee-batches/{id}/reissue` (DOC-21 §3.7, FR-04.5, DR-20, DR-265): a corrected draft from a **recalled** batch. A
 * new code from the `batch` series of the same fee month, the same name, `replaces_batch_id` = the recalled batch, and a copy
 * under new ids of every charge and line except the charges voided alone. The counter, the batch and the copy are one
 * transaction. Any other status is 409 `invalid_transition` (LG-74). A second re-issue is allowed: the recalled batch keeps no
 * pointer to its children. No event: no resident sees a draft.
 */
export class ReissueFeeBatch {
  private readonly auditedReissue: ReturnType<ReissueFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    private readonly counter: BatchCounter,
    audited: Audited,
    private readonly ids: IdGenerator,
    private readonly logger: Log,
  ) {
    this.auditedReissue = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    input: ReissueFeeBatchInput = {},
  ): Promise<Reissued> {
    requireRole(staff, REISSUE_FEE_BATCH_ROLES)
    const out = await this.uow.run(() => this.auditedReissue(staff, batchId, input))
    this.logger.info(
      {
        event: 'fee_batch.reissued',
        buildingId: staff.scope.buildingId,
        batchId: out.batch.id,
        replaces: batchId,
        actor: staff.staffId,
        charges: out.chargeCount,
      },
      'fee batch re-issued',
    )
    return out
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.reissue',
        object: (out: Reissued) => ({ type: 'fee_batch', id: out.batch.id }),
        details: (out: Reissued) => ({
          replaces: out.batch.replacesBatchId ?? null,
          chargeCount: out.chargeCount,
        }),
      },
      async (staff: StaffContext, batchId: string, input: ReissueFeeBatchInput) => {
        const recalled = await this.batches.find(staff.scope, batchId)
        if (!recalled) throw new NotFoundError()
        if (recalled.status !== 'recalled')
          throw new InvalidTransitionError('fee_batch', recalled.status, 'reissue')
        const period = monthPeriod(recalled.feeMonth)
        const n = await this.counter.next(staff.scope, 'batch', period)
        const batch = await this.batches.insert(staff.scope, {
          id: this.ids.next(),
          code: batchCode(period, n),
          name: recalled.name,
          feeMonth: recalled.feeMonth,
          dueDate: input.dueDate ?? recalled.dueDate,
          createdBy: staff.staffId,
          replacesBatchId: recalled.id,
        })
        const copies = await this.batches.copyableCharges(staff.scope, recalled.id, batch.id, () =>
          this.ids.next(),
        )
        await this.batches.insertDraftCharges(staff.scope, copies)
        return { result: { batch, chargeCount: copies.length }, changes: [] }
      },
    )
  }
}
