import { Database } from '@core/db'
import { noIdempotency } from '@core/http'
import { createSecretBox, NotFoundError, UuidV7Generator } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type { FileActor, FileExpectation, FilesApi } from '@mod/building/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import type { BuildingId, Guards, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { sql } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { installResidency, type ResidencyModule, residencyManifest } from '../src'
import type { MembershipRecord } from '../src/domain/membership'

/**
 * The shared fixture of the `residency` tests (DOC-27 §17): a clone of the migrated template database, the real audit module and
 * a fake clock. Units, memberships and profiles are inserted as the migrator, the way the staff API of P1-14 will have made them.
 */

export const BUILDING = '018f0000-0000-7000-8000-000000000001' as BuildingId
export const OTHER_BUILDING = '018f0000-0000-7000-8000-000000000002' as BuildingId

const silent = { info() {}, warn() {}, error() {} }

/** The bytes of a workbook with one sheet: row 1 is the header, the rest are the data rows. */
export async function workbookOf(rows: readonly (readonly unknown[])[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Căn hộ')
  for (const row of rows) sheet.addRow([...row])
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

export const HEADER = [
  'Mã căn hộ',
  'Tầng',
  'Số phòng ngủ',
  'Diện tích (m²)',
  'Tình trạng',
  'Họ tên chủ hộ',
  'SĐT chủ hộ',
  'Email chủ hộ',
  'CCCD chủ hộ',
  'Ngày sinh chủ hộ',
] as const

type StoredFile = {
  bytes: Uint8Array
  accountId: string
  status: 'verified' | 'attached' | 'deleted'
  ownerRef: string | null
}

/** `FilesApi` as the import uses it, in memory: the rules of `read` are the real ones (DOC-37 §6.4), the bucket is a map. */
export class MemoryFiles implements Pick<FilesApi, 'read' | 'attach' | 'remove'> {
  readonly stored = new Map<string, StoredFile>()

  /** An upload the staff member registered and verified. */
  put(accountId: string, bytes: Uint8Array): string {
    const id = crypto.randomUUID()
    this.stored.set(id, { bytes, accountId, status: 'verified', ownerRef: null })
    return id
  }

  async read(actor: FileActor, fileId: string, expect: FileExpectation) {
    const file = this.stored.get(fileId)
    if (!file) throw new NotFoundError()
    if (file.status === 'verified' && file.accountId !== actor.accountId) throw new NotFoundError()
    const usable =
      file.status === 'verified' ||
      (file.status === 'attached' && file.ownerRef === expect.ownerRef)
    if (!usable) throw new Error('file_not_verified')
    return file.bytes
  }

  async attach(actor: FileActor, fileId: string, ownerRef: string) {
    const file = this.stored.get(fileId)
    if (file?.status !== 'verified' || file.accountId !== actor.accountId)
      throw new Error('file_not_verified')
    file.status = 'attached'
    file.ownerRef = ownerRef
  }

  async remove(_actor: FileActor, fileId: string) {
    const file = this.stored.get(fileId)
    if (!file) throw new NotFoundError()
    file.status = 'deleted'
  }
}

/**
 * The calls of `IdentityApi` that `residency` makes, on the real `identity.resident_account` table and in the caller's
 * transaction: the real module needs the whole host, and this is the same two statements.
 */
export function identityOn(database: Database, ids: UuidV7Generator, now: () => Date) {
  const stand: Pick<
    IdentityApi,
    'findResidentAccountsByPhones' | 'findOrCreateResidentAccount' | 'getStaff'
  > & { calls: string[] } = {
    calls: [],
    async findResidentAccountsByPhones(phones) {
      if (phones.length === 0) return []
      const list = sql.join(
        phones.map((phone) => sql`${phone}`),
        sql`, `,
      )
      const rows = await database.executor.execute(
        sql`SELECT phone, id, display_name, status FROM identity.resident_account
             WHERE phone IN (${list}) AND status <> 'deleted'`,
      )
      return [...rows].map((row) => ({
        phone: row.phone as string,
        accountId: row.id as string,
        displayName: row.display_name as string | null,
        status: row.status as 'active' | 'deletion_requested',
      }))
    },
    async findOrCreateResidentAccount(phone, displayName) {
      stand.calls.push(phone)
      const inserted = await database.executor.execute(
        sql`INSERT INTO identity.resident_account (id, phone, display_name, created_at, updated_at)
            VALUES (${ids.next()}, ${phone}, ${displayName}, ${now().toISOString()}, ${now().toISOString()})
            ON CONFLICT (phone) DO NOTHING RETURNING id`,
      )
      const [found] = await database.executor.execute(
        sql`SELECT id FROM identity.resident_account WHERE phone = ${phone}`,
      )
      return { accountId: (found as { id: string }).id, created: inserted.length === 1 }
    },
    async getStaff() {
      return []
    },
  }
  return stand
}

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
  const files = new MemoryFiles()
  const identity = identityOn(database, ids, () => clock.now())
  const residency: ResidencyModule = installResidency({
    logger: silent,
    clock,
    ids,
    database,
    building: { getBuilding: async () => null },
    files,
    identity,
    // The import routes are not mounted in these tests: the guards are the host's.
    idempotent: noIdempotency,
    guards: { staff: () => ({}), resident: () => ({}), unit: () => ({}) } as unknown as Guards,
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
    files,
    identity,
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
