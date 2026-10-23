import type { Clock } from '@core/kernel'
import { decide, requireRole } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StepUpAction } from '../../contracts'
import { StepUpFailedError } from '../../domain/errors'
import { normalizePassword } from '../../domain/password-policy'
import { PasswordToken } from '../../domain/password-token'
import type { PasswordTokenRepository } from '../../domain/password-token-repository'
import { StaffAccount } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { IdentityConfig } from '../config'
import type { FailureCounter } from '../failure-counter'
import type { MailCommands } from '../mail-commands'
import type { AutonomousTransaction, PasswordHasher, TokenFactory } from '../ports'

/** Every step-up action is the Admin's (DOC-26 §4.5). */
const VERIFY_STEP_UP_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * `IdentityApi.verifyStepUp` (DOC-26 §4.5), in the transaction of the action that asked: checks the password, consumes the live
 * code, and queues a notice to every active Admin so the notices exist only if the change commits. A wrong password counts toward
 * the sign-in lockout; a wrong code counts toward the code's five tries. Both counters are written in their own transaction,
 * because the action's rollback would otherwise erase them and a stolen session could guess for ever (DR-132).
 */
export class VerifyStepUp {
  constructor(
    private readonly staffAccounts: StaffAccountRepository,
    private readonly failures: FailureCounter,
    private readonly passwordTokens: PasswordTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly factory: TokenFactory,
    private readonly mail: MailCommands,
    private readonly building: Pick<BuildingApi, 'getSettings'>,
    private readonly autonomous: AutonomousTransaction,
    private readonly clock: Clock,
    private readonly config: IdentityConfig,
  ) {}

  async execute(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void> {
    requireRole(staff, VERIFY_STEP_UP_ROLES)
    const {
      staffAccounts,
      failures,
      passwordTokens,
      hasher,
      factory,
      mail,
      building,
      autonomous,
      clock,
      config,
    } = this
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
        await autonomous.run(() => failures.count(record.id, lockout, now))
      }
      throw new StepUpFailedError(await this.attemptsLeft(staff, action))
    }

    // 2. The code, bound to this person and this action, is spent by one guarded statement.
    const code = await passwordTokens.findStepUp(record.id, action)
    const spend = code
      ? new PasswordToken(code).verifyStepUp(
          factory.stepUpHmac(record.id, action, proof.code),
          now,
          config.stepUpMaxAttempts,
        )
      : null
    if (!spend || !(await passwordTokens.apply(spend))) {
      await autonomous.run(() => this.countFailure(record.id, action, now))
      throw new StepUpFailedError(await this.attemptsLeft(staff, action))
    }

    // 3. Success: a notice to every active Admin of the building, the actor included, in this transaction.
    const admins = await staffAccounts.findByIds(await staffAccounts.activeAdminIds(staff.scope))
    for (const admin of admins)
      await mail.request(admin, 'step_up_notice', {
        params: { action, actorName: record.fullName },
      })
  }

  /** Every wrong code is counted, so a lost race decides again on the count the winner left (DR-255). */
  private countFailure(staffId: string, action: StepUpAction, now: Date): Promise<void> {
    const { passwordTokens, config } = this
    return decide(async () => {
      const code = await passwordTokens.findStepUp(staffId, action)
      const count = code
        ? new PasswordToken(code).countFailure(now, config.stepUpMaxAttempts)
        : null
      if (!count) return { done: true, value: undefined }
      return (await passwordTokens.apply(count))
        ? { done: true, value: undefined }
        : { done: false }
    })
  }

  /** Read after the counting transaction committed: READ COMMITTED sees it from the action's own transaction. */
  private async attemptsLeft(staff: StaffContext, action: StepUpAction): Promise<number> {
    const { passwordTokens, clock, config } = this
    const code = await passwordTokens.findStepUp(staff.staffId, action)
    return code ? new PasswordToken(code).attemptsLeft(clock.now(), config.stepUpMaxAttempts) : 0
  }
}
