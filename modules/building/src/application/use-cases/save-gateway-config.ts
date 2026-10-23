import type { IdGenerator, SecretBox, UnitOfWork } from '@core/kernel'
import {
  ForbiddenError,
  PreconditionRequiredError,
  RuleViolationError,
  requireRole,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type {
  ActiveIntentProbe,
  GatewayDriver,
  GatewayProvider,
  ReceivingAccount,
  StepUpVerifier,
} from '../../contracts'
import { GatewayInUseError } from '../../domain/errors'
import { GatewayConfig, type GatewayTarget } from '../../domain/gateway-config'
import type {
  GatewayConfigRecord,
  GatewayConfigRepository,
} from '../../domain/gateway-config-repository'
import type { BuildingDirectory } from '../directory'
import { type GatewayConfigReader, type GatewayView, gatewayAad } from '../gateway-config-reader'
import { isUniqueViolation } from '../unique-violation'

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

/** The body of E-50: on a row that exists, `driver`, `status` and `receivingAccount` that are absent keep their stored value (DOC-36 §7.2). */
export type SaveGatewayRequest = Omit<SaveGatewayInput, 'driver' | 'status' | 'receivingAccount'> &
  Partial<Pick<SaveGatewayInput, 'driver' | 'status' | 'receivingAccount'>>

type Saved = { created: boolean; config: GatewayView }

/** The gateway is the Admin's alone (DOC-36 §7). The route reads this list for its `audience` (DOC-12 §5.3). */
export const SAVE_GATEWAY_CONFIG_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * The Admin's save of the payment-gateway configuration (DOC-36 §7, DR-33): a step-up proof, the version the form read, the
 * lock, the intent probe, the merge of the secrets, and an audit row that says a secret changed and never what it was.
 */
export class SaveGatewayConfig {
  private readonly auditedSave: ReturnType<SaveGatewayConfig['buildAuditedSave']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateways: GatewayConfigRepository,
    private readonly directory: BuildingDirectory,
    private readonly reader: GatewayConfigReader,
    private readonly secretBox: SecretBox,
    private readonly stepUp: StepUpVerifier,
    /** `finance` answers it from `integrations/building`; without it a gateway could change under live intents. */
    private readonly probe: ActiveIntentProbe,
    private readonly audited: Audited,
    private readonly ids: IdGenerator,
  ) {
    this.auditedSave = this.buildAuditedSave()
  }

  async execute(staff: StaffContext, input: SaveGatewayRequest): Promise<Saved> {
    requireRole(staff, SAVE_GATEWAY_CONFIG_ROLES)
    // Decided before any database work, and it names the action the client asks the proof for (EXP-10 S0, DOC-39 §9).
    if (!input.stepUp)
      throw new ForbiddenError('step_up_required', 'A step-up proof is required', {
        details: { action: 'gateway_config' },
      })
    if (input.receivingAccount) GatewayConfig.assertAccount(input.receivingAccount)
    const result = await this.uow.run(() => this.auditedSave(staff, input))
    this.reader.invalidate(staff.buildingId, input.provider)
    return result
  }

  private buildAuditedSave() {
    return this.audited(
      {
        action: 'building.gateway.update',
        object: (r: Saved) => ({ type: 'gateway_config', id: r.config.id }),
        details: () => ({ stepUp: true }),
      },
      async (staff: StaffContext, request: SaveGatewayRequest) => {
        const { gateways, directory, stepUp } = this
        // A save asks for a second proof, even one that only re-saves (`execute` refused a request without one); the verifier
        // counts a wrong password toward the lockout.
        await stepUp.verifyStepUp(
          staff,
          'gateway_config',
          request.stepUp as NonNullable<SaveGatewayRequest['stepUp']>,
        )

        const existing = await gateways.findActive(staff.scope, request.provider)
        const input = this.resolve(request, existing)
        GatewayConfig.assertKnownSecrets(input)
        // `fake` pretends to be a provider and belongs to a demo building only (DR-26).
        if (input.driver === 'fake' && !(await directory.isDemo(staff.buildingId)))
          throw new RuleViolationError(
            'driver_not_allowed',
            'The fake driver is for the demo building',
            'driver',
          )

        return existing
          ? this.update(staff, input, new GatewayConfig(existing))
          : this.create(staff, input)
      },
    )
  }

  /** Fills what the request left out: from the stored row, or on a first configuration with the defaults; a missing required field is 400. */
  private resolve(
    request: SaveGatewayRequest,
    existing: GatewayConfigRecord | null,
  ): SaveGatewayInput {
    const driver = request.driver ?? existing?.driver
    const receivingAccount = request.receivingAccount ?? existing?.receivingAccount
    const missing = [
      ...(driver ? [] : ['driver']),
      ...(receivingAccount ? [] : ['receivingAccount']),
    ]
    if (!driver || !receivingAccount)
      throw new ValidationError(
        missing.map((path) => ({ path, code: 'required', message: 'required' })),
      )
    return {
      ...request,
      driver,
      receivingAccount,
      status: request.status ?? existing?.status ?? 'active',
    }
  }

  /** The save of a row that exists: the version the form read, the lock, the intent probe, the merge of the secrets (DOC-36 §7.3). */
  private async update(staff: StaffContext, input: SaveGatewayInput, existing: GatewayConfig) {
    const { gateways, secretBox, probe, reader } = this
    if (input.version === undefined) throw new PreconditionRequiredError()
    const lockedRecord = await gateways.lockForUpdate(
      staff.scope,
      existing.record.id,
      input.version,
    )
    if (!lockedRecord) throw new VersionConflictError()
    const locked = new GatewayConfig(lockedRecord)
    const target: GatewayTarget = input

    // A secrets-only change does not ask: the checksum key of an intent already created is looked up when its webhook arrives.
    if (locked.changesTarget(target) && (await probe.hasActive(staff.buildingId, input.provider)))
      throw new GatewayInUseError()

    const stored = JSON.parse(
      await secretBox.open(gatewayAad(lockedRecord.id), lockedRecord.secretsEnc),
    ) as Record<string, string>
    const { secrets, changes } = locked.merge(target, stored)
    const blob = await secretBox.seal(gatewayAad(lockedRecord.id), JSON.stringify(secrets))
    const version = await gateways
      .updateGuarded(staff.scope, lockedRecord.id, lockedRecord.version, {
        secretsEnc: blob,
        receivingAccount: input.receivingAccount,
        driver: input.driver,
        status: input.status,
      })
      .catch((error: unknown) => {
        // Re-enabling while another row of the provider is active: the unique index decides the race (DOC-17 §1.3).
        if (isUniqueViolation(error)) throw new VersionConflictError()
        throw error
      })
    if (version === null) throw new VersionConflictError()

    const row: GatewayConfigRecord = {
      ...lockedRecord,
      driver: input.driver,
      status: input.status,
      receivingAccount: input.receivingAccount,
      secretsEnc: blob,
      lastCheckAt: null,
      lastCheckOk: null,
      version,
    }
    return { result: { created: false, config: await reader.view(row) }, changes }
  }

  private async create(staff: StaffContext, input: SaveGatewayInput) {
    const { gateways, secretBox, ids, reader } = this
    const { secrets, changes } = GatewayConfig.create(input)
    const id = ids.next()
    const blob = await secretBox.seal(gatewayAad(id), JSON.stringify(secrets))
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
        if (isUniqueViolation(error)) throw new VersionConflictError()
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
    return { result: { created: true, config: await reader.view(row) }, changes }
  }
}
