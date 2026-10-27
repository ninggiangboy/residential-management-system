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
  building: Pick<
    BuildingApi,
    'isDemo' | 'listBuildings' | 'fakeGatewaysOutsideDemo' | 'gatewayKeyIds'
  >
  /** The key ids of the sealed CCCD numbers (`ResidencyApi.piiKeyIds`). */
  piiKeyIds: () => Promise<string[]>
  /**
   * The ids of the keys the process holds: `SETTINGS_ENCRYPTION_KEYS` and `PII_ENCRYPTION_KEYS`. `null` is a ring the process does
   * not hold (a `worker` never seals a CCCD number), so its check is skipped.
   */
  rings: { settings: readonly string[] | null; pii: readonly string[] | null }
  /** The ports bound to a stand-in that a module already installed should have replaced (check 5); the container computes it. */
  standIns: readonly string[]
}

export interface BootCheckFailure {
  /** The number of the check in the table of DOC-36 §10.1. */
  check: number
  message: string
  /** What offends: ids of rows, never a value. */
  ids: string[]
}

/**
 * Where a failed check stops the process (DOC-36 §10.1): `strict` in production and staging, `always` in every environment, `warn`
 * never. Check 4 is a rule of the configuration (DOC-41, `productionRules`) and has no row here.
 */
const POLICY: Record<number, 'strict' | 'always' | 'warn'> = {
  1: 'strict',
  2: 'strict',
  3: 'warn',
  5: 'strict',
  6: 'always',
}

const BATCH = 500

const missingFrom = (used: readonly string[], ring: readonly string[] | null) =>
  ring === null ? [] : used.filter((id) => !ring.includes(id)).sort()

/**
 * The checks of the boot guard that read the database (DOC-36 §10.1), run in `api` and in `worker` after the migrations and before
 * listening, as `rms_app`.
 *
 *  1. A flagged demo account (the one that takes the fixed code `123456` and receives no SMS) with a membership in a building that
 *     is not a demo building would let anyone sign in to a real unit (DR-37, DR-60).
 *  2. A `fake` gateway on a building that is not a demo building would accept a payment that never happened (DR-26).
 *  3. More than one building that is not a demo building: one deployment is one building (DR-115); a warning only.
 *  5. A port still bound to the stand-in of its module, though the module is installed (the active-intent probe of `finance`).
 *  6. A stored `secrets_enc` or `cccd_enc` that names a key the ring no longer holds could never be opened again.
 *
 * Check 4 is a rule of the configuration.
 */
export async function runBootGuard({
  identity,
  accountBuildings,
  building,
  piiKeyIds,
  rings,
  standIns,
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

  const fakes = await building.fakeGatewaysOutsideDemo()
  if (fakes.length > 0)
    failures.push({
      check: 2,
      message:
        'a gateway configuration with the fake driver belongs to a building that is not a demo building',
      ids: fakes,
    })

  const real = (await building.listBuildings()).filter((row) => !row.isDemo)
  if (real.length > 1)
    failures.push({
      check: 3,
      message: 'the deployment has more than one building that is not a demo building',
      ids: real.map((row) => row.buildingId),
    })

  if (standIns.length > 0)
    failures.push({
      check: 5,
      message: 'a port is still bound to a stand-in though its module is installed',
      ids: [...standIns],
    })

  const lost = [
    ...missingFrom(await building.gatewayKeyIds(), rings.settings).map((id) => `settings:${id}`),
    ...missingFrom(await piiKeyIds(), rings.pii).map((id) => `pii:${id}`),
  ]
  if (lost.length > 0)
    failures.push({
      check: 6,
      message: 'a stored secret names a key that the ring no longer holds',
      ids: lost,
    })
  return failures
}

/**
 * Logs each failure as `boot_guard_failed` and says whether this process refuses to start (DOC-36 §10.1): a `strict` check stops
 * `production` and `staging`, an `always` check stops every environment, and the others only warn.
 */
export function reportBootGuard(
  failures: readonly BootCheckFailure[],
  appEnv: string,
  log: Pick<Log, 'error' | 'warn'>,
): boolean {
  let refuses = false
  for (const failure of failures) {
    const policy = POLICY[failure.check] ?? 'strict'
    const stops =
      policy === 'always' ||
      (policy === 'strict' && (appEnv === 'production' || appEnv === 'staging'))
    refuses ||= stops
    ;(stops ? log.error : log.warn)(
      { event: 'boot_guard_failed', check: failure.check, ids: failure.ids },
      `boot_guard_failed: ${failure.message}`,
    )
  }
  return refuses
}
