import { NotFoundError, requireRole, type UnitOfWork, ValidationError } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { PhoneParser } from '../../domain/import/row-rules'
import type { ResidentProfileRepository } from '../../domain/resident-profile-repository'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const CHANGE_LOGIN_PHONE_ROLES = ['admin', 'manager'] as const satisfies readonly StaffRole[]

/**
 * `PATCH /staff/residents/{accountId}/phone` (E-67, DOC-27 §8): the Manager changes a resident's login phone. Accounts are global,
 * so the profile row is what ties the Manager to the person: an account with none in this building is 404 (DR-136). The number is
 * parsed with the `max` metadata, region VN; the number the account already has is 204 and writes nothing. `IdentityApi` changes the
 * phone and revokes every session in the same transaction (`phone_in_use` is 409 and nothing changes). Memberships and QR codes do
 * not change, and the unit history has no row.
 */
export class ChangeLoginPhone {
  private readonly auditedChange: ReturnType<ChangeLoginPhone['buildAudited']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly profiles: ResidentProfileRepository,
    private readonly phones: PhoneParser,
    private readonly identity: Pick<IdentityApi, 'getResidentAccounts' | 'changeResidentPhone'>,
    audited: Audited,
  ) {
    this.auditedChange = this.buildAudited(audited)
  }

  async execute(staff: StaffContext, accountId: string, phone: string): Promise<void> {
    requireRole(staff, CHANGE_LOGIN_PHONE_ROLES)
    const parsed = this.phones.parse(phone)
    if (!parsed)
      throw new ValidationError([
        { path: 'phone', code: 'phone_invalid', message: 'not a phone number' },
      ])
    await this.uow.run(async () => {
      const profile = await this.profiles.find(staff.scope, accountId)
      if (!profile || profile.clearedAt !== null) throw new NotFoundError()
      const [account] = await this.identity.getResidentAccounts([accountId])
      if (!account || account.status === 'deleted') throw new NotFoundError()
      if (account.phone === parsed.e164) return
      await this.auditedChange(staff, accountId, account.phone, parsed.e164)
    })
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.login_phone.change',
        object: (accountId: string) => ({ type: 'resident_account', id: accountId }),
        masks: { phone: 'phone' },
      },
      async (_staff: StaffContext, accountId: string, before: string, after: string) => {
        await this.identity.changeResidentPhone(accountId, after)
        return { result: accountId, changes: [{ field: 'phone', before, after }] }
      },
    )
  }
}
