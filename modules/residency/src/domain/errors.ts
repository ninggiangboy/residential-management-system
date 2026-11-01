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
  /** `unitIds` names the units the account owns when its deletion is approved (E-68, DOC-35 §10.1). */
  constructor(unitIds?: readonly string[]) {
    super(
      'owner_must_transfer',
      'Ownership changes only by a transfer',
      unitIds === undefined ? undefined : { details: { unitIds: [...unitIds] } },
    )
  }
}

/** 422 `validation_failed`, rule `can_pay_tenant_only`: `can_pay` is read only for a tenant (DR-139). */
export class CanPayTenantOnlyError extends RuleViolationError {
  constructor() {
    super('can_pay_tenant_only', 'can_pay applies to a tenant only', 'canPay')
  }
}

/** 409 `unit_code_in_use`: the code, matched without case, belongs to another unit of the building (DOC-27 §4.1 rule 2). */
export class UnitCodeInUseError extends ConflictError {
  constructor() {
    super('unit_code_in_use', 'Another unit has this code')
  }
}

/** 409 `member_exists`: the account already has a non-removed membership of the unit (DOC-27 §5.1, §7). */
export class MemberExistsError extends ConflictError {
  constructor(membershipId: string, memberType?: string) {
    super('member_exists', 'This person is already a member of the unit', {
      details: memberType === undefined ? { membershipId } : { membershipId, memberType },
    })
  }
}

/** 409 `unit_has_owner`: replacing an owner is a transfer (DOC-27 §5.1 step 3). */
export class UnitHasOwnerError extends ConflictError {
  constructor(ownerMembershipId: string) {
    super('unit_has_owner', 'The unit already has an owner', { details: { ownerMembershipId } })
  }
}

/** 409 `unit_type_code_in_use`: the code exists in the building; `unit_type_code_key` decides (DOC-27 §4.3, DR-314). */
export class UnitTypeCodeInUseError extends ConflictError {
  constructor() {
    super('unit_type_code_in_use', 'Another unit type of the building has this code')
  }
}

/** 409 `unit_type_name_in_use`: another type has this Vietnamese name in any case; `unit_type_name_key` decides (DR-314). */
export class UnitTypeNameInUseError extends ConflictError {
  constructor() {
    super('unit_type_name_in_use', 'Another unit type of the building has this name')
  }
}

/** 409 `unit_type_limit`: a building has at most 50 unit types, archived ones counted (DOC-27 §4.3 rule 5). */
export class UnitTypeLimitError extends ConflictError {
  constructor(max: number) {
    super('unit_type_limit', 'The building has the most unit types it can have', {
      details: { max },
    })
  }
}

/** 422 `validation_failed`, rule `unit_type_unknown`: no such type, or one of another building, the same answer (DOC-27 §4.3 rule 4). */
export class UnitTypeUnknownError extends RuleViolationError {
  constructor() {
    super('unit_type_unknown', 'There is no such unit type', 'unitTypeId')
  }
}

/** 422 `validation_failed`, rule `unit_type_archived`: a unit is given an archived type that is not its own (DOC-27 §4.3 rule 3). */
export class UnitTypeArchivedError extends RuleViolationError {
  constructor() {
    super('unit_type_archived', 'This unit type is no longer in use', 'unitTypeId')
  }
}
