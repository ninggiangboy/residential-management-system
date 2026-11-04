import {
  type Log,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { InvalidTransitionError, versionConflict } from '../../domain/errors'
import type { FeeBatchRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'

/** The Manager's and the Admin's (DOC-21 §3.6, DOC-35 §4.1). */
export const CLOSE_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/fee-batches/{id}/close` with `If-Match` (DOC-21 §3.6, DR-20): a manual freeze for reporting only. `… WHERE status =
 * 'published' AND version = :v`; open charges stay open, payable and in debt; a closed batch cannot be recalled or extended. No
 * event and no notification; a recalled or closed batch is 409 `invalid_transition` (LG-67).
 */
export class CloseFeeBatch {
  private readonly auditedClose: ReturnType<CloseFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    audited: Audited,
    private readonly logger: Log,
  ) {
    this.auditedClose = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    version: number | undefined,
  ): Promise<FeeBatchRecord> {
    requireRole(staff, CLOSE_FEE_BATCH_ROLES)
    if (version === undefined) throw new PreconditionRequiredError()
    const batch = await this.uow.run(() => this.auditedClose(staff, batchId, version))
    this.logger.info(
      {
        event: 'fee_batch.closed',
        buildingId: staff.scope.buildingId,
        batchId,
        actor: staff.staffId,
      },
      'fee batch closed',
    )
    return batch
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.close',
        object: (batch: FeeBatchRecord) => ({ type: 'fee_batch', id: batch.id }),
      },
      async (staff: StaffContext, batchId: string, version: number) => {
        const closed = await this.batches.close(staff.scope, batchId, staff.staffId, version)
        if (!closed) {
          const fresh = await this.batches.find(staff.scope, batchId)
          if (!fresh) throw new NotFoundError()
          if (fresh.status !== 'published')
            throw new InvalidTransitionError('fee_batch', fresh.status, 'close')
          throw versionConflict(fresh)
        }
        return {
          result: closed,
          changes: [{ field: 'status', before: 'published', after: 'closed' }],
        }
      },
    )
  }
}
