import {
  type Clock,
  ForbiddenError,
  NotFoundError,
  PreconditionRequiredError,
  requireRole,
  type UnitOfWork,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { AuditChange, Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { StepUpAction } from '../../contracts'
import { EmailInUseError } from '../../domain/errors'
import { StaffAccount, type StaffAccountRecord, type StaffEdit } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import {
  checkedReassignReason,
  requireProof,
  type StaffSafeguards,
  type StepUpProof,
} from '../staff-safeguards'
import type { StaffSessions } from '../staff-sessions'
import { isUniqueViolation } from '../unique-violation'
import type { VerifyStepUp } from './verify-step-up'

/** The Admin edits anyone; the Manager only name and language of a Technician or Guard (DR-133). Read by the route's `audience`. */
export const UPDATE_STAFF_ACCOUNT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

export interface UpdateStaffAccountInput {
  changes: StaffEdit
  /** `If-Match`; absent is 428. */
  version: number | undefined
  /** With a role change: an active Technician or Guard who takes the open tickets (Admin only, DR-147). */
  reassignTo?: string
  reason?: string
  /** `admin_change` when the new role is `admin`, `staff_email` when the email changes. */
  stepUp?: StepUpProof
}

export interface UpdatedStaffAccount {
  account: StaffAccountView
  details: { stepUp?: true; reassignedTo?: string }
}

/** The step-up the request needs, decided from the body alone so a missing proof costs no statement (FR-50.2). */
function stepUpActionOf(changes: StaffEdit): StepUpAction | null {
  if (changes.role === 'admin') return 'admin_change'
  return changes.email !== undefined ? 'staff_email' : null
}

/**
 * `PATCH /staff/accounts/{id}` (E-42, DOC-26 §4.4): name, language, role and email. The role and the email are the Admin's; a role
 * change ends every session (`role_changed`), is refused for the last active Admin and for a person with open tickets unless an
 * Admin reassigns them; an email change ends none (DR-133). The version the form read is the guard (428, 409).
 */
export class UpdateStaffAccount {
  private readonly auditedUpdate: ReturnType<UpdateStaffAccount['buildAuditedUpdate']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly safeguards: StaffSafeguards,
    private readonly staffSessions: StaffSessions,
    private readonly verifyStepUp: VerifyStepUp,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedUpdate = this.buildAuditedUpdate(audited)
  }

  async execute(
    staff: StaffContext,
    staffId: string,
    input: UpdateStaffAccountInput,
  ): Promise<StaffAccountView> {
    requireRole(staff, UPDATE_STAFF_ACCOUNT_ROLES)
    const { changes } = input
    // A Manager's request for an Admin-only field is refused before a proof is asked for or a row is read.
    if ((changes.role !== undefined || changes.email !== undefined) && staff.role !== 'admin')
      throw new ForbiddenError()
    if (input.version === undefined) throw new PreconditionRequiredError()
    const action = stepUpActionOf(changes)
    if (changes.role === 'admin' && changes.email !== undefined)
      throw new ValidationError([
        {
          path: 'email',
          code: 'one_step_up_action',
          message: 'A promotion to Admin and an email change need separate proofs',
        },
      ])
    if (action) requireProof(input.stepUp, action)
    if (input.reassignTo !== undefined && changes.role === undefined)
      throw new ValidationError([
        {
          path: 'reassignTo',
          code: 'requires_role',
          message: 'reassignTo goes with a role change',
        },
      ])
    const reason = input.reassignTo === undefined ? undefined : checkedReassignReason(input.reason)
    const updated = await this.uow.run(() =>
      this.auditedUpdate(staff, staffId, { ...input, reason }, input.version as number),
    )
    return updated.account
  }

  private buildAuditedUpdate(audited: Audited) {
    return audited(
      {
        action: 'identity.staff.update',
        object: (updated: UpdatedStaffAccount) => ({
          type: 'staff_account',
          id: updated.account.id,
        }),
        reason: (_staff, _id, input: UpdateStaffAccountInput) => input.reason,
        masks: { email: 'email', fullName: 'personal' },
        details: (updated) =>
          Object.keys(updated.details).length === 0 ? undefined : { ...updated.details },
      },
      async (
        staff: StaffContext,
        staffId: string,
        input: UpdateStaffAccountInput,
        version: number,
      ) => this.update(staff, staffId, input, version),
    )
  }

  private async update(
    staff: StaffContext,
    staffId: string,
    input: UpdateStaffAccountInput,
    version: number,
  ) {
    const { staffAccounts, safeguards, staffSessions, clock } = this
    const before = await staffAccounts.findScoped(staff.scope, staffId)
    if (!before) throw new NotFoundError()
    const account = new StaffAccount(before)
    const transition = account.edit(staff, input.changes)
    if (before.version !== version) throw new VersionConflictError()
    if (!transition)
      return { result: { account: toStaffAccountView(before), details: {} }, changes: [] }

    const details: UpdatedStaffAccount['details'] = {}
    const roleChanged = transition.set.role !== undefined
    if (roleChanged) {
      // Leaving the Admin role is the one change here that can empty the building of Admins.
      if (before.role === 'admin') await safeguards.keepsAnAdmin(staff.scope, account)
      const reassign = input.reassignTo
        ? { to: input.reassignTo, reason: input.reason ?? '' }
        : undefined
      const to = await safeguards.clearTickets(staff.scope, staff, account, reassign)
      if (to) details.reassignedTo = to
    }
    const action = stepUpActionOf(input.changes)
    if (action && input.stepUp) {
      await this.verifyStepUp.execute(staff, action, input.stepUp)
      details.stepUp = true
    }

    const now = clock.now()
    // The version in the guard is the one read above: a second edit with the same `If-Match` changes no row (409).
    const applied = await staffAccounts.apply(transition, now).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new EmailInUseError()
      throw error
    })
    if (!applied) throw new VersionConflictError()
    if (roleChanged) await staffSessions.revokeAll(staffId, 'role_changed', now)

    const after = { ...before, ...transition.set }
    const changes = changedFields(before, after)
    return { result: { account: toStaffAccountView(after), details }, changes }
  }
}

const FIELDS = ['role', 'email', 'fullName', 'language'] as const

/** The fields the edit changed; the wrapper masks the personal ones (DOC-35 §3.4). */
function changedFields(before: StaffAccountRecord, after: StaffAccountRecord): AuditChange[] {
  return FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    before: before[field],
    after: after[field],
  }))
}
