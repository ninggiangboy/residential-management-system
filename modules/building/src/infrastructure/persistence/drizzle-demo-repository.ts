import { type Database, inBuilding } from '@core/db'
import type {
  BuildingScope,
  DemoBuildingSeed,
  DemoCounts,
  DemoGatewaySeed,
  DemoTermsSeed,
} from '@rms/shared-types'
import { eq, sql } from 'drizzle-orm'
import type { DemoRepository } from '../../domain/demo-repository'
import { DemoResetRefusedError } from '../../domain/errors'
import {
  buildingSetting,
  buildingTable,
  gatewayConfig,
  termsAcceptance,
  termsVersion,
} from './schema'

/** `building.building` is the scope root and is on the allow-list of the scope lint (DOC-14 §5.3): its methods take the id. */
export class DrizzleDemoRepository implements DemoRepository {
  constructor(private readonly database: Database) {}

  async ensureBuilding(seed: DemoBuildingSeed): Promise<boolean> {
    const created = await this.database.executor
      .insert(buildingTable)
      .values({
        id: seed.id,
        code: seed.code,
        name: seed.name,
        company: seed.company,
        address: seed.address,
        hotline: seed.hotline,
        workingHours: seed.workingHours,
        email: seed.email,
        timeZone: seed.timeZone,
        isDemo: true,
      })
      .onConflictDoNothing({ target: buildingTable.id })
      .returning({ id: buildingTable.id })
    if (created.length === 1) return true
    const [existing] = await this.database.executor
      .select({ isDemo: buildingTable.isDemo })
      .from(buildingTable)
      .where(eq(buildingTable.id, seed.id))
    if (!existing?.isDemo) throw new DemoResetRefusedError()
    return false
  }

  async restoreBuilding(scope: BuildingScope, seed: DemoBuildingSeed): Promise<void> {
    await this.database.executor
      .update(buildingTable)
      .set({
        name: seed.name,
        company: seed.company,
        address: seed.address,
        hotline: seed.hotline,
        workingHours: seed.workingHours,
        email: seed.email,
        logoFile: null,
        version: sql`${buildingTable.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(buildingTable.id, scope.buildingId))
  }

  async deleteRows(scope: BuildingScope): Promise<DemoCounts> {
    const acceptances = await this.database.executor
      .delete(termsAcceptance)
      .where(inBuilding(termsAcceptance, scope))
      .returning({ accountId: termsAcceptance.accountId })
    const gateways = await this.database.executor
      .delete(gatewayConfig)
      .where(inBuilding(gatewayConfig, scope))
      .returning({ id: gatewayConfig.id })
    const settings = await this.database.executor
      .delete(buildingSetting)
      .where(inBuilding(buildingSetting, scope))
      .returning({ buildingId: buildingSetting.buildingId })
    return {
      'building.terms_acceptance': acceptances.length,
      'building.gateway_config': gateways.length,
      'building.building_setting': settings.length,
    }
  }

  async insertSettings(scope: BuildingScope): Promise<void> {
    await this.database.executor.insert(buildingSetting).values({ buildingId: scope.buildingId })
  }

  async insertGateway(
    scope: BuildingScope,
    seed: DemoGatewaySeed,
    secretsEnc: string,
  ): Promise<void> {
    await this.database.executor.insert(gatewayConfig).values({
      id: seed.id,
      buildingId: scope.buildingId,
      provider: seed.provider,
      driver: seed.driver,
      secretsEnc,
      receivingAccount: seed.receivingAccount,
      status: 'active',
    })
  }

  async insertTermsOnce(
    scope: BuildingScope,
    seed: DemoTermsSeed,
    publishedBy: string,
  ): Promise<boolean> {
    // The unique index on (building, kind, version) decides when the version exists; the id of the seed is the row of version 1.
    const rows = await this.database.executor
      .insert(termsVersion)
      .values({
        id: seed.id,
        buildingId: scope.buildingId,
        kind: seed.kind,
        version: 1,
        text: seed.text,
        publishedBy,
      })
      .onConflictDoNothing()
      .returning({ id: termsVersion.id })
    return rows.length === 1
  }
}
