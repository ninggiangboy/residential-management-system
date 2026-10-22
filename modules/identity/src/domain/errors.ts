import { ForbiddenError, UnauthorizedError, ValidationError } from '@core/kernel'

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
