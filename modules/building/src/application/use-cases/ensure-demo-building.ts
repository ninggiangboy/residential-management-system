import type { UnitOfWork } from '@core/kernel'
import type { DemoBuildingSeed } from '@rms/shared-types'
import type { DemoRepository } from '../../domain/demo-repository'

/**
 * Creates the row of the demo building (`is_demo = true`) when the deployment has none: `bun run seed:demo` and the deploy script
 * of a demo-bearing environment call it before the first reset, which needs the row to assert (DOC-36 §9.1). A system action, not a
 * staff one: no route reaches it. A row with the same id that is not a demo building throws; the seed never flags a real building.
 */
export class EnsureDemoBuilding {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly demo: DemoRepository,
  ) {}

  /** `true` when the row was created. */
  execute(seed: DemoBuildingSeed): Promise<boolean> {
    return this.uow.run(() => this.demo.ensureBuilding(seed))
  }
}
