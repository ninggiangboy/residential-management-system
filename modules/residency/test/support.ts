import { Database } from '@core/db'
import { createSecretBox, UuidV7Generator } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type { BuildingId, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { installResidency, type ResidencyModule, residencyManifest } from '../src'
import type { MembershipRecord } from '../src/domain/membership'

/**
 * The shared fixture of the `residency` tests (DOC-27 §17): a clone of the migrated template database, the real audit module and
 * a fake clock. Units, memberships and profiles are inserted as the migrator, the way the staff API of P1-14 will have made them.
 */

export const BUILDING = '018f0000-0000-7000-8000-000000000001' as BuildingId
export const OTHER_BUILDING = '018f0000-0000-7000-8000-000000000002' as BuildingId

const silent = { info() {}, warn() {}, error() {} }

export interface SeedMembership {
  accountId?: string
  unit?: { id: string; buildingId: BuildingId }
  memberType?: MembershipRecord['memberType']
  canPay?: boolean
  status?: MembershipRecord['status']
  lockedBy?: 'owner' | 'manager' | null
  credentialVersion?: number
  createdAt?: Date
  addedBy?: string
}

export async function createHarness() {
  const db: TestDb = await cloneTemplate('empty')
  const database = new Database({ url: db.url, poolMax: 10, prepare: false })
  const clock = new FakeClock(new Date('2026-10-20T03:00:00Z'))
  const ids = new UuidV7Generator()
  const pii = createSecretBox({ k1: new Uint8Array(32).fill(2) })
  const audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, residencyManifest]),
    purgeGraceMinutes: 0,
  })
  const residency: ResidencyModule = installResidency({
    logger: silent,
    clock,
    ids,
    database,
    building: { getBuilding: async () => null },
    pii: () => pii,
    audited: audit.audited,
    outboxMaxPayloadBytes: 65536,
  })
  const admin = db.admin()

  let unitCounter = 0
  async function seedUnit(buildingId: BuildingId = BUILDING, code?: string) {
    unitCounter++
    const id = ids.next()
    await admin`
      INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
      VALUES (${id}, ${buildingId}, ${code ?? `A-${1000 + unitCounter}`}, ${10 + (unitCounter % 20)}, 'occupied')`
    return { id, buildingId, code: code ?? `A-${1000 + unitCounter}` }
  }

  async function seedProfile(
    accountId: string,
    buildingId: BuildingId = BUILDING,
    fullName = 'Nguyễn Văn An',
  ) {
    await admin`
      INSERT INTO residency.resident_profile (building_id, account_id, full_name)
      VALUES (${buildingId}, ${accountId}, ${fullName})`
  }

  async function seedMembership(seed: SeedMembership = {}) {
    const unit = seed.unit ?? (await seedUnit())
    const id = ids.next()
    const accountId = seed.accountId ?? ids.next()
    const status = seed.status ?? 'active'
    await admin`
      INSERT INTO residency.membership
        (id, building_id, account_id, unit_id, member_type, can_pay, status, locked_by, credential_version,
         added_by_kind, added_by, removed_at, created_at)
      VALUES (${id}, ${unit.buildingId}, ${accountId}, ${unit.id}, ${seed.memberType ?? 'tenant'}, ${seed.canPay ?? false},
              ${status}, ${status === 'locked' ? (seed.lockedBy ?? 'owner') : null}, ${seed.credentialVersion ?? 1},
              'staff', ${seed.addedBy ?? ids.next()}, ${status === 'removed' ? clock.now() : null},
              ${seed.createdAt ?? clock.now()})`
    return { id, accountId, unit }
  }

  const staff = (role: StaffRole = 'manager', buildingId: BuildingId = BUILDING): StaffContext => ({
    buildingId,
    staffId: ids.next() as StaffId,
    role,
    scope: { buildingId },
  })

  const row = async (id: string) => {
    const [found] = await admin`SELECT * FROM residency.membership WHERE id = ${id}`
    return found as
      | {
          status: string
          locked_by: string | null
          credential_version: number
          member_type: string
          can_pay: boolean
        }
      | undefined
  }

  /** The events a use case wrote, as the relay would hand them to a consumer. */
  async function events(type: string): Promise<Envelope[]> {
    const rows = await admin`
      SELECT id, type, aggregate_id, payload, occurred_at FROM residency.outbox_messages WHERE type = ${type} ORDER BY id`
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      source: 'residency',
      aggregateId: r.aggregate_id,
      occurredAt: new Date(r.occurred_at).toISOString(),
      payload: r.payload,
      headers: {},
    }))
  }

  return {
    db,
    admin,
    database,
    clock,
    ids,
    pii,
    residency,
    seedUnit,
    seedMembership,
    seedProfile,
    staff,
    row,
    events,
    close: async () => {
      await residency.close?.()
      await database.close()
      await db.drop()
    },
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>
