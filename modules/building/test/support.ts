import { Database } from '@core/db'
import { createSecretBox, type SecretBox, UuidV7Generator } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { type ObjectStorage, S3ObjectStorage } from '@core/storage'
import { FakeClock, FakeStorage } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import type { BuildingId, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import type { sql } from 'drizzle-orm'
import sharp from 'sharp'
import { type BuildingModule, buildingManifest, installBuilding } from '../src'
import type {
  ActiveIntentProbe,
  FileActor,
  StepUpAction,
  StepUpVerifier,
  UploadTicket,
} from '../src/contracts'

/**
 * The shared fixture of the `building` tests: a clone of the migrated template database, the real audit module, a fake clock,
 * and an object store that is SeaweedFS when `S3_ENDPOINT` answers (the real presigned `PUT` flow, DOC-37 §13) and an in-memory
 * fake when it does not (CI has no object store yet), so every test runs in both worlds.
 */

export const BUILDING = '018f0000-0000-7000-8000-000000000001' as BuildingId
export const DEMO_BUILDING = '018f0000-0000-7000-8000-000000000002' as BuildingId
const silent = { info() {}, warn() {}, error() {} }

async function realStorageOrNull(): Promise<ObjectStorage | null> {
  const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET } = process.env
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) return null
  try {
    await fetch(S3_ENDPOINT, { signal: AbortSignal.timeout(1500) })
  } catch {
    return null
  }
  return new S3ObjectStorage({
    endpoint: S3_ENDPOINT,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    bucket: S3_BUCKET,
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  })
}

interface StepUpCalls {
  calls: Array<{
    staff: StaffContext
    action: StepUpAction
    proof: { password: string; code: string }
  }>
  failWith?: Error
}

export interface HarnessOptions {
  settingsCacheSeconds?: number
  uploadRatePerHour?: number
}

export async function createHarness(options: HarnessOptions = {}) {
  const db: TestDb = await cloneTemplate('empty')
  const database = new Database({ url: db.url, poolMax: 10, prepare: false })
  const clock = new FakeClock(new Date('2026-10-20T03:00:00Z'))
  const ids = new UuidV7Generator()
  const real = await realStorageOrNull()
  const fake = new FakeStorage()
  const storage: ObjectStorage = real ?? fake

  const stepUpState: StepUpCalls = { calls: [] }
  const stepUp: StepUpVerifier = {
    async verifyStepUp(staff, action, proof) {
      stepUpState.calls.push({ staff, action, proof })
      if (stepUpState.failWith) throw stepUpState.failWith
    },
  }
  const probeState = { active: false }
  const probe: ActiveIntentProbe = { hasActive: async () => probeState.active }

  const rings = { k1: new Uint8Array(32).fill(1) }
  const secretBox: SecretBox = createSecretBox(rings)

  const audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, buildingManifest]),
    purgeGraceMinutes: 0,
  })
  const usage: Array<{ buildingId: string; ratio: number; isDemo: boolean }> = []
  const building: BuildingModule = installBuilding({
    logger: silent,
    clock,
    ids,
    database,
    storage,
    secretBox,
    stepUp,
    probe,
    audited: audit.audited,
    guards: { staff: () => ({ transform: async () => {} }) },
    staffNames: { names: async () => ({}) },
    files: {
      env: 'test',
      uploadUrlTtlSeconds: 900,
      downloadUrlTtlSeconds: 900,
      paperUrlTtlSeconds: 300,
      limits: {
        imageBytes: 10 * 1048576,
        videoBytes: 50 * 1048576,
        attachmentBytes: 20 * 1048576,
        importBytes: 5 * 1048576,
        logoBytes: 1048576,
        generatedBytes: 1073741824,
      },
      thumbnailWidth: 480,
      logoWidth: 512,
      orphanAfterHours: 24,
      deletedRowRetentionDays: 90,
    },
    settingsCacheSeconds: options.settingsCacheSeconds ?? 60,
    uploadRatePerHour: options.uploadRatePerHour ?? 60,
    outboxMaxPayloadBytes: 65536,
    features: { ticketDeadlines: false },
    usage: { report: (buildingId, ratio, isDemo) => usage.push({ buildingId, ratio, isDemo }) },
  })

  const admin = db.admin()
  await admin.unsafe(`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES ('${BUILDING}', 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}',
            '{"name":{"vi":"Công ty Sunrise"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false),
           ('${DEMO_BUILDING}', 'DEMO-A', '{"vi":"Chung cư Demo A"}', '{"name":{"vi":"Demo"}}', '1 Demo', null, true);
    INSERT INTO building.building_setting (building_id) VALUES ('${BUILDING}'), ('${DEMO_BUILDING}');`)

  const staff = (role: StaffRole, buildingId: BuildingId = BUILDING): StaffContext => ({
    buildingId,
    staffId: ids.next() as StaffId,
    role,
    scope: { buildingId },
  })
  const actorOf = (context: StaffContext): FileActor => ({
    accountKind: 'staff',
    accountId: context.staffId,
    buildingId: context.buildingId,
    scope: context.scope,
    role: context.role,
  })
  const resident = (accountId = ids.next(), buildingId: BuildingId = BUILDING): FileActor => ({
    accountKind: 'resident',
    accountId,
    buildingId,
    scope: { buildingId },
  })

  /** What the client does with the ticket: the real `PUT` to the presigned URL, or its fake. Returns the HTTP status. */
  async function clientPut(
    ticket: UploadTicket,
    body: Uint8Array,
    contentType: string = ticket.headers['Content-Type'],
  ): Promise<number> {
    if (real) {
      const response = await fetch(ticket.url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body,
      })
      return response.status
    }
    // The fake store enforces what a real one does: the signed Content-Type.
    if (contentType !== ticket.headers['Content-Type']) return 403
    const key = new URL(ticket.url).pathname.replace(/^\/put\//, '')
    await fake.write(key, body, contentType)
    return 200
  }

  const keyOf = async (fileId: string) =>
    String(
      (await db.sql`SELECT object_key FROM building.file_object WHERE id = ${fileId}`)[0]
        ?.object_key,
    )

  /** The commands the relay would deliver: each outbox row goes to the handler of its type, then is marked published. */
  async function deliver(): Promise<number> {
    const rows = await db.sql`
      SELECT id, type, aggregate_id, payload, occurred_at FROM building.outbox_messages WHERE published_at IS NULL ORDER BY id`
    for (const row of rows) {
      const envelope: Envelope = {
        id: row.id,
        type: row.type,
        source: 'building',
        aggregateId: row.aggregate_id,
        occurredAt: new Date(row.occurred_at).toISOString(),
        payload: row.payload,
        headers: {},
      }
      for (const handler of building.handlers ?? [])
        if (handler.eventType === row.type) await handler.handle(envelope)
      await db.sql`UPDATE building.outbox_messages SET published_at = now() WHERE id = ${row.id}`
    }
    return rows.length
  }

  const commands = async (type?: string) =>
    (
      await db.sql`SELECT type, payload FROM building.outbox_messages ${type ? db.sql`WHERE type = ${type}` : db.sql``} ORDER BY id`
    ).map((r) => ({
      type: r.type as string,
      payload: r.payload as { buildingId: string; fileId: string },
    }))

  /** Runs a job of the module the way the job runtime does: `withLock` is one transaction, the buildings are the two seeded ones. */
  async function runJob(name: string) {
    const job = building.jobs?.find((candidate) => candidate.name === name)
    if (!job) throw new Error(`no job ${name}`)
    return job.run({
      clock,
      signal: new AbortController().signal,
      logger: silent as never,
      manual: false,
      paused: () => false,
      buildings: async () => [{ buildingId: BUILDING }, { buildingId: DEMO_BUILDING }],
      withLock: (fn) => database.transaction(fn),
      snapshot: (fn) => database.transaction(fn),
    })
  }

  const fileRow = async (fileId: string) =>
    (await db.sql`SELECT * FROM building.file_object WHERE id = ${fileId}`)[0]

  return {
    db,
    admin,
    database,
    clock,
    ids,
    storage,
    isRealStorage: real !== null,
    building,
    audit,
    secretBox,
    stepUpState,
    probeState,
    usage,
    staff,
    actorOf,
    resident,
    clientPut,
    keyOf,
    deliver,
    runJob,
    commands,
    fileRow,
    execute: (statement: ReturnType<typeof sql>) => database.executor.execute(statement),
    async close() {
      await storage.deletePrefix(`test/${BUILDING}/`).catch(() => {})
      await storage.deletePrefix(`test/${DEMO_BUILDING}/`).catch(() => {})
      await admin.end()
      await database.close()
      await db.drop()
    },
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>

/** A real JPEG, so the magic check passes and `sharp` can resize it. Noise keeps it from compressing to nothing. */
export async function jpeg(width = 1920, height = 1080, quality = 80): Promise<Uint8Array> {
  const noise = Buffer.alloc(width * height * 3)
  crypto.getRandomValues(noise.subarray(0, Math.min(noise.length, 65536)))
  for (let i = 65536; i < noise.length; i++) noise[i] = (i * 31 + (i >> 8)) & 0xff
  return new Uint8Array(
    await sharp(noise, { raw: { width, height, channels: 3 } })
      .jpeg({ quality })
      .toBuffer(),
  )
}

export const PNG_HEAD = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
])
