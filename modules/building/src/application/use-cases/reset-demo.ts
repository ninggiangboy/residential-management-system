import { requireRole, type UnitOfWork } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { DemoReset, DemoResetResult } from '../demo-reset'
import type { BuildingDirectory } from '../directory'
import type { DemoResetLimiter } from '../ports'

type ResetResult = DemoResetResult & { buildingId: string }

/** The Admin's alone (E-56). The route reads this list for its `audience` (DOC-12 §5.3). */
export const RESET_DEMO_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * The Admin of the demo building puts it back to its seed before a presentation (DOC-36 §10.4, E-56). For a building that is not a
 * demo building the answer is 404, before the rate limit and before anything is read, so the endpoint reveals nothing about
 * another building. The reset is one transaction with the audit row `building.demo.reset`; the nightly job writes none (DOC-35 §3.6).
 */
export class ResetDemo {
  private readonly auditedReset: ReturnType<ResetDemo['buildAuditedReset']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly directory: BuildingDirectory,
    private readonly demoReset: DemoReset,
    private readonly limiter: DemoResetLimiter,
    private readonly audited: Audited,
  ) {
    this.auditedReset = this.buildAuditedReset()
  }

  async execute(staff: StaffContext): Promise<DemoResetResult> {
    requireRole(staff, RESET_DEMO_ROLES)
    await this.directory.assertDemo(staff.buildingId)
    await this.limiter.take(staff.buildingId)
    const { buildingId: _id, ...result } = await this.uow.run(() => this.auditedReset(staff))
    return result
  }

  private buildAuditedReset() {
    const { audited, demoReset } = this
    return audited(
      {
        action: 'building.demo.reset',
        object: (result: ResetResult) => ({ type: 'building', id: result.buildingId }),
        details: (result: ResetResult) => ({
          durationMs: result.durationMs,
          units: result.created['residency.unit'] ?? 0,
        }),
      },
      async (staff: StaffContext) => ({
        result: { buildingId: staff.buildingId, ...(await demoReset.run(staff.buildingId)) },
        changes: [],
      }),
    )
  }
}
