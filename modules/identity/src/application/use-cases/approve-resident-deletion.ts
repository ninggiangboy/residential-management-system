import { type Clock, NotFoundError, requireRole } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { DeletionApprovalDto } from '../../contracts'
import { DeletionAlreadyApprovedError, DeletionNotRequestedError } from '../../domain/errors'
import type { DeletionState } from '../../domain/resident-account'
import type { ResidentAccountRepository } from '../../domain/resident-account-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const APPROVE_RESIDENT_DELETION_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

const DAY_MS = 86_400_000

/**
 * `IdentityApi.approveResidentDeletion` (E-68, DOC-35 §10.1): one guarded `UPDATE` sets `deletion_approved_at` while the account is
 * `deletion_requested` and not yet approved, and the approval is audited in the caller's transaction. It joins that transaction and
 * opens none; `residency` has checked the Manager's building and the ownership first. A cancel or a second approval that wins the
 * race is decided by the row: zero rows reads the state again, and answers 409 or the existing dates. The execution date is the
 * approval plus `cooloffDays` as an interval of days (the job reads the setting again when it runs).
 */
export class ApproveResidentDeletion {
  private readonly auditedApproval: ReturnType<ApproveResidentDeletion['buildAudited']>

  constructor(
    private readonly residents: ResidentAccountRepository,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedApproval = this.buildAudited(audited)
  }

  async execute(
    staff: StaffContext,
    accountId: string,
    cooloffDays: number,
  ): Promise<DeletionApprovalDto> {
    requireRole(staff, APPROVE_RESIDENT_DELETION_ROLES)
    const state = await this.state(accountId)
    if (state.approvedAt !== null) return this.view(accountId, state, cooloffDays)
    try {
      return await this.auditedApproval(staff, accountId, state, cooloffDays)
    } catch (error) {
      if (!(error instanceof DeletionAlreadyApprovedError)) throw error
      return this.view(accountId, await this.state(accountId), cooloffDays)
    }
  }

  /** The state of an account that has a request; the other cases are the 404 and the 409 of the endpoint. */
  private async state(accountId: string): Promise<DeletionState & { requestedAt: Date }> {
    const state = await this.residents.findDeletionState(accountId)
    if (!state || state.status === 'deleted') throw new NotFoundError()
    if (state.status !== 'deletion_requested' || state.requestedAt === null)
      throw new DeletionNotRequestedError()
    return { ...state, requestedAt: state.requestedAt }
  }

  private view(
    accountId: string,
    state: DeletionState & { requestedAt: Date },
    cooloffDays: number,
  ): DeletionApprovalDto {
    const approvedAt = state.approvedAt as Date
    return {
      accountId,
      deletionRequestedAt: state.requestedAt.toISOString(),
      deletionApprovedAt: approvedAt.toISOString(),
      executeAfter: new Date(approvedAt.getTime() + cooloffDays * DAY_MS).toISOString(),
    }
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'identity.account.deletion_approve',
        object: (view: DeletionApprovalDto) => ({
          type: 'resident_account',
          id: view.accountId,
        }),
      },
      async (
        _staff: StaffContext,
        accountId: string,
        state: DeletionState & { requestedAt: Date },
        cooloffDays: number,
      ) => {
        const approvedAt = await this.residents.approveDeletion(accountId, this.clock.now())
        if (approvedAt === null) throw new DeletionAlreadyApprovedError()
        const view = this.view(accountId, { ...state, approvedAt }, cooloffDays)
        return {
          result: view,
          changes: [{ field: 'deletionApprovedAt', before: null, after: view.deletionApprovedAt }],
        }
      },
    )
  }
}
