import { NotFoundError, requireRole, type UnitOfWork } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { DeletionApprovalDto, IdentityApi } from '@mod/identity/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import { OwnerMustTransferError } from '../../domain/errors'
import type { MembershipReader } from '../../domain/membership-reader'
import type { ResidentProfileRepository } from '../../domain/resident-profile-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const APPROVE_ACCOUNT_DELETION_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

/**
 * `POST /staff/residents/{accountId}/deletion/approve` (E-68, DOC-35 §10.1): the Manager approves a resident's request to delete
 * their account. Accounts are global, so the profile row ties the Manager to the person: an account with none in this building is
 * 404 (DR-136). The owner check runs before `IdentityApi` moves the account: an active owner of a unit is 409 `owner_must_transfer`
 * with the unit ids, and the transfer comes first (the job checks again). `identity` sets the date, audits it and answers the
 * existing dates when the account was approved already; `accountDeletionDays` comes from the building's settings.
 */
export class ApproveAccountDeletion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly profiles: ResidentProfileRepository,
    private readonly memberships: Pick<MembershipReader, 'ownedUnitIds'>,
    private readonly building: Pick<BuildingApi, 'getSettings'>,
    private readonly identity: Pick<IdentityApi, 'approveResidentDeletion'>,
  ) {}

  execute(staff: StaffContext, accountId: string): Promise<DeletionApprovalDto> {
    requireRole(staff, APPROVE_ACCOUNT_DELETION_ROLES)
    return this.uow.run(async () => {
      const profile = await this.profiles.find(staff.scope, accountId)
      if (!profile || profile.clearedAt !== null) throw new NotFoundError()
      const owned = await this.memberships.ownedUnitIds(accountId)
      if (owned.length > 0) throw new OwnerMustTransferError(owned)
      const { accountDeletionDays } = await this.building.getSettings(staff.scope.buildingId)
      return this.identity.approveResidentDeletion(staff, accountId, accountDeletionDays)
    })
  }
}
