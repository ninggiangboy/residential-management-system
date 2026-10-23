import type { Log } from '@core/kernel'
import type { BuildingApi } from '@mod/building/contracts'
import type { IdentityApi } from '@mod/identity/contracts'

/** Exit code of a process whose boot guard refused it; the same `EX_CONFIG` as an invalid configuration, so Docker does not loop (DOC-36 §10.1). */
export const EXIT_BOOT_GUARD_FAILED = 78

/** `ResidencyApi.buildingIdsOfAccounts` as the guard needs it: the buildings of the non-removed memberships of up to 500 accounts (DOC-09 §7.2). */
export interface AccountBuildings {
  buildingIdsOfAccounts(accountIds: readonly string[]): Promise<string[]>
}

export interface BootGuardDeps {
  identity: Pick<IdentityApi, 'listDemoAccountIds'>
  accountBuildings: AccountBuildings
  building: Pick<BuildingApi, 'isDemo'>
}

export interface BootCheckFailure {
  /** The number of the check in the table of DOC-36 §10.1. */
  check: number
  message: string
  /** What offends: ids of rows, never a value. */
  ids: string[]
}

const BATCH = 500

/**
 * The checks of the boot guard that read the database (DOC-36 §10.1), run in `api` and in `worker` after the migrations and before
 * listening, as `rms_app`. Only check 1 is here (P1-11): a flagged demo account (the one that takes the fixed code `123456` and
 * receives no SMS) with a membership in a building that is not a demo building would let anyone sign in to a real unit (DR-37,
 * DR-60). The others (2, 3, 5, 6) join with P1-21; check 4 is a rule of the configuration (DOC-41, `productionRules`).
 */
export async function runBootGuard({
  identity,
  accountBuildings,
  building,
}: BootGuardDeps): Promise<BootCheckFailure[]> {
  const failures: BootCheckFailure[] = []
  const flagged = await identity.listDemoAccountIds()
  const offending = new Set<string>()
  for (let at = 0; at < flagged.length; at += BATCH)
    for (const buildingId of await accountBuildings.buildingIdsOfAccounts(
      flagged.slice(at, at + BATCH),
    ))
      if (!(await building.isDemo(buildingId))) offending.add(buildingId)
  if (offending.size > 0)
    failures.push({
      check: 1,
      message: 'a flagged demo account has a membership in a building that is not a demo building',
      ids: [...offending],
    })
  return failures
}

/** Logs each failure as `boot_guard_failed` and says whether this environment refuses to start: `production` and `staging` do, the others warn (DOC-36 §10.1). */
export function reportBootGuard(
  failures: readonly BootCheckFailure[],
  appEnv: string,
  log: Pick<Log, 'error' | 'warn'>,
): boolean {
  const refuses = appEnv === 'production' || appEnv === 'staging'
  for (const failure of failures)
    (refuses ? log.error : log.warn)(
      { event: 'boot_guard_failed', check: failure.check, ids: failure.ids },
      `boot_guard_failed: ${failure.message}`,
    )
  return refuses && failures.length > 0
}
