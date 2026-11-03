import { createPrivateKey, sign } from 'node:crypto'
import { createLogger } from '@core/telemetry'
import { FakeStorage } from '@core/testing'
import type { BuildingId, StaffContext, StaffId } from '@rms/shared-types'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { buildApp } from '../../src/app'
import { loadAppConfig } from '../../src/bootstrap/config'
import { type ContainerOverrides, createContainer } from '../../src/bootstrap/container'
import type { Actor } from './actors'

/**
 * The fixtures of the matrix (DOC-39 §4.2): the sample building B1 with U1 `A-1508` and U2 `A-1509`, a second building B2 with
 * U3, and one real token per actor, issued through the sign-in routes. The database is seeded once and copied per route, so a
 * route that changes data never changes what the next route sees (EXP-10 §5 step 4).
 */

const uuid = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}`
export const PASSWORD = 'Sunrise2026!'
const OTP_CODE = '123456'

export const IDS = {
  B1: uuid(1) as BuildingId,
  B2: uuid(2) as BuildingId,
  U1: uuid(11),
  U2: uuid(12),
  U3: uuid(13),
  /** A technician of B1 and one of B2: the objects of the `/staff/accounts/{id}` routes. */
  staffTarget: uuid(21),
  staffTargetB2: uuid(22),
  /** The import jobs of B1 and B2. */
  importB1: uuid(31),
  importB2: uuid(32),
  /** A resident of U3 (B2) and her membership. */
  residentB2: uuid(41),
  membershipB2: uuid(42),
  /** A unit type of B1 and one of B2: the objects of the `/staff/unit-types/{id}` routes (DR-314). */
  unitTypeB1: uuid(61),
  unitTypeB2: uuid(62),
} as const

const STAFF: ReadonlyArray<{
  actor: Actor
  id: string
  email: string
  role: 'admin' | 'manager' | 'technician' | 'guard'
  building: 'B1' | 'B2'
}> = [
  { actor: 'staff.admin', id: uuid(51), email: 'admin@b1.example', role: 'admin', building: 'B1' },
  {
    actor: 'staff.manager',
    id: uuid(52),
    email: 'manager@b1.example',
    role: 'manager',
    building: 'B1',
  },
  {
    actor: 'staff.technician',
    id: uuid(53),
    email: 'tech@b1.example',
    role: 'technician',
    building: 'B1',
  },
  { actor: 'staff.guard', id: uuid(54), email: 'guard@b1.example', role: 'guard', building: 'B1' },
  {
    actor: 'staff.disabled',
    id: uuid(55),
    email: 'disabled@b1.example',
    role: 'manager',
    building: 'B1',
  },
  {
    actor: 'staff.admin_b2',
    id: uuid(56),
    email: 'admin@b2.example',
    role: 'admin',
    building: 'B2',
  },
]

const ADMIN2 = { id: uuid(57), email: 'admin2@b1.example' }

/** The resident actors: the unit and member type of the membership they hold (`null`: no membership of U1). */
const RESIDENTS: ReadonlyArray<{
  actor: Actor
  id: string
  phone: string
  unit: 'U1' | 'U2'
  type: 'owner' | 'family' | 'tenant' | 'helper'
  canPay: boolean
  locked?: true
}> = [
  {
    actor: 'res.owner',
    id: uuid(61),
    phone: '+84903000061',
    unit: 'U1',
    type: 'owner',
    canPay: false,
  },
  {
    actor: 'res.family',
    id: uuid(62),
    phone: '+84903000062',
    unit: 'U1',
    type: 'family',
    canPay: false,
  },
  {
    actor: 'res.tenant_pay',
    id: uuid(63),
    phone: '+84903000063',
    unit: 'U1',
    type: 'tenant',
    canPay: true,
  },
  {
    actor: 'res.tenant_nopay',
    id: uuid(64),
    phone: '+84903000064',
    unit: 'U1',
    type: 'tenant',
    canPay: false,
  },
  {
    actor: 'res.helper',
    id: uuid(65),
    phone: '+84903000065',
    unit: 'U1',
    type: 'helper',
    canPay: false,
  },
  {
    actor: 'res.locked',
    id: uuid(66),
    phone: '+84903000066',
    unit: 'U1',
    type: 'family',
    canPay: false,
    locked: true,
  },
  {
    actor: 'res.terms_pending',
    id: uuid(67),
    phone: '+84903000067',
    unit: 'U1',
    type: 'family',
    canPay: false,
  },
  {
    actor: 'res.stranger',
    id: uuid(68),
    phone: '+84903000068',
    unit: 'U2',
    type: 'family',
    canPay: false,
  },
]

export interface World {
  /** The seeded database; copy it with `cloneDatabase`. Its pool is closed. */
  db: TestDb
  /** `null` for `anon`. */
  tokens: Record<Actor, string | null>
  /** The `sid` claim of each token: the session a `DELETE …/sessions/{id}` names. */
  sessions: Record<Actor, string | null>
  /** The account id of each token actor. */
  accounts: Partial<Record<Actor, string>>
  /** The membership of each resident actor. */
  memberships: Partial<Record<Actor, string>>
  /** A pending upload of each staff actor (the object of `POST /staff/uploads/{id}/verify`). */
  files: Partial<Record<Actor, string>>
  /** A pending `import` upload of each staff actor (the file of `POST /staff/imports`). */
  importFiles: Partial<Record<Actor, string>>
  /** One unread inbox entry of each resident actor (in the unit) and of each staff actor (E-178, E-179: `POST …/inbox/{id}/read`). */
  inbox: Partial<Record<Actor, string>>
  /** A second Admin of B1, who is not an actor: the step-up cases need another Admin's code and a notice for each Admin. */
  admin2: { id: string; email: string; token: string }
}

/** The environment of a container built over a matrix database: the demo OTP code and no sign-in throttle in the way. */
const worldEnv = (databaseUrl: string) => ({
  ...process.env,
  APP_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: databaseUrl,
  OTP_PER_IP_PER_HOUR: '100000',
  OTP_PER_PHONE_PER_HOUR: '100000',
  TRUSTED_PROXY_HOPS: '0',
})

/** A container and its app over `databaseUrl`; `overrides` is the test composition root's seam (DR-99). */
export function appOver(databaseUrl: string, overrides: ContainerOverrides = {}) {
  const config = loadAppConfig(worldEnv(databaseUrl) as Record<string, string | undefined>)
  // The run needs no network (DOC-39 §4.5): the object store is a fake, so E-37 never waits for a store that CI does not run.
  const container = createContainer(config, createLogger('silent'), {
    storage: new FakeStorage(),
    ...overrides,
  })
  return { container, app: buildApp(container) }
}

const handle =
  (app: { handle(request: Request): Promise<Response> | Response }) =>
  (path: string, init: RequestInit & { json?: unknown; token?: string } = {}) => {
    const { json, token, headers, ...rest } = init
    return app.handle(
      new Request(`http://localhost/api/v1${path}`, {
        ...rest,
        headers: {
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: json === undefined ? undefined : JSON.stringify(json),
      }),
    )
  }

const claimsOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1] as string, 'base64url').toString()) as { sid: string }

/** An access token that expired an hour ago, signed with the key ring of the environment (DOC-26 §3.1): ES256, `typ at+jwt`, `iss rms`. */
function expiredToken(accountId: string): string {
  const ring = JSON.parse(process.env.JWT_KEYS ?? '{}') as Record<string, string>
  const kid = Object.keys(ring).at(-1)
  if (!kid) throw new Error('JWT_KEYS holds no key: run `bun run keys:generate`')
  const issuedAt = Math.floor(Date.now() / 1000) - 7200
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const signing = `${part({ alg: 'ES256', typ: 'at+jwt', kid })}.${part({
    kind: 'resident',
    sid: crypto.randomUUID(),
    iss: 'rms',
    sub: accountId,
    iat: issuedAt,
    exp: issuedAt + 900,
  })}`
  const signature = sign('sha256', Buffer.from(signing), {
    key: createPrivateKey(ring[kid] as string),
    dsaEncoding: 'ieee-p1363',
  })
  return `${signing}.${signature.toString('base64url')}`
}

export async function buildWorld(): Promise<World> {
  const db = await cloneTemplate('empty')
  const { sql } = db

  for (const [id, code, name] of [
    [IDS.B1, 'SUNRISE-A', 'Sunrise A'],
    [IDS.B2, 'SUNRISE-B', 'Sunrise B'],
  ] as const) {
    await sql`
      INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
      VALUES (${id}, ${code}, ${JSON.stringify({ vi: name, en: name })}::text::jsonb,
              '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false)`
    await sql`INSERT INTO building.building_setting (building_id) VALUES (${id})`
  }
  for (const [id, building, code] of [
    [IDS.U1, IDS.B1, 'A-1508'],
    [IDS.U2, IDS.B1, 'A-1509'],
    [IDS.U3, IDS.B2, 'B-0101'],
  ] as const)
    await sql`
      INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
      VALUES (${id}, ${building}, ${code}, 15, 'occupied')`

  for (const [id, building, code] of [
    [IDS.unitTypeB1, IDS.B1, 'studio'],
    [IDS.unitTypeB2, IDS.B2, 'studio'],
  ] as const)
    await sql`
      INSERT INTO residency.unit_type (id, building_id, code, name)
      VALUES (${id}, ${building}, ${code}, '{"vi":"Studio"}'::jsonb)`

  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  const staffRows = [
    ...STAFF.map((s) => ({ id: s.id, email: s.email, role: s.role, building: s.building })),
    { id: ADMIN2.id, email: ADMIN2.email, role: 'admin' as const, building: 'B1' as const },
    {
      id: IDS.staffTarget,
      email: 'target@b1.example',
      role: 'technician' as const,
      building: 'B1' as const,
    },
    {
      id: IDS.staffTargetB2,
      email: 'target@b2.example',
      role: 'technician' as const,
      building: 'B2' as const,
    },
  ]
  for (const row of staffRows)
    await sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (${row.id}, ${IDS[row.building]}, ${row.email}, ${row.email}, ${row.role}, 'active', ${hash}, 'en')`

  const residents = [
    ...RESIDENTS.map((r) => ({ ...r, building: 'B1' as const, unitId: IDS[r.unit] })),
  ]
  const memberships: Partial<Record<Actor, string>> = {}
  for (const r of residents) {
    memberships[r.actor] = crypto.randomUUID()
    await sql`
      INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
      VALUES (${r.id}, ${r.phone}, ${r.actor}, true)`
    await sql`
      INSERT INTO residency.resident_profile (building_id, account_id, full_name)
      VALUES (${IDS.B1}, ${r.id}, ${r.actor})`
    await sql`
      INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, can_pay, status, locked_by, added_by_kind, added_by)
      VALUES (${memberships[r.actor] as string}, ${IDS.B1}, ${r.id}, ${r.unitId}, ${r.type}, ${r.canPay}, ${r.locked ? 'locked' : 'active'},
              ${r.locked ? 'manager' : null}, 'staff', ${STAFF[0]?.id as string})`
  }
  await sql`
    INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
    VALUES (${IDS.residentB2}, '+84903000041', 'Resident of B2', true)`
  await sql`
    INSERT INTO residency.resident_profile (building_id, account_id, full_name)
    VALUES (${IDS.B2}, ${IDS.residentB2}, 'Resident of B2')`
  await sql`
    INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, status, added_by_kind, added_by)
    VALUES (${IDS.membershipB2}, ${IDS.B2}, ${IDS.residentB2}, ${IDS.U3}, 'owner', 'active', 'staff', ${STAFF[5]?.id as string})`

  const files: Partial<Record<Actor, string>> = {}
  const importFiles: Partial<Record<Actor, string>> = {}
  for (const s of STAFF)
    for (const [bucket, module, purpose, ext, mime] of [
      [files, 'identity', 'avatar', 'png', 'image/png'],
      [
        importFiles,
        'residency',
        'import',
        'xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ],
    ] as const) {
      const id = crypto.randomUUID()
      bucket[s.actor] = id
      await sql`
        INSERT INTO building.file_object (id, building_id, module, purpose, object_key, mime, size, account_kind, account_id)
        VALUES (${id}, ${IDS[s.building]}, ${module}, ${purpose},
                ${`${module}/${IDS[s.building]}/${purpose}/2026/10/${id}.${ext}`}, ${mime}, 1000, 'staff', ${s.id})`
    }

  const inbox: Partial<Record<Actor, string>> = {}
  for (const who of [
    ...STAFF.map((s) => ({
      actor: s.actor,
      id: s.id,
      kind: 'staff',
      building: IDS[s.building],
      unit: null,
    })),
    ...residents.map((r) => ({
      actor: r.actor,
      id: r.id,
      kind: 'resident',
      building: IDS.B1,
      unit: r.unitId,
    })),
  ]) {
    const id = crypto.randomUUID()
    inbox[who.actor] = id
    await sql`
      INSERT INTO notification.inbox_entry (id, building_id, account_kind, account_id, unit_id, template_key, source_kind, source_id, dedupe_id)
      VALUES (${id}, ${who.building}, ${who.kind}, ${who.id}, ${who.unit}, 'fee.reminder', 'debt_reminder', ${crypto.randomUUID()}, ${crypto.randomUUID()})`
  }

  const emptyResult = JSON.stringify({
    counts: { rows: 0, valid: 0, errors: 0, warnings: 0 },
    validRows: [],
    issues: [],
    issuesTruncated: false,
  })
  for (const [id, building, creator] of [
    [IDS.importB1, IDS.B1, STAFF[0]?.id],
    [IDS.importB2, IDS.B2, STAFF[5]?.id],
  ] as const)
    await sql`
      INSERT INTO residency.import_job (id, building_id, kind, status, file_key, file_name, result, created_by, expires_at)
      VALUES (${id}, ${building}, 'unit_owner', 'failed', ${`imports/${id}.xlsx`}, 'units.xlsx', ${emptyResult}::text::jsonb,
              ${creator as string}, now() + interval '1 day')`

  const { container, app } = appOver(db.url)
  const call = handle(app)
  const tokens = Object.fromEntries(
    (['anon', 'tok.expired'] as const).map((a) => [a, null]),
  ) as Record<Actor, string | null>

  for (const s of STAFF) {
    const res = await call('/auth/staff/login', {
      method: 'POST',
      json: { email: s.email, password: PASSWORD, client: 'app' },
    })
    if (res.status !== 200)
      throw new Error(`staff login of ${s.actor}: ${res.status} ${await res.text()}`)
    tokens[s.actor] = ((await res.json()) as { accessToken: string }).accessToken
  }
  const admin2Login = await call('/auth/staff/login', {
    method: 'POST',
    json: { email: ADMIN2.email, password: PASSWORD, client: 'app' },
  })
  const admin2Token = ((await admin2Login.json()) as { accessToken: string }).accessToken
  for (const r of residents) {
    const requested = await call('/auth/otp', { method: 'POST', json: { phone: r.phone } })
    const { challengeId } = (await requested.json()) as { challengeId: string }
    const verified = await call('/auth/otp/verify', {
      method: 'POST',
      json: { challengeId, code: OTP_CODE },
    })
    if (verified.status !== 200)
      throw new Error(`OTP sign-in of ${r.actor}: ${verified.status} ${await verified.text()}`)
    tokens[r.actor] = ((await verified.json()) as { accessToken: string }).accessToken
  }
  tokens['tok.expired'] = expiredToken(RESIDENTS[0]?.id as string)

  // The terms gate (DOC-35 §9.3): a version is published, and every member but `res.terms_pending` accepts it.
  const admin: StaffContext = {
    buildingId: IDS.B1,
    staffId: STAFF[0]?.id as StaffId,
    role: 'admin',
    scope: { buildingId: IDS.B1 },
  }
  const version = await container.building.useCases.publishTerms.execute(admin, {
    kind: 'terms',
    text: { vi: '## Điều khoản\n\nNội dung', en: '## Terms\n\nBody' },
  })
  for (const r of residents) {
    if (r.actor === 'res.terms_pending') continue
    const res = await call('/me/terms', {
      method: 'POST',
      token: tokens[r.actor] as string,
      json: { versionIds: [version.id] },
    })
    if (res.status !== 204)
      throw new Error(`terms of ${r.actor}: ${res.status} ${await res.text()}`)
  }

  // A token issued before the account was disabled is the actor `staff.disabled` (DOC-39 §4.2).
  await sql`UPDATE identity.staff_account SET status = 'disabled' WHERE id = ${STAFF[4]?.id as string}`

  const sessions = Object.fromEntries(
    Object.entries(tokens).map(([actor, token]) => [actor, token ? claimsOf(token).sid : null]),
  ) as Record<Actor, string | null>
  const accounts: Partial<Record<Actor, string>> = {
    ...Object.fromEntries(STAFF.map((s) => [s.actor, s.id])),
    ...Object.fromEntries(RESIDENTS.map((r) => [r.actor, r.id])),
  }
  await container.close()
  await sql.end({ timeout: 2 })
  return {
    db,
    tokens,
    sessions,
    accounts,
    memberships,
    files,
    importFiles,
    inbox,
    admin2: { ...ADMIN2, token: admin2Token },
  }
}
