import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '@core/kernel'
import type { ChargeLineIssue } from './charge-line'

/** 409 `invalid_transition`: the batch or charge is not in the state the action needs (DOC-21 §8, DR-127). */
export class InvalidTransitionError extends ConflictError {
  constructor(entity: 'fee_batch' | 'charge', status: string, action: string) {
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
