import { type Log, NotFoundError, requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import {
  checkedReason,
  InvalidTransitionError,
  MoneyLogAlreadyReviewedError,
} from '../../domain/errors'
import type { MoneyLogKind, MoneyLogRepository } from '../../domain/money-log-repository'

/** The Manager's and the Admin's (DOC-22 §9.2, FR-46, DOC-35 §4.1). */
export const REVIEW_MONEY_LOG_ROW_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/** The `MONEY_LOG_REVIEW_NOTE` bound of DOC-22 §13: 5 to 1,000 characters (DOC-22 §9.2). */
export const MONEY_LOG_REVIEW_NOTE_MAX = 1000

export interface MoneyLogReviewed {
  readonly kind: MoneyLogKind
  readonly id: string
  readonly reviewedAt: Date
}

/**
 * `POST /staff/money-log/{kind}/{id}/review { note }` (DOC-22 §9.2, FR-46, DR-16): a Manager or an Admin marks one
 * `gateway_event` or `statement_line` row reviewed with a note of 5 to 1,000 characters, once. The conditional update
 * matches a reviewable row with `reviewed_at IS NULL`; 0 rows reads the row for 404, 409 `money_log_already_reviewed
 * {reviewedAt}` or 409 `invalid_transition`. The review never touches the ledger (FR-46.3), so there is no retry
 * (DOC-22 §11).
 */
export class ReviewMoneyLogRow {
  private readonly auditedReview: ReturnType<ReviewMoneyLogRow['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly log: MoneyLogRepository,
    audited: Audited,
    private readonly logger: Log,
  ) {
    this.auditedReview = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    kind: MoneyLogKind,
    id: string,
    input: { readonly note: string },
  ): Promise<MoneyLogReviewed> {
    requireRole(staff, REVIEW_MONEY_LOG_ROW_ROLES)
    const note = checkedReason(input.note, { max: MONEY_LOG_REVIEW_NOTE_MAX, path: 'note' })
    const out = await this.uow.run(() => this.auditedReview(staff, kind, id, note))
    this.logger.info(
      {
        event: 'money_log.reviewed',
        buildingId: staff.scope.buildingId,
        kind,
        id,
        actor: staff.staffId,
      },
      'money log row reviewed',
    )
    return out
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'finance.money_log.review',
        object: (out: MoneyLogReviewed) => ({ type: out.kind, id: out.id }),
        reason: (_staff: StaffContext, _kind: MoneyLogKind, _id: string, note: string) => note,
      },
      async (staff: StaffContext, kind: MoneyLogKind, id: string, note: string) => {
        const scope = staff.scope
        const ok = await this.log.review(scope, kind, id, staff.staffId, note)
        const state = await this.log.state(scope, kind, id)
        if (!ok) {
          if (!state) throw new NotFoundError()
          if (state.reviewedAt) throw new MoneyLogAlreadyReviewedError(state.reviewedAt)
          throw new InvalidTransitionError(kind, state.status, 'review')
        }
        return {
          result: { kind, id, reviewedAt: state?.reviewedAt as Date },
          changes: [{ field: 'reviewed', before: null, after: note }],
        }
      },
    )
  }
}
