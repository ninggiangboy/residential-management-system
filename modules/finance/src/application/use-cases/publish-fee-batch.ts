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
import { buildingToday, type StaffContext, type StaffRole } from '@rms/shared-types'
import { type BatchPublishedPayload, FINANCE_EVENTS } from '../../contracts'
import {
  DueDateInPastError,
  InvalidTransitionError,
  NoChargesError,
  PublishChargeTotalZeroError,
  versionConflict,
} from '../../domain/errors'
import type { FeeBatchRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { monthOf, unitChunks } from '../fan-out'
import type { BuildingCalendar } from '../ports'

/** The Manager's and the Admin's (DOC-21 §2.3, DOC-35 §4.1). */
export const PUBLISH_FEE_BATCH_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/fee-batches/{id}/publish` with `If-Match` (DOC-21 §3.3, FR-03). The checks run in order before any write: a
 * draft (409 `invalid_transition`), at least one charge (400 `no_charges`), every total above zero (400 `charge_total_zero`),
 * `due_date >= buildingToday` (400 `due_date_in_past`). Then the batch `… WHERE status = 'draft' AND version = :v` and its
 * charges `draft → open`; of two Managers the second updates nothing and answers 409 with no event (FR-03.2, LG-61). An edit or
 * import commit bumped the version, so a publish prepared from an older screen is 409 `version_conflict` (LG-62). The chunked
 * `finance.batch_published.v1`, the audit row and the log line commit with it.
 */
export class PublishFeeBatch {
  private readonly auditedPublish: ReturnType<PublishFeeBatch['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly batches: FeeBatchRepository,
    private readonly calendar: BuildingCalendar,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly logger: Log,
  ) {
    this.auditedPublish = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    batchId: string,
    version: number | undefined,
  ): Promise<FeeBatchRecord> {
    requireRole(staff, PUBLISH_FEE_BATCH_ROLES)
    if (version === undefined) throw new PreconditionRequiredError()
    const timeZone = await this.calendar.timeZone(staff.scope.buildingId)
    const started = this.clock.now().getTime()
    const { batch, unitIds, parts } = await this.uow.run(() =>
      this.auditedPublish(staff, batchId, version, timeZone),
    )
    this.logger.info(
      {
        event: 'fee_batch.published',
        buildingId: staff.scope.buildingId,
        batchId,
        actor: staff.staffId,
        charges: unitIds,
        parts,
        ms: this.clock.now().getTime() - started,
      },
      'fee batch published',
    )
    return batch
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.batch.publish',
        object: (out: Published) => ({ type: 'fee_batch', id: out.batch.id }),
      },
      async (staff: StaffContext, batchId: string, version: number, timeZone: string) => {
        const stored = await this.batches.find(staff.scope, batchId)
        if (!stored) throw new NotFoundError()
        if (stored.status !== 'draft')
          throw new InvalidTransitionError('fee_batch', stored.status, 'publish')
        const summary = await this.batches.draftChargeSummary(staff.scope, batchId)
        if (summary.count === 0) throw new NoChargesError()
        if (summary.nonPositive.length > 0)
          throw new PublishChargeTotalZeroError(summary.nonPositive)
        if (stored.dueDate < buildingToday(this.clock.now(), timeZone))
          throw new DueDateInPastError()
        const published = await this.batches.publish(staff.scope, batchId, staff.staffId, version)
        if (!published) throw await this.refusal(staff, batchId)
        const { batch, unitIds } = published
        const chunks = unitChunks(unitIds)
        const now = this.clock.now()
        await this.outbox.add(
          chunks.map((chunk) => ({
            type: FINANCE_EVENTS.batchPublished,
            aggregateId: batch.id,
            payload: {
              buildingId: staff.scope.buildingId,
              batchId: batch.id,
              code: batch.code,
              feeMonth: monthOf(batch.feeMonth),
              dueDate: batch.dueDate,
              ...chunk,
            } satisfies BatchPublishedPayload,
            occurredAt: now,
          })),
        )
        return {
          result: { batch, unitIds: unitIds.length, parts: chunks.length },
          changes: [{ field: 'status', before: 'draft', after: 'published' }],
        }
      },
    )
  }

  /** 0 rows: another publish won (409 `invalid_transition`) or the version is stale (409 `version_conflict`, DOC-21 §3.3). */
  private async refusal(staff: StaffContext, batchId: string): Promise<Error> {
    const fresh = await this.batches.find(staff.scope, batchId)
    if (!fresh) return new NotFoundError()
    if (fresh.status !== 'draft')
      return new InvalidTransitionError('fee_batch', fresh.status, 'publish')
    return versionConflict(fresh)
  }
}

interface Published {
  readonly batch: FeeBatchRecord
  readonly unitIds: number
  readonly parts: number
}
