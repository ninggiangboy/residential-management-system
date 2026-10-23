import {
  type Clock,
  ForbiddenError,
  type IdGenerator,
  requireRole,
  type UnitOfWork,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi } from '@mod/building/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { Language } from '../../contracts'
import { EmailInUseError } from '../../domain/errors'
import { mayManageRole } from '../../domain/staff-account'
import type { StaffAccountRepository } from '../../domain/staff-account-repository'
import type { InviteIssuer } from '../invite-issuer'
import { type StaffAccountView, toStaffAccountView } from '../staff-account-view'
import { requireProof, type StepUpProof } from '../staff-safeguards'
import { isUniqueViolation } from '../unique-violation'
import type { VerifyStepUp } from './verify-step-up'

/** The Admin creates any role, the Manager a Technician or a Guard (DR-133). The route reads this list for its `audience`. */
export const CREATE_STAFF_ACCOUNT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

export interface CreateStaffAccountInput {
  fullName: string
  email: string
  role: StaffRole
  /** The building's `defaultLanguage` when absent. */
  language?: Language
  /** Required when `role` is `admin` (action `admin_change`). */
  stepUp?: StepUpProof
}

export interface CreatedStaffAccount {
  account: StaffAccountView
  /** When the invite link stops working. */
  inviteExpiresAt: string
  stepUp: boolean
}

/**
 * `POST /staff/accounts` (E-40, DOC-26 §4.4): a staff account in the status `invited` and the mail with its set-password link. A
 * Manager creating an Admin or a Manager is 403 before any step-up is asked (FR-14.1); an Admin needs a proof for another Admin
 * (FR-14.5), and a missing proof is answered before any statement. The change, the mail command, the notices of the step-up and the
 * audit row commit together.
 */
export class CreateStaffAccount {
  private readonly auditedCreate: ReturnType<CreateStaffAccount['buildAuditedCreate']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly staffAccounts: StaffAccountRepository,
    private readonly inviteIssuer: InviteIssuer,
    private readonly verifyStepUp: VerifyStepUp,
    private readonly building: Pick<BuildingApi, 'getSettings'>,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    audited: Audited,
  ) {
    this.auditedCreate = this.buildAuditedCreate(audited)
  }

  async execute(staff: StaffContext, input: CreateStaffAccountInput): Promise<CreatedStaffAccount> {
    requireRole(staff, CREATE_STAFF_ACCOUNT_ROLES)
    if (!mayManageRole(staff, input.role)) throw new ForbiddenError()
    if (input.role === 'admin') requireProof(input.stepUp, 'admin_change')
    return this.uow.run(() => this.auditedCreate(staff, input))
  }

  private buildAuditedCreate(audited: Audited) {
    return audited(
      {
        action: 'identity.staff.create',
        object: (created: CreatedStaffAccount) => ({
          type: 'staff_account',
          id: created.account.id,
        }),
        masks: { email: 'email', fullName: 'personal' },
        details: (created) => (created.stepUp ? { stepUp: true } : undefined),
      },
      async (staff: StaffContext, input: CreateStaffAccountInput) => {
        const { staffAccounts, inviteIssuer, building, ids, clock } = this
        if (input.role === 'admin' && input.stepUp)
          await this.verifyStepUp.execute(staff, 'admin_change', input.stepUp)
        const language =
          input.language ?? (await building.getSettings(staff.buildingId)).defaultLanguage
        const record = await staffAccounts
          .insert(
            staff.scope,
            {
              id: ids.next(),
              buildingId: staff.buildingId,
              email: input.email.trim(),
              fullName: input.fullName.trim(),
              role: input.role,
              language,
            },
            clock.now(),
          )
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) throw new EmailInUseError()
            throw error
          })
        const expiresAt = await inviteIssuer.issue(record)
        return {
          result: {
            account: toStaffAccountView(record),
            inviteExpiresAt: expiresAt.toISOString(),
            stepUp: input.role === 'admin',
          },
          changes: [
            { field: 'role', before: null, after: record.role },
            { field: 'status', before: null, after: record.status },
            { field: 'email', before: null, after: record.email },
            { field: 'fullName', before: null, after: record.fullName },
          ],
        }
      },
    )
  }
}
