import type { StaffContext, StaffRole } from '@rms/shared-types'
import type {
  DeletionRequestDto,
  IdentityApi,
  ResidentAccountDto,
  ResidentPhoneMatch,
  StaffDto,
  StepUpAction,
} from '../../contracts'
import type { ResidentQueries } from '../queries/resident-queries'
import type { StaffQueries } from '../queries/staff-queries'
import type { ChangeResidentPhone } from '../use-cases/change-resident-phone'
import type { EnsureResidentAccount } from '../use-cases/ensure-resident-account'
import type { QueueMemberInvitation } from '../use-cases/queue-member-invitation'
import type { VerifyStepUp } from '../use-cases/verify-step-up'

/** The contract of DOC-09 §7.3: reads go to the query service, the proof to its use case. No rule of its own (DR-254). */
export class IdentityApiImpl implements IdentityApi {
  constructor(
    private readonly queries: StaffQueries,
    private readonly residentQueries: ResidentQueries,
    private readonly verifyStepUpCase: VerifyStepUp,
    private readonly findOrCreate: EnsureResidentAccount,
    private readonly changePhone: ChangeResidentPhone,
    private readonly queueInvitation: QueueMemberInvitation,
  ) {}

  getStaff(ids: string[]): Promise<StaffDto[]> {
    return this.queries.getStaff(ids)
  }

  listActiveStaff(
    buildingId: string,
    roles: StaffRole[],
    page?: { after?: string; limit?: number },
  ): Promise<{ items: StaffDto[]; next: string | null }> {
    return this.queries.listActive(buildingId, roles, page)
  }

  listDemoAccountIds(): Promise<string[]> {
    return this.residentQueries.listDemoAccountIds()
  }

  getResidentAccounts(ids: string[]): Promise<ResidentAccountDto[]> {
    return this.residentQueries.getResidentAccounts(ids)
  }

  findResidentAccountsByPhones(phones: string[]): Promise<ResidentPhoneMatch[]> {
    return this.residentQueries.findByPhones(phones)
  }

  findOrCreateResidentAccount(
    phone: string,
    displayName: string,
  ): Promise<{ accountId: string; created: boolean }> {
    return this.findOrCreate.execute(phone, displayName)
  }

  changeResidentPhone(accountId: string, newPhone: string): Promise<void> {
    return this.changePhone.execute(accountId, newPhone)
  }

  findResidentAccountsByPhoneFragment(
    fragment: string,
    limit: number,
  ): Promise<ResidentAccountDto[]> {
    return this.residentQueries.findByPhoneFragment(fragment, limit)
  }

  queueMemberInvitation(accountId: string, params: { unitCode: string }): Promise<void> {
    return this.queueInvitation.execute(accountId, params)
  }

  listDeletionRequests(page?: {
    after?: string
    limit?: number
  }): Promise<{ items: DeletionRequestDto[]; next: string | null }> {
    return this.residentQueries.listDeletionRequests(page)
  }

  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void> {
    return this.verifyStepUpCase.execute(staff, action, proof)
  }
}
