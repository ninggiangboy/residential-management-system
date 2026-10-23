import { describe, expect, test } from 'bun:test'
import { createLogger } from '@core/telemetry'
import { buildingManifest } from '@mod/building/manifest'
import { identityManifest } from '@mod/identity/manifest'
import { residencyManifest } from '@mod/residency/manifest'
import { loadAppConfig } from './config'
import { localEnv } from './config/support'
import { createContainer } from './container'
import { JOB_CATALOG } from './job-catalog'
import { MODULE_CATALOG } from './module-catalog'

/** No database is needed: the container only builds objects; the pool connects when the first query runs. */
const container = createContainer(
  loadAppConfig({ ...localEnv(), DATABASE_URL: 'postgres://rms_app:x@127.0.0.1:1/rms' }),
  createLogger('silent'),
)

describe('JB-10: the jobs of the installed modules are the rows of the catalog (DOC-38 §4.1)', () => {
  test('every job a module defines has the module, schedule and mode of its row', () => {
    const defined = container.modules.flatMap((module) =>
      (module.jobs ?? []).map((job) => ({ module: module.name, job })),
    )
    expect(defined.map(({ job }) => job.name).sort()).toEqual([
      'audit_purge',
      'orphan_uploads',
      'storage_quota',
    ])
    for (const { module, job } of defined) {
      const row = JOB_CATALOG.find((entry) => entry.name === job.name)
      expect(row, job.name).toBeDefined()
      expect(row).toMatchObject({ module, schedule: job.schedule, mode: job.mode })
    }
  })

  test('the audit purge catches up for 168 hours, the hourly jobs not at all', () => {
    const graces = Object.fromEntries(
      container.modules.flatMap((module) =>
        (module.jobs ?? []).map((job) => [job.name, job.graceMinutes]),
      ),
    )
    expect(graces).toEqual({ audit_purge: 10_080, storage_quota: 0, orphan_uploads: 0 })
  })
})

describe('the module catalog (DOC-12 §5.2)', () => {
  test('audit comes before building, identity and residency, and a module is installed for every manifest', () => {
    const order = ['audit', 'building', 'identity', 'residency']
    expect(MODULE_CATALOG.map((manifest) => manifest.name)).toEqual(order)
    expect(container.modules.map((module) => module.name)).toEqual(order)
  })

  test('identity writes the mail and SMS commands and the session event; only the SMS has its own retry class', () => {
    expect(identityManifest.outboxPolicies).toEqual({
      'identity.mail_requested.v1': 'default',
      'identity.sms_requested.v1': 'sms',
      'identity.session_revoked.v1': 'default',
    })
    expect(container.modules.find((module) => module.name === 'identity')?.outbox?.name).toBe(
      'identity',
    )
  })

  test('residency writes the two facts of DOC-09 §6.2, both of the default retry class', () => {
    expect(residencyManifest.outboxPolicies).toEqual({
      'residency.membership_changed.v1': 'default',
      'residency.owner_changed.v1': 'default',
    })
    expect(container.modules.find((module) => module.name === 'residency')?.outbox?.name).toBe(
      'residency',
    )
  })

  test('the commands that building writes are the ones its manifest lists, with the default retry class', () => {
    expect(buildingManifest.outboxPolicies).toEqual({
      'building.file_delete_requested.v1': 'default',
      'building.thumbnail_requested.v1': 'default',
    })
    expect(container.modules.find((module) => module.name === 'building')?.outbox?.name).toBe(
      'building',
    )
    expect(container.modules.find((module) => module.name === 'audit')?.outbox).toBeUndefined()
  })
})
