import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { IdentityApi, ResidentAccountDto, StaffDto, StepUpAction } from '../../contracts'
import type { ResidentQueries } from '../queries/resident-queries'
import type { StaffQueries } from '../queries/staff-queries'
import type { VerifyStepUp } from '../use-cases/verify-step-up'

/** The contract of DOC-09 §7.3: reads go to the query service, the proof to its use case. No rule of its own (DR-254). */
export class IdentityApiImpl implements IdentityApi {
  constructor(
    private readonly queries: StaffQueries,
    private readonly residentQueries: ResidentQueries,
    private readonly verifyStepUpCase: VerifyStepUp,
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

  verifyStepUp(
    staff: StaffContext,
    action: StepUpAction,
    proof: { password: string; code: string },
  ): Promise<void> {
    return this.verifyStepUpCase.execute(staff, action, proof)
  }
}
