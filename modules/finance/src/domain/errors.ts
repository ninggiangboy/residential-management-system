import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '@core/kernel'
import type { ChargeLineIssue } from './charge-line'

/** 409 `invalid_transition`: the batch or charge is not in the state the action needs (DOC-21 §8, DR-127). */
export class InvalidTransitionError extends ConflictError {
  constructor(
    entity: 'fee_batch' | 'charge' | 'payment' | 'gateway_event' | 'statement_line',
    status: string,
    action: string,
  ) {
    super('invalid_transition', 'The resource is not in a state that allows this', {
      details: { entity, status, action },
    })
  }
}

/** 409 `charge_exists`: the unit already has a charge in the batch; `chargeId` lets the screen open it (DOC-21 §3.2, DR-332). */
export class ChargeExistsError extends ConflictError {
  constructor(chargeId: string) {
    super('charge_exists', 'The unit already has a charge in this batch', { details: { chargeId } })
  }
}

/** 404 `unit_not_found`: no unit of the building has this code (DOC-21 §3.2, DR-332). */
export class UnitNotFoundError extends NotFoundError {
  constructor() {
    super('unit_not_found', 'No unit has this code')
  }
}

/** 422 rule `unit_without_owner`: a charge needs someone to notify (DOC-21 §3.2, §4.3, DR-332). */
export class UnitWithoutOwnerError extends RuleViolationError {
  constructor() {
    super('unit_without_owner', 'The unit has no active owner', 'unitCode')
  }
}

/** 422 rule `charge_total_zero`: the lines of a charge sum to zero or less (DOC-21 §3.2, DQ-76). */
export class ChargeTotalZeroError extends RuleViolationError {
  constructor() {
    super('charge_total_zero', 'The charge total must be above zero', 'lines')
  }
}

/** 400 `pattern` on `feeMonth`: a fee month is the first day of its month (DOC-21 §3.1 rule 1, `ck_fee_batch_fee_month`). */
export class FeeMonthNotFirstError extends ValidationError {
  constructor() {
    super([{ path: 'feeMonth', code: 'pattern', message: 'the first day of a month' }])
  }
}

/** 400: the bilingual name has a blank `vi` (DOC-21 §3.1). */
export class BatchNameInvalidError extends ValidationError {
  constructor() {
    super([{ path: 'name.vi', code: 'required', message: 'a Vietnamese name' }])
  }
}

/** 400: a line of the body broke a line rule of DOC-21 §4.2; each detail names `lines[i].<field>` and the rule code. */
export class ChargeLinesInvalidError extends ValidationError {
  constructor(issues: ReadonlyArray<{ readonly index: number; readonly issue: ChargeLineIssue }>) {
    super(
      issues.map(({ index, issue }) => ({
        path: `lines[${index}].${FIELD_OF[issue.column]}`,
        code: issue.code,
        message: issue.code,
      })),
    )
  }
}

const FIELD_OF: Readonly<Record<ChargeLineIssue['column'], string>> = {
  item_name: 'itemName.vi',
  item_name_en: 'itemName.en',
  kind: 'kind',
  quantity: 'quantity',
  unit_price: 'unitPrice',
  amount: 'amount',
  note: 'note',
}

/** 400 rule `no_charges`: a batch with no charge cannot be published (DOC-21 §3.3, FR-03.1). */
export class NoChargesError extends ValidationError {
  constructor() {
    super([{ path: '', code: 'no_charges', message: 'The batch has no charges' }])
  }
}

/** 400 rule `charge_total_zero` at publish, one detail per unit code (DOC-21 §3.3); `ck_charge_amount` makes it a second net. */
export class PublishChargeTotalZeroError extends ValidationError {
  constructor(unitCodes: readonly string[]) {
    super(
      unitCodes.map((unitCode) => ({
        path: unitCode,
        code: 'charge_total_zero',
        message: 'The charge total must be above zero',
      })),
    )
  }
}

/** 400 rule `due_date_in_past`: the due date is before the building's today (DOC-21 §3.3, DR-09). */
export class DueDateInPastError extends ValidationError {
  constructor() {
    super([{ path: 'dueDate', code: 'due_date_in_past', message: 'The due date is in the past' }])
  }
}

/** 400 rule `due_date_not_later`: an extension must move the date later (DOC-21 §3.4, FR-44.1). */
export class DueDateNotLaterError extends ValidationError {
  constructor() {
    super([
      { path: 'dueDate', code: 'due_date_not_later', message: 'The new due date is not later' },
    ])
  }
}

/** 409 `batch_has_payments`: a charge of the batch is paid, so the recall changed nothing (DOC-21 §3.5, FR-04.2). */
export class BatchHasPaymentsError extends ConflictError {
  constructor(paidCount: number) {
    super('batch_has_payments', 'The batch has payments and cannot be recalled', {
      details: { paidCount },
    })
  }
}

/** 409 `charge_not_voidable`: the charge is paid or has a live allocation (DOC-21 §3.9, FR-49.2). */
export class ChargeNotVoidableError extends ConflictError {
  constructor(status: string) {
    super('charge_not_voidable', 'The charge has been paid and cannot be voided', {
      details: { status },
    })
  }
}

/** The bounds of a recall or void reason after trimming (DOC-21 §3.5, §3.9, DOC-35 §3.5). */
const REASON_MIN = 5
const REASON_MAX = 500

/**
 * The trimmed reason, or 422 `reason_too_short` / `reason_too_long` on `path` (DOC-21 §3.5, §3.9, DR-332). A money-log review note
 * passes `max` 1,000 and `path` `note` (DOC-22 §9.2, §13 `MONEY_LOG_REVIEW_NOTE`).
 */
export function checkedReason(
  reason: string | undefined,
  { max = REASON_MAX, path = 'reason' }: { max?: number; path?: string } = {},
): string {
  const trimmed = reason?.trim() ?? ''
  if (trimmed.length < REASON_MIN)
    throw new RuleViolationError(
      'reason_too_short',
      `A reason of at least ${REASON_MIN} characters`,
      path,
    )
  if (trimmed.length > max)
    throw new RuleViolationError('reason_too_long', `A reason of at most ${max} characters`, path)
  return trimmed
}

/** One selected charge as it is now, for the 409 `charge_changed` answer (DOC-22 §4.3, DOC-42 §5.5). */
export interface ChangedCharge {
  readonly chargeId: string
  readonly status: string
  readonly version: number
}

/** 409 `charge_changed {charges}`: a selected charge is no longer `open` (DOC-22 §4.3, §5.2, FR-05.3). */
export class ChargeChangedError extends ConflictError {
  constructor(charges: readonly ChangedCharge[]) {
    super('charge_changed', 'A selected charge has changed', { details: { charges } })
  }
}

/** 422 `allocation_mismatch {expected, got}`: a request `amount` that differs from the sum (DOC-22 §5.1, FR-05.2). */
export class AllocationMismatchError extends RuleViolationError {
  // The answer's `details` are `{ expected, got }` (DOC-22 §5.1), not the rule list of a `validation_failed`.
  override readonly details: { readonly expected: number; readonly got: number }

  constructor(expected: number, got: number) {
    super(
      'allocation_mismatch',
      'The amount does not match the selected charges',
      'amount',
      'allocation_mismatch',
    )
    this.details = { expected, got }
  }
}

/** 409 `payment_not_voidable`: only `cash` and `bank_transfer` payments are voided (DOC-22 §6, FR-06.3, DR-24). */
export class PaymentNotVoidableError extends ConflictError {
  constructor(source: string) {
    super('payment_not_voidable', 'An online payment cannot be voided', { details: { source } })
  }
}

/** 409 `money_log_already_reviewed {reviewedAt}`: a log row is reviewed once (DOC-22 §9.2, FR-46.1). */
export class MoneyLogAlreadyReviewedError extends ConflictError {
  constructor(reviewedAt: Date) {
    super('money_log_already_reviewed', 'This row has already been reviewed', {
      details: { reviewedAt: reviewedAt.toISOString() },
    })
  }
}

/** A 400 rule of a request body (DOC-42 §5.2): `too_many_charges`, `received_on_future`, `no_unit_selected`, … on `path`. */
export class RequestRuleError extends ValidationError {
  constructor(path: string, rule: string, message: string) {
    super([{ path, code: rule, message }])
  }
}
