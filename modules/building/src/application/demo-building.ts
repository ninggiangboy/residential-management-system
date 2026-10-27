import type { Clock, SecretBox } from '@core/kernel'
import type { DemoCounts, DemoResettable, DemoSeedContext } from '@rms/shared-types'
import type { DemoRepository } from '../domain/demo-repository'
import type { FileRepository } from '../domain/file-repository'
import type { BuildingDirectory } from './directory'
import type { FileDeleter } from './file-deleter'
import { gatewayAad } from './gateway-config-reader'
import { scopeOf } from './scope-of'

const FILE_BATCH = 500

/**
 * `building`'s part of the demo reset (DOC-36 §9.1, §10.2). It deletes the settings, the gateway configuration, the terms
 * acceptances and the demo's files (each file moves to `deleted` with its delete command, DR-122), then puts the building row and
 * those rows back to the seed. Terms versions are write-once and stay; `audit_log` and `job_run` are not touched (DR-60).
 */
export class BuildingDemo implements DemoResettable {
  readonly module = 'building'

  constructor(
    private readonly directory: BuildingDirectory,
    private readonly demo: DemoRepository,
    private readonly files: FileRepository,
    private readonly deleter: FileDeleter,
    private readonly secretBox: SecretBox,
    private readonly clock: Clock,
  ) {}

  async resetDemo(buildingId: string): Promise<DemoCounts> {
    await this.directory.assertDemo(buildingId)
    const scope = scopeOf(buildingId)
    let removed = 0
    for (;;) {
      const batch = await this.files.listLive(scope, FILE_BATCH)
      for (const file of batch)
        if (await this.deleter.delete(scope, file, this.clock.now())) removed++
      if (batch.length < FILE_BATCH) break
    }
    return { 'building.file_object': removed, ...(await this.demo.deleteRows(scope)) }
  }

  async seedDemo(buildingId: string, ctx: DemoSeedContext): Promise<DemoCounts> {
    await this.directory.assertDemo(buildingId)
    const scope = scopeOf(buildingId)
    const { plan } = ctx
    await this.demo.restoreBuilding(scope, plan.building)
    await this.demo.insertSettings(scope)
    // The `fake` driver has no secret: the blob seals an empty object, so the row passes the format check of DOC-17 §1.3.
    const blob = await this.secretBox.seal(gatewayAad(plan.gateway.id), '{}')
    await this.demo.insertGateway(scope, plan.gateway, blob)
    let terms = 0
    for (const version of plan.terms)
      if (await this.demo.insertTermsOnce(scope, version, plan.termsPublisherId)) terms++
    this.directory.invalidate(buildingId)
    return {
      'building.building': 1,
      'building.building_setting': 1,
      'building.gateway_config': 1,
      'building.terms_version': terms,
    }
  }
}
