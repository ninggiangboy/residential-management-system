import { type Clock, InvariantError, type Log, type UnitOfWork } from '@core/kernel'
import {
  buildingToday,
  type DemoCounts,
  type DemoPlan,
  type DemoResettable,
  type MetricsPort,
} from '@rms/shared-types'
import { DemoResetRefusedError, DemoResetRunningError } from '../domain/errors'
import type { BuildingDirectory } from './directory'
import type { DemoResetLock } from './ports'

/** What `apps/api` hands over: the plan of the seed and the password of the demo staff (`DEMO_STAFF_PASSWORD`, DOC-36 §11). */
export interface DemoSeedSource {
  plan: DemoPlan
  password: string | undefined
}

export interface DemoResetResult {
  durationMs: number
  deleted: DemoCounts
  created: DemoCounts
}

/** Reverse dependency order (DOC-36 §10.2): a module is deleted before the modules it reads. */
const DELETE_ORDER = [
  'reporting',
  'realtime',
  'notification',
  'notices',
  'access',
  'vehicles',
  'tickets',
  'wiki',
  'finance',
  'residency',
  'identity',
  'building',
] as const

/** Forward order: `building` first, the modules that read accounts and units after the ones that create them. */
const SEED_ORDER = [
  'building',
  'identity',
  'residency',
  'finance',
  'wiki',
  'tickets',
  'vehicles',
  'access',
  'notices',
  'notification',
] as const

function ordered(
  modules: readonly DemoResettable[],
  order: readonly string[],
): readonly DemoResettable[] {
  const rank = (module: string) => {
    const at = order.indexOf(module)
    if (at < 0)
      throw new InvariantError(`the module ${module} has no place in the demo reset order`)
    return at
  }
  return [...modules].sort((a, b) => rank(a.module) - rank(b.module))
}

/**
 * The demo reset of DOC-36 §10.2: every module's `resetDemo` in reverse dependency order, then every `seedDemo` forward, in one
 * transaction under `pg_try_advisory_xact_lock(hashtext('job:demo_reset'))`. A failure anywhere rolls the whole transaction back
 * and yesterday's demo stays (BD-39). Run by the nightly job and by `POST /staff/demo/reset`; neither writes more than this.
 * The modules are read when the reset runs: `building` is installed before the modules it resets.
 */
export class DemoReset {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly directory: BuildingDirectory,
    private readonly lock: DemoResetLock,
    private readonly modules: () => readonly DemoResettable[],
    private readonly source: DemoSeedSource,
    private readonly clock: Clock,
    private readonly logger: Log,
    private readonly metrics: MetricsPort,
  ) {}

  async run(buildingId: string): Promise<DemoResetResult> {
    await this.directory.assertDemo(buildingId)
    const { plan, password } = this.source
    // The plan is the seed of one building; any other demo building would be filled with the wrong content.
    if (plan.building.id !== buildingId) throw new DemoResetRefusedError()
    if (!password) throw new InvariantError('DEMO_STAFF_PASSWORD is required to seed the demo')
    const building = await this.directory.getBuilding(buildingId)
    if (!building) throw new DemoResetRefusedError()
    const today = buildingToday(this.clock.now(), building.timeZone)
    const started = performance.now()

    const result = await this.uow.run(async () => {
      if (!(await this.lock.acquire(buildingId))) throw new DemoResetRunningError()
      const deleted: DemoCounts = {}
      for (const module of ordered(this.modules(), DELETE_ORDER))
        Object.assign(deleted, await module.resetDemo(buildingId))
      const created: DemoCounts = {}
      for (const module of ordered(this.modules(), SEED_ORDER))
        Object.assign(created, await module.seedDemo(buildingId, { today, plan, password }))
      return { deleted, created }
    })
    this.directory.invalidate(buildingId)
    const durationMs = Math.round(performance.now() - started)
    this.metrics.observe('demo_reset_duration_seconds', durationMs / 1000)
    this.logger.info({ event: 'demo.reset', buildingId, durationMs, ...result }, 'demo.reset')
    return { durationMs, ...result }
  }
}
