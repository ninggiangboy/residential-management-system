import { generateKeyPairSync } from 'node:crypto'
import { Database } from '@core/db'
import { createSecretBox, UuidV7Generator } from '@core/kernel'
import type { Envelope } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { auditActionCatalogOf, auditManifest, installAudit } from '@mod/audit'
import { DEFAULT_SETTINGS } from '@mod/building/contracts'
import type { BuildingId, Guards, StaffContext, StaffId, StaffRole } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { type IdentityConfig, type IdentityModule, identityManifest, installIdentity } from '../src'
import type { PasswordHasher } from '../src/application/ports'
import { Argon2PasswordHasher } from '../src/infrastructure/security/argon2-password-hasher'

/**
 * The shared fixture of the `identity` tests (DOC-26 §12): a clone of the migrated template database, the real audit module, a
 * fake clock, a mailer that records, and a hasher that counts. Argon2 runs with small parameters so a test costs milliseconds;
 * the parameters of production are checked by AU-11 and by the benchmark of DOC-26 §4.2.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001' as BuildingId
export const PASSWORD = 'Sunrise2026!'
const IP = '203.0.113.7'

const silent = { info() {}, warn() {}, error() {} }
const TEST_ARGON2 = { memoryKib: 256, timeCost: 1 }

const es256Pem = () =>
  generateKeyPairSync('ec', { namedCurve: 'P-256' })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString()

/** A hasher that counts the work: AU-02 and AU-09 look at how many Argon2 checks a request cost. */
class CountingHasher implements PasswordHasher {
  verifies = 0
  dummies = 0
  constructor(private readonly inner: PasswordHasher) {}
  hash(plain: string) {
    return this.inner.hash(plain)
  }
  verify(plain: string, hash: string) {
    this.verifies++
    return this.inner.verify(plain, hash)
  }
  needsRehash(hash: string) {
    return this.inner.needsRehash(hash)
  }
  dummyVerify(plain: string) {
    this.dummies++
    return this.inner.dummyVerify(plain)
  }
}

export interface SeedStaff {
  role?: StaffRole
  status?: 'invited' | 'active' | 'locked' | 'disabled'
  email?: string
  fullName?: string
  password?: string | null
  buildingId?: BuildingId
  failedAttempts?: number
  lockedUntil?: Date | null
  language?: 'vi' | 'en'
  passwordHash?: string
}

export interface HarnessOptions {
  config?: Partial<IdentityConfig>
  lockout?: { maxAttempts: number; minutes: number }
  jwtKeys?: Record<string, string>
}

export interface SentMail {
  to: string
  subject: string
  text: string
  html: string
}

const NO_GUARDS: Guards = { staff: () => ({ transform: async () => {} }) }

export async function createHarness(options: HarnessOptions = {}) {
  const db: TestDb = await cloneTemplate('empty')
  const database = new Database({ url: db.url, poolMax: 10, prepare: false })
  const clock = new FakeClock(new Date('2026-10-20T03:00:00Z'))
  const ids = new UuidV7Generator()
  const secretBox = createSecretBox({ k1: new Uint8Array(32).fill(1) })
  const hasher = new CountingHasher(new Argon2PasswordHasher(TEST_ARGON2))
  const sent: SentMail[] = []
  const jwtKeys = options.jwtKeys ?? { k1: es256Pem() }
  const lockout = options.lockout ?? DEFAULT_SETTINGS.lockout

  const config: IdentityConfig = {
    accessTtlSeconds: 900,
    refreshTtlDaysStaff: 30,
    familyMaxDaysStaff: 90,
    maxFamilies: 10,
    refreshGraceSeconds: 10,
    inviteTtlHours: 24,
    resetTtlMinutes: 30,
    stepUpTtlMinutes: 10,
    stepUpMaxAttempts: 5,
    stepUpRequestsPerHour: 5,
    staffLoginPerIp: 30,
    resetPerEmailPerHour: 3,
    resetPerIpPerHour: 10,
    resetMinResponseMs: 0,
    adminBaseUrl: 'https://admin.example.vn',
    ...options.config,
  }

  const audit = installAudit({
    logger: silent,
    ids,
    database,
    actions: auditActionCatalogOf([auditManifest, identityManifest]),
    purgeGraceMinutes: 0,
  })
  const identity: IdentityModule = installIdentity({
    logger: silent,
    clock,
    ids,
    database,
    config,
    argon2: TEST_ARGON2,
    jwtKeys,
    otpHmacKey: Buffer.alloc(32, 7).toString('base64'),
    secretBox,
    mailer: {
      async send(mail) {
        sent.push(mail)
      },
    },
    building: { getSettings: async () => ({ ...DEFAULT_SETTINGS, lockout }) },
    audited: audit.audited,
    guards: NO_GUARDS,
    outboxMaxPayloadBytes: 65536,
    hasher,
    delay: async () => {},
  })

  const admin = db.admin()
  let counter = 0
  const plainHasher = new Argon2PasswordHasher(TEST_ARGON2)

  /** Inserts a staff member as the migrator (the application role cannot create accounts in a test of sign-in). */
  async function seedStaff(seed: SeedStaff = {}) {
    counter++
    const id = ids.next()
    const status = seed.status ?? 'active'
    const password = seed.password === undefined ? PASSWORD : seed.password
    const passwordHash =
      seed.passwordHash ??
      (password === null || status === 'invited' ? null : await plainHasher.hash(password))
    const email = seed.email ?? `staff${counter}@sunrise.example`
    const buildingId = seed.buildingId ?? BUILDING
    await admin`
      INSERT INTO identity.staff_account
        (id, building_id, email, full_name, role, status, password_hash, failed_attempts, locked_until, language)
      VALUES (${id}, ${buildingId}, ${email}, ${seed.fullName ?? `Staff ${counter}`}, ${seed.role ?? 'manager'},
              ${status}, ${passwordHash}, ${seed.failedAttempts ?? 0}, ${seed.lockedUntil ?? null}, ${seed.language ?? 'en'})`
    const context: StaffContext = {
      buildingId,
      staffId: id as StaffId,
      role: seed.role ?? 'manager',
      scope: { buildingId },
    }
    return { id, email, password, buildingId, context }
  }

  const row = async (id: string) =>
    (
      await db.sql`SELECT status, password_hash, failed_attempts, locked_until, last_login_at FROM identity.staff_account WHERE id = ${id}`
    )[0]

  const signIn = (
    email: string,
    password = PASSWORD,
    extra: { ip?: string; client?: 'web' | 'app'; userAgent?: string } = {},
  ) =>
    identity.useCases.signInStaff.execute({
      email,
      password,
      client: extra.client ?? 'app',
      ip: extra.ip ?? IP,
      userAgent: extra.userAgent ?? 'rms-staff/1.0.0 (iOS 19.1; iPhone17,1)',
    })

  /** The `sid` of the session an access token belongs to. */
  const sidOf = async (accessToken: string) => (await identity.verifier.verify(accessToken)).sid

  /** The commands the relay would deliver: each pending mail command goes to the handler, which sends through the recorder. */
  async function deliverMail(): Promise<SentMail[]> {
    const before = sent.length
    const rows = await db.sql`
      SELECT id, type, aggregate_id, payload, occurred_at FROM identity.outbox_messages
       WHERE published_at IS NULL AND type = 'identity.mail_requested.v1' ORDER BY id`
    for (const pending of rows) {
      const envelope: Envelope = {
        id: pending.id,
        type: pending.type,
        source: 'identity',
        aggregateId: pending.aggregate_id,
        occurredAt: new Date(pending.occurred_at).toISOString(),
        payload: pending.payload,
        headers: {},
      }
      for (const handler of identity.handlers ?? [])
        if (handler.eventType === pending.type) await handler.handle(envelope)
      await db.sql`UPDATE identity.outbox_messages SET published_at = now() WHERE id = ${pending.id}`
    }
    return sent.slice(before)
  }

  const outboxOf = (type: string) =>
    db.sql`SELECT payload, aggregate_id FROM identity.outbox_messages WHERE type = ${type} ORDER BY id`

  return {
    db,
    database,
    clock,
    ids,
    identity,
    config,
    hasher,
    sent,
    secretBox,
    seedStaff,
    row,
    signIn,
    sidOf,
    deliverMail,
    outboxOf,
    admin,
    async close() {
      await database.close()
      await admin.end()
      await db.drop()
    },
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>

/** The raw token of the link in a mail (`…/reset?token=…` or `…/invite?token=…`). */
export const linkTokenOf = (mail: SentMail): string => {
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1]
  if (!token) throw new Error(`no link in: ${mail.text}`)
  return token
}

/** The six-digit code in a step-up mail. */
export const codeOf = (mail: SentMail): string => {
  const code = /\b(\d{6})\b/.exec(mail.text)?.[1]
  if (!code) throw new Error(`no code in: ${mail.text}`)
  return code
}
