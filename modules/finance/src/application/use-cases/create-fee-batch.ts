import { type IdGenerator, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { LocalDate, StaffContext, StaffRole } from '@rms/shared-types'
import type { BatchCounter } from '../../domain/batch-counter'
import { batchCode, monthPeriod } from '../../domain/document-codes'
import { BatchNameInvalidError, FeeMonthNotFirstError } from '../../domain/errors'
import {
  type BilingualName,
  type FeeBatchRecord,
  isFirstOfMonth,
  normalizeBatchName,
} from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const CREATE_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface CreateFeeBatchInput {
  readonly name: BilingualName
  readonly feeMonth: LocalDate
  readonly dueDate: LocalDate
}

/**
 * `POST /staff/fee-batches` (DOC-21 §3.1): a draft batch whose code `PH-YYMM-NN` comes from the `batch` series with the period
 * of the **fee month**. The counter increment and the insert are one transaction, so a rolled-back create leaves no code; a
 * discarded draft's code is never issued again because the counter only moves forward (FR-02.4, DR-10). `dueDate` is checked
 * at publish, not here.
 */
export class CreateFeeBatch {
  private readonly auditedCreate: ReturnType<CreateFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    private readonly counter: BatchCounter,
    audited: Audited,
    private readonly ids: IdGenerator,
  ) {
    this.auditedCreate = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, input: CreateFeeBatchInput): Promise<FeeBatchRecord> {
    requireRole(staff, CREATE_FEE_BATCH_ROLES)
    if (!isFirstOfMonth(input.feeMonth)) throw new FeeMonthNotFirstError()
    const name = normalizeBatchName(input.name)
    if (!name) throw new BatchNameInvalidError()
    return this.uow.run(() => this.auditedCreate(staff, { ...input, name }))
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.create',
        object: (batch: FeeBatchRecord) => ({ type: 'fee_batch', id: batch.id }),
        details: (batch: FeeBatchRecord) => ({ code: batch.code, feeMonth: batch.feeMonth }),
      },
      async (staff: StaffContext, input: CreateFeeBatchInput) => {
        const period = monthPeriod(input.feeMonth)
        const n = await this.counter.next(staff.scope, 'batch', period)
        const batch = await this.batches.insert(staff.scope, {
          id: this.ids.next(),
          code: batchCode(period, n),
          name: input.name,
          feeMonth: input.feeMonth,
          dueDate: input.dueDate,
          createdBy: staff.staffId,
        })
        return { result: batch, changes: [] }
      },
    )
  }
}
