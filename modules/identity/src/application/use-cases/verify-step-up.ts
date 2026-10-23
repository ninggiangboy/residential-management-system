import type { Clock } from '@core/kernel'
import { requireRole } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StepUpAction } from '../../contracts'
import { StepUpFailedError } from '../../domain/errors'
import { normalizePassword } from '../../domain/password-policy'
import type { PasswordTokenRepository } from '../../domain/password-token-repository'
import { StaffAccount } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
import type { MailCommands } from '../mail-commands'
import type { AutonomousTransaction, PasswordHasher, TokenFactory } from '../ports'

export interface VerifyStepUpDeps {
  staffAccounts: StaffAccountRepository
  passwordTokens: PasswordTokenRepository
  hasher: PasswordHasher
  factory: TokenFactory
  mail: MailCommands
  building: Pick<BuildingApi, 'getSettings'>
  autonomous: AutonomousTransaction
  clock: Clock
  config: IdentityConfig
}

/** Every step-up action is the Admin's (DOC-26 §4.5). */
const VERIFY_STEP_UP_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * `IdentityApi.verifyStepUp` (DOC-26 §4.5), in the transaction of the action that asked: checks the password, consumes the live
 * code, and queues a notice to every active Admin so the notices exist only if the change commits. A wrong password counts toward
 * the sign-in lockout; a wrong code counts toward the code's five tries. Both counters are written in their own transaction,
 * because the action's rollback would otherwise erase them and a stolen session could guess for ever (DR-132).
 */
export class VerifyStepUp {
  constructor(private readonly deps: VerifyStepUpDeps) {}

  async execute(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void> {
    requireRole(staff, VERIFY_STEP_UP_ROLES)
    const {
      staffAccounts,
      passwordTokens,
      hasher,
      factory,
      mail,
      building,
      autonomous,
      clock,
      config,
    } = this.deps
    const now = clock.now()
    const record = await staffAccounts.findById(staff.staffId)
    const account = record ? new StaffAccount(record) : null

    // 1. The password. An account in a temporary lock fails too, without a check.
    const passwordOk =
      !!record?.passwordHash &&
      account?.canSignIn === true &&
      account.lockedSeconds(now) === 0 &&
      (await hasher.verify(normalizePassword(proof.password), record.passwordHash))
    if (!record || !passwordOk) {
      if (record) {
        const { lockout } = await building.getSettings(record.buildingId)
        await autonomous.run(() => staffAccounts.recordFailureById(record.id, lockout, now))
      }
      throw new StepUpFailedError(await this.attemptsLeft(staff, action))
    }

    // 2. The code, bound to this person and this action.
    const consumed = await passwordTokens.consumeStepUp(
      record.id,
      action,
      factory.stepUpHmac(record.id, action, proof.code),
      now,
      config.stepUpMaxAttempts,
    )
    if (!consumed) {
      await autonomous.run(() =>
        passwordTokens.countStepUpFailure(record.id, action, config.stepUpMaxAttempts, now),
      )
      throw new StepUpFailedError(await this.attemptsLeft(staff, action))
    }

    // 3. Success: a notice to every active Admin of the building, the actor included, in this transaction.
    const admins = await staffAccounts.findByIds(await staffAccounts.activeAdminIds(staff.scope))
    for (const admin of admins)
      await mail.request(admin, 'step_up_notice', {
        params: { action, actorName: record.fullName },
      })
  }

  /** Read after the counting transaction committed: READ COMMITTED sees it from the action's own transaction. */
  private attemptsLeft(staff: StaffContext, action: StepUpAction): Promise<number> {
    const { passwordTokens, clock, config } = this.deps
    return passwordTokens.stepUpAttemptsLeft(
      staff.staffId,
      action,
      config.stepUpMaxAttempts,
      clock.now(),
    )
  }
}
