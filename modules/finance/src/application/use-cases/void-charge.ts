import {
  type Clock,
  type Log,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  VersionConflictError,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { type ChargeVoidedPayload, FINANCE_EVENTS } from '../../contracts'
import type { ChargeRepository } from '../../domain/charge-repository'
import { ChargeNotVoidableError, checkedReason, InvalidTransitionError } from '../../domain/errors'
import type { ChargeRecord } from '../../domain/fee-batch'
import type { FeeBatchRepository } from '../../domain/fee-batch-repository'
import { monthOf } from '../fan-out'
import type { IntentCancellation } from '../intent-cancellation'
import { withSerializationRetry } from '../serialization-retry'

/** The Manager's and the Admin's; a Technician is 403 (DOC-21 §3.9, FR-49, DOC-35 §4.1). */
export const VOID_CHARGE_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

export interface Voided {
  readonly charge: ChargeRecord
  readonly intentIds: readonly string[]
}

/**
 * `POST /staff/charges/{id}/void { reason }` with `If-Match` (DOC-21 §3.9, FR-49, DR-19, DR-20): one wrong open charge in a batch
 * that cannot be recalled. `open → void` with `void_kind = 'single'` and the reason, `… WHERE status = 'open' AND version = :v`;
 * a paid charge or one with a live allocation is 409 `charge_not_voidable {status}`, an already void one 409
 * `invalid_transition`, a stale version 409 `version_conflict` with the fresh charge (FR-49.5). In the same transaction every
 * intent holding the charge is cancelled as a whole (FR-49.3), and `finance.charge_voided.v1` and the audit row are written.
 * The voided charge is never reopened; the corrected charge goes into a new draft batch (FR-49.4). The void is independent of
 * the money log (DR-16). A deadlock with `settle()` is retried whole (DOC-23 §7.2).
 */
export class VoidCharge {
  private readonly auditedVoid: ReturnType<VoidCharge['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly charges: ChargeRepository,
    private readonly batches: FeeBatchRepository,
    private readonly cancellation: IntentCancellation,
    private readonly outbox: OutboxWriter,
    audited: Audited,
    private readonly clock: Clock,
    private readonly logger: Log,
  ) {
    this.auditedVoid = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    chargeId: string,
    input: { readonly reason: string; readonly version: number | undefined },
  ): Promise<Voided> {
    requireRole(staff, VOID_CHARGE_ROLES)
    const reason = checkedReason(input.reason)
    const { version } = input
    if (version === undefined) throw new PreconditionRequiredError()
    const out = await withSerializationRetry(() =>
      this.uow.run(() => this.auditedVoid(staff, chargeId, version, reason)),
    )
    this.logger.info(
      {
        event: 'charge.voided',
        buildingId: staff.scope.buildingId,
        chargeId,
        batchId: out.charge.batchId,
        actor: staff.staffId,
        intents: out.intentIds.length,
      },
      'charge voided',
    )
    return out
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.charge.void',
        object: (out: Voided) => ({ type: 'charge', id: out.charge.id }),
        reason: (_staff: StaffContext, _chargeId: string, _version: number, reason: string) =>
          reason,
      },
      async (staff: StaffContext, chargeId: string, version: number, reason: string) => {
        const scope = staff.scope
        const before = await this.charges.find(scope, chargeId)
        if (!before) throw new NotFoundError()
        await this.assertVoidable(staff, before, version)
        const voided = await this.charges.voidOpen(scope, chargeId, reason, staff.staffId, version)
        if (!voided) {
          // Paid, voided or edited between the read and the statement (FR-49.5): answer from the fresh row.
          const fresh = await this.charges.find(scope, chargeId)
          if (!fresh) throw new NotFoundError()
          await this.assertVoidable(staff, fresh, version)
          throw new VersionConflictError(fresh)
        }
        const charge: ChargeRecord = { ...voided, batchStatus: before.batchStatus }
        const { intentIds } = await this.cancellation.cancelHolding(
          scope,
          [chargeId],
          'charge_voided',
        )
        const batch = await this.batches.find(scope, charge.batchId)
        if (!batch) throw new NotFoundError()
        await this.outbox.add([
          {
            type: FINANCE_EVENTS.chargeVoided,
            aggregateId: chargeId,
            payload: {
              buildingId: scope.buildingId,
              chargeId,
              batchId: charge.batchId,
              unitId: charge.unitId,
              feeMonth: monthOf(batch.feeMonth),
            } satisfies ChargeVoidedPayload,
            occurredAt: this.clock.now(),
          },
        ])
        return {
          result: { charge, intentIds },
          changes: [{ field: 'status', before: 'open', after: 'void' }],
        }
      },
    )
  }

  /** The order of DOC-21 §3.9: paid or allocated → `charge_not_voidable`; void or draft → `invalid_transition`; stale → 409. */
  private async assertVoidable(
    staff: StaffContext,
    charge: ChargeRecord,
    version: number,
  ): Promise<void> {
    if (charge.status === 'paid') throw new ChargeNotVoidableError('paid')
    if (charge.status !== 'open') throw new InvalidTransitionError('charge', charge.status, 'void')
    if (await this.charges.hasLiveAllocation(staff.scope, charge.id))
      throw new ChargeNotVoidableError('open')
    if (charge.version !== version) throw new VersionConflictError(charge)
  }
}
