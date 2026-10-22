import type { Clock, IdGenerator } from '@core/kernel'
import {
  ForbiddenError,
  PreconditionRequiredError,
  RuleViolationError,
  type SecretBox,
  type UnitOfWork,
  type ValidationDetail,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingId, StaffContext } from '@rms/shared-types'
import type {
  ActiveIntentProbe,
  GatewayConfigDto,
  GatewayDriver,
  GatewayProvider,
  ReceivingAccount,
  StepUpVerifier,
} from '../contracts'
import { GatewayInUseError } from '../domain/errors'
import type { BuildingDirectory } from './directory'
import type { GatewayConfigRecord, GatewayConfigRepository } from './ports'
import { TtlCache } from './ttl-cache'

/**
 * The fields each driver needs (DOC-36 §7). payOS is DOC-36's own example; the VietQR names are provisional until DOC-24 meets
 * the gateway sandbox (DR-25) and change only this table, not the schema (a new driver adds no column, DR-33).
 */
const GATEWAY_DRIVERS: Readonly<Record<GatewayDriver, { fields: readonly string[] }>> = {
  payos: { fields: ['clientId', 'apiKey', 'checksumKey'] },
  vietqr: { fields: ['clientId', 'apiKey'] },
  fake: { fields: [] },
}

const MASKED_DOTS = '••••'

/** `••••` plus the last 4 characters; a secret shorter than 8 characters shows `••••` only, so it is not revealed (BD-18). */
export const maskSecret = (value: string): string =>
  value.length < 8 ? MASKED_DOTS : `${MASKED_DOTS}${value.slice(-4)}`

/** `0011001234567` → `0011…4567`: enough to recognise the account in the log, not enough to use it (DOC-35 §3.4). */
export const maskAccountNumber = (value: string): string =>
  value.length >= 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : `…${value.slice(-4)}`

export interface GatewayView {
  id: string
  provider: GatewayProvider
  driver: GatewayDriver
  status: 'active' | 'disabled'
  receivingAccount: ReceivingAccount
  secrets: Record<string, string>
  lastCheckAt: string | null
  lastCheckOk: boolean | null
  version: number
}

export interface SaveGatewayInput {
  provider: GatewayProvider
  driver: GatewayDriver
  status: 'active' | 'disabled'
  receivingAccount: ReceivingAccount
  /** A field present replaces the stored one; an absent field keeps it. A new configuration, or a new driver, needs them all. */
  secrets?: Record<string, string>
  stepUp?: { password: string; code: string }
  /** `If-Match`: the version of the row the form read; required once the row exists. */
  version?: number
}

export interface GatewayDeps {
  uow: UnitOfWork
  gateways: GatewayConfigRepository
  directory: BuildingDirectory
  secretBox: SecretBox
  stepUp: StepUpVerifier
  /** `finance` answers it from `integrations/building`; without it a gateway could change under live intents. */
  probe: ActiveIntentProbe
  audited: Audited
  clock: Clock
  ids: IdGenerator
  cacheSeconds: number
}

const aadOf = (id: string) => `gateway_config|${id}`

const BANK_BIN = /^[0-9]{6}$/
const ACCOUNT_NUMBER = /^[0-9]{6,20}$/
const ACCOUNT_NAME = /^[A-Z0-9 ]{1,50}$/

function assertAccount(account: ReceivingAccount): void {
  const problems: ValidationDetail[] = []
  if (!BANK_BIN.test(account.bankBin))
    problems.push({ path: 'receivingAccount.bankBin', code: 'pattern', message: 'six digits' })
  if (!ACCOUNT_NUMBER.test(account.accountNumber))
    problems.push({
      path: 'receivingAccount.accountNumber',
      code: 'pattern',
      message: '6 to 20 digits',
    })
  if (!ACCOUNT_NAME.test(account.accountName))
    problems.push({
      path: 'receivingAccount.accountName',
      code: 'pattern',
      message: '1 to 50 upper-case letters, digits and spaces',
    })
  if (problems.length > 0) throw new ValidationError(problems)
}

/**
 * The payment-gateway configuration of a building (DOC-36 §3, §7, DR-33): reads for `finance` and the webhook route, and the
 * Admin's save with its step-up. A secret is encrypted with the newest key and a place-bound AAD, shown masked, and never in a
 * log or an audit row.
 */
export class GatewayService {
  private readonly cache: TtlCache<GatewayConfigDto | null>
  private readonly auditedSave: ReturnType<GatewayService['buildAuditedSave']>

  constructor(private readonly deps: GatewayDeps) {
    this.cache = new TtlCache(deps.clock, deps.cacheSeconds * 1000)
    this.auditedSave = this.buildAuditedSave()
  }

  // --- reads -------------------------------------------------------------------------------------------------------

  async getConfig(
    buildingId: string,
    provider: GatewayProvider,
    opts: { lock?: 'share' } = {},
  ): Promise<GatewayConfigDto | null> {
    const scope = { buildingId: buildingId as BuildingId }
    const load = async () => {
      const row = await this.deps.gateways.findActive(scope, provider, opts.lock)
      return row ? this.decrypt(row) : null
    }
    // `lock: 'share'` skips the cache and holds the row lock inside the caller's transaction: either the intent holds the lock
    // first and the change of the receiving account waits for it, or the change commits first and the intent reads the new row.
    return opts.lock === 'share' ? load() : this.cache.get(`${buildingId}:${provider}`, load)
  }

  /** `GET /staff/gateway`: the active configurations with masked secrets and the drivers this building may use. */
  async view(staff: StaffContext) {
    assertAdmin(staff)
    const isDemo = await this.deps.directory.isDemo(staff.buildingId)
    const configs: GatewayView[] = []
    for (const provider of ['payos', 'vietqr'] as const) {
      const row = await this.deps.gateways.findActive(staff.scope, provider)
      if (row) configs.push(await this.toView(row))
    }
    const drivers = Object.fromEntries(
      (Object.keys(GATEWAY_DRIVERS) as GatewayDriver[]).map((driver) => [
        driver,
        { fields: GATEWAY_DRIVERS[driver].fields, allowed: driver !== 'fake' || isDemo },
      ]),
    ) as Record<GatewayDriver, { fields: readonly string[]; allowed: boolean }>
    return { configs, drivers }
  }

  // --- the Admin's save ----------------------------------------------------------------------------------------------

  async save(
    staff: StaffContext,
    input: SaveGatewayInput,
  ): Promise<{ created: boolean; config: GatewayView }> {
    assertAdmin(staff)
    assertAccount(input.receivingAccount)
    const result = await this.deps.uow.run(() => this.auditedSave(staff, input))
    this.cache.invalidate(`${staff.buildingId}:${input.provider}`)
    return result
  }

  private buildAuditedSave() {
    const { audited } = this.deps
    return audited(
      {
        action: 'building.gateway.update',
        object: (r: { created: boolean; config: GatewayView }) => ({
          type: 'gateway_config',
          id: r.config.id,
        }),
        details: () => ({ stepUp: true }),
      },
      async (staff: StaffContext, input: SaveGatewayInput) => {
        const { gateways, directory, stepUp } = this.deps
        // A save asks for a second proof, even one that only re-saves; the verifier counts a wrong password toward the lockout.
        if (!input.stepUp)
          throw new ForbiddenError('step_up_required', 'A step-up proof is required')
        await stepUp.verifyStepUp(staff, 'gateway_config', input.stepUp)

        const wanted = GATEWAY_DRIVERS[input.driver]
        const unknown = Object.keys(input.secrets ?? {}).filter(
          (key) => !wanted.fields.includes(key),
        )
        if (unknown.length > 0)
          throw new ValidationError(
            unknown.map((key) => ({
              path: `secrets.${key}`,
              code: 'unknown_key',
              message: 'not a field of the driver',
            })),
          )
        // `fake` pretends to be a provider and belongs to a demo building only (DR-26).
        if (input.driver === 'fake' && !(await directory.isDemo(staff.buildingId)))
          throw new RuleViolationError(
            'driver_not_allowed',
            'The fake driver is for the demo building',
            'driver',
          )

        const existing = await gateways.findActive(staff.scope, input.provider)
        if (!existing) return this.create(staff, input, wanted.fields)

        return this.update(staff, input, existing, wanted.fields)
      },
    )
  }

  /** The save of a row that exists: the version the form read, the lock, the intent probe, the merge of the secrets (DOC-36 §7.3). */
  private async update(
    staff: StaffContext,
    input: SaveGatewayInput,
    existing: GatewayConfigRecord,
    fields: readonly string[],
  ) {
    const { gateways, secretBox, probe } = this.deps
    const wanted = { fields }
    if (input.version === undefined) throw new PreconditionRequiredError()
    const locked = await gateways.lockForUpdate(staff.scope, existing.id, input.version)
    if (!locked) throw new VersionConflictError()

    const changesTarget =
      input.driver !== locked.driver ||
      input.status !== locked.status ||
      !sameAccount(input.receivingAccount, locked.receivingAccount)
    // A secrets-only change does not ask: the checksum key of an intent already created is looked up when its webhook arrives.
    if (changesTarget && (await probe.hasActive(staff.buildingId, input.provider)))
      throw new GatewayInUseError()

    const stored = JSON.parse(await secretBox.open(aadOf(locked.id), locked.secretsEnc)) as Record<
      string,
      string
    >
    const driverChanged = input.driver !== locked.driver
    const merged = driverChanged ? { ...input.secrets } : { ...stored, ...input.secrets }
    const missing = wanted.fields.filter((field) => !merged[field])
    if (missing.length > 0)
      throw new ValidationError(
        missing.map((field) => ({
          path: `secrets.${field}`,
          code: 'required',
          message: 'required by the driver',
        })),
      )
    const blob = await secretBox.seal(aadOf(locked.id), JSON.stringify(merged))
    const version = await gateways
      .updateGuarded(staff.scope, locked.id, locked.version, {
        secretsEnc: blob,
        receivingAccount: input.receivingAccount,
        driver: input.driver,
        status: input.status,
      })
      .catch((error: unknown) => {
        // Re-enabling while another row of the provider is active: the unique index decides the race (DOC-17 §1.3).
        if (isUnique(error)) throw new VersionConflictError()
        throw error
      })
    if (version === null) throw new VersionConflictError()

    const changes = [
      // The row says the secrets changed, never what they were; a re-save of the same values changes nothing.
      ...(driverChanged ||
      Object.entries(input.secrets ?? {}).some(([key, value]) => stored[key] !== value)
        ? [{ field: 'secrets', before: '[masked]', after: '[masked]' }]
        : []),
      ...diffAccount(locked.receivingAccount, input.receivingAccount),
      ...(input.driver !== locked.driver
        ? [{ field: 'driver', before: locked.driver, after: input.driver }]
        : []),
      ...(input.status !== locked.status
        ? [{ field: 'status', before: locked.status, after: input.status }]
        : []),
    ]
    const row: GatewayConfigRecord = {
      ...locked,
      driver: input.driver,
      status: input.status,
      receivingAccount: input.receivingAccount,
      secretsEnc: blob,
      lastCheckAt: null,
      lastCheckOk: null,
      version,
    }
    return { result: { created: false, config: await this.toView(row) }, changes }
  }

  private async create(staff: StaffContext, input: SaveGatewayInput, fields: readonly string[]) {
    const { gateways, secretBox, ids } = this.deps
    const missing = fields.filter((field) => !input.secrets?.[field])
    if (missing.length > 0)
      throw new ValidationError(
        missing.map((field) => ({
          path: `secrets.${field}`,
          code: 'required',
          message: 'required by the driver',
        })),
      )
    const id = ids.next()
    const blob = await secretBox.seal(aadOf(id), JSON.stringify(input.secrets ?? {}))
    await gateways
      .insert(staff.scope, {
        id,
        buildingId: staff.buildingId,
        provider: input.provider,
        driver: input.driver,
        secretsEnc: blob,
        receivingAccount: input.receivingAccount,
        status: input.status,
      })
      .catch((error: unknown) => {
        if (isUnique(error)) throw new VersionConflictError()
        throw error
      })
    const row: GatewayConfigRecord = {
      id,
      buildingId: staff.buildingId,
      provider: input.provider,
      driver: input.driver,
      secretsEnc: blob,
      receivingAccount: input.receivingAccount,
      status: input.status,
      lastCheckAt: null,
      lastCheckOk: null,
      version: 1,
    }
    const changes = [
      { field: 'secrets', before: null, after: '[masked]' },
      { field: 'driver', before: null, after: input.driver },
      { field: 'status', before: null, after: input.status },
      ...diffAccount(null, input.receivingAccount),
    ]
    return { result: { created: true, config: await this.toView(row) }, changes }
  }

  // --- mapping -----------------------------------------------------------------------------------------------------

  private async decrypt(row: GatewayConfigRecord): Promise<GatewayConfigDto> {
    const secrets = JSON.parse(
      await this.deps.secretBox.open(aadOf(row.id), row.secretsEnc),
    ) as Record<string, string>
    return {
      id: row.id,
      provider: row.provider,
      driver: row.driver,
      status: row.status,
      receivingAccount: row.receivingAccount,
      secrets,
    }
  }

  private async toView(row: GatewayConfigRecord): Promise<GatewayView> {
    const decrypted = await this.decrypt(row)
    return {
      id: row.id,
      provider: row.provider,
      driver: row.driver,
      status: row.status,
      receivingAccount: row.receivingAccount,
      secrets: Object.fromEntries(
        Object.entries(decrypted.secrets).map(([key, value]) => [key, maskSecret(value)]),
      ),
      lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
      lastCheckOk: row.lastCheckOk,
      version: row.version,
    }
  }
}

/** Field by field: a `jsonb` column does not keep the order of the keys it was given. */
const sameAccount = (a: ReceivingAccount, b: ReceivingAccount) =>
  a.bankBin === b.bankBin && a.accountNumber === b.accountNumber && a.accountName === b.accountName

function diffAccount(before: ReceivingAccount | null, after: ReceivingAccount) {
  const out: Array<{ field: string; before: string | null; after: string | null }> = []
  const shown = (key: keyof ReceivingAccount, value: string | undefined) =>
    value === undefined ? null : key === 'accountNumber' ? maskAccountNumber(value) : value
  for (const key of ['bankBin', 'accountNumber', 'accountName'] as const)
    if (before?.[key] !== after[key])
      out.push({
        field: `receivingAccount.${key}`,
        before: shown(key, before?.[key]),
        after: shown(key, after[key]),
      })
  return out
}

const isUnique = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505')

function assertAdmin(staff: StaffContext): void {
  if (staff.role !== 'admin') throw new ForbiddenError()
}
