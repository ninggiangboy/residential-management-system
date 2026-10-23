import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  ValidationError,
} from '@core/kernel'

/** The one answer for a wrong password, an unknown email and an account that may not sign in (DOC-26 §4.1, ER-20). */
export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('invalid_credentials', 'The email or password is not correct')
  }
}

/** No token, an expired or forged access token, a refresh token that is unknown, expired or reused (DOC-42 §5.3). */
export class UnauthenticatedError extends UnauthorizedError {
  constructor() {
    super('unauthenticated', 'Please sign in again')
  }
}

/** A reset or invite link that is unknown, expired or used: the three answer the same (DOC-26 §4.3). */
export class TokenInvalidError extends ValidationError {
  constructor() {
    super([], 'token_invalid', 'This link is no longer valid')
  }
}

/** A password that breaks the rule of DOC-26 §4.2; a rule code of `validation_failed`, status 400 (DOC-42 §5.2). */
export class PasswordWeakError extends ValidationError {
  constructor() {
    super([
      {
        path: 'password',
        code: 'password_weak',
        message: 'The password needs 8 to 128 characters with letters and digits',
      },
    ])
  }
}

/** Any failure of a step-up proof: the same answer for each, with the tries left of the live code (FR-50.2). */
export class StepUpFailedError extends ForbiddenError {
  constructor(attemptsLeft: number) {
    super('step_up_failed', 'The password or code is not correct', { details: { attemptsLeft } })
  }
}

/** A wrong, expired, used or unknown code: one answer for each, with the tries left of the live challenge (DOC-26 §5.2, FR-15.3). */
export class OtpInvalidError extends DomainError {
  constructor(attemptsLeft: number) {
    super('otp_invalid', 'The code is not correct', 'validation', { details: { attemptsLeft } })
  }
}

/** An OTP asked for a phone with no account that may sign in: no challenge, no SMS (DOC-26 §5.1 step 2, FR-15.1). */
export class PhoneNotRegisteredError extends NotFoundError {
  constructor() {
    super('phone_not_registered', 'This number is not registered')
  }
}

/** The provider looks down, or the daily cap is reached: no new challenge until a command is delivered (DOC-26 §5.4, DR-134). */
export class SmsUnavailableError extends UnavailableError {
  constructor() {
    super('sms_unavailable', 'Could not send the code', 60)
  }
}

/** A phone number that is valid nowhere: 400 `validation_failed`, rule `phone_invalid` (DOC-26 §5.1, DR-114). */
export class PhoneInvalidError extends ValidationError {
  constructor() {
    super([{ path: 'phone', code: 'phone_invalid', message: 'The phone number is not valid' }])
  }
}

/** A staff member acting on their own account where the rule forbids it: lock, disable, role change (DOC-26 §4.4 rule 2, AU-18). */
export class StaffSelfActionError extends ForbiddenError {
  constructor() {
    super('forbidden', 'This cannot be done to your own account', { details: { reason: 'self' } })
  }
}

/** The last active Admin of the building may not be locked, disabled or demoted (DOC-26 §4.4 rule 3, AU-17). */
export class LastAdminError extends ConflictError {
  constructor() {
    super('last_admin', 'The building must keep at least one active Admin')
  }
}

/** A person with open tickets may not be locked, disabled or given another role unless an Admin reassigns them (FR-14.3). */
export class StaffHasOpenTicketsError extends ConflictError {
  constructor(tickets: readonly { ticketId: string; code: string; status: string }[]) {
    super('staff_has_open_tickets', 'This person still has open requests. Reassign them first.', {
      details: { tickets },
    })
  }
}

/** A work email that belongs to another account, in any building (`uq_staff_account_email`, FR-14.1). */
export class EmailInUseError extends ConflictError {
  constructor() {
    super('email_in_use', 'This email address already has an account')
  }
}

/** The account is in a state that does not allow the action (DR-147): the answer names the entity, the state and the action. */
export class InvalidStaffTransitionError extends ConflictError {
  constructor(status: string, action: string) {
    super('invalid_transition', 'This can no longer be done in its current state', {
      details: { entity: 'staff_account', status, action },
    })
  }
}

/** The number is another account's (FR-18.4): 409 `phone_in_use`, and nothing changed. */
export class PhoneInUseError extends ConflictError {
  constructor() {
    super('phone_in_use', 'This phone number already has an account')
  }
}
