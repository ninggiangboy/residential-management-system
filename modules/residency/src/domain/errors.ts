import { ConflictError, RuleViolationError } from '@core/kernel'

/** 409 `invalid_transition`: the state does not allow the action (DOC-27 §6.1, DR-127). */
export class InvalidMembershipTransitionError extends ConflictError {
  constructor(status: string, action: string) {
    super('invalid_transition', 'The membership is not in a state that allows this', {
      details: { entity: 'membership', status, action },
    })
  }
}

/** 409 `owner_must_transfer`: the owner row is removed or retyped only by a transfer (DR-139). */
export class OwnerMustTransferError extends ConflictError {
  constructor() {
    super('owner_must_transfer', 'Ownership changes only by a transfer')
  }
}

/** 422 `validation_failed`, rule `can_pay_tenant_only`: `can_pay` is read only for a tenant (DR-139). */
export class CanPayTenantOnlyError extends RuleViolationError {
  constructor() {
    super('can_pay_tenant_only', 'can_pay applies to a tenant only', 'canPay')
  }
}
