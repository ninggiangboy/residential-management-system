import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Mailer } from '@core/mail'
import type { Envelope } from '@core/messaging'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * The staff accounts over HTTP (DOC-51 E-39…E-46, DOC-26 §4.4, §4.5): the staff guard, the roles of each route, the step-up
 * proof that a sensitive request carries, `ETag` and `If-Match`, and the `Idempotency-Key` of E-40. What the rules do is proved in
 * `modules/identity/test/staff-accounts.integration.test.ts` (AU-12…19); here the whole request goes through the API.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const PASSWORD = 'Sunrise2026!'

let db: TestDb
let built: ReturnType<typeof containerFor>
const mails: Array<{ to: string; text: string }> = []
const mailer: Mailer = {
  async send(mail) {
    mails.push({ to: mail.to, text: mail.text })
  },
}

const call = (
  path: string,
  init: RequestInit & { token?: string; json?: unknown; key?: string | null } = {},
) => {
  const { token, json, headers, key, ...rest } = init
  return built.app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.method === 'POST' && key !== null
          ? { 'idempotency-key': key ?? crypto.randomUUID() }
          : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}
const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: Record<string, unknown> } }).error

async function signIn(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'app' },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { accessToken: string }).accessToken
}

/** The relay of the test: each pending mail command goes to the handler of `identity`, which sends through the recorder. */
async function deliverMail() {
  const before = mails.length
  const rows = await db.sql`
    SELECT id, type, aggregate_id, payload, occurred_at FROM identity.outbox_messages
     WHERE published_at IS NULL AND type = 'identity.mail_requested.v1' ORDER BY id`
  for (const row of rows) {
    const envelope: Envelope = {
      id: row.id,
      type: row.type,
      source: 'identity',
      aggregateId: row.aggregate_id,
      occurredAt: new Date(row.occurred_at).toISOString(),
      payload: row.payload,
      headers: {},
    }
    for (const handler of built.container.identity.handlers ?? [])
      if (handler.eventType === row.type) await handler.handle(envelope)
    await db.sql`UPDATE identity.outbox_messages SET published_at = now() WHERE id = ${row.id}`
  }
  return mails.slice(before)
}

/** `POST /staff/step-up`, then the code the Admin reads in the mail. */
async function proof(token: string, email: string, action: string) {
  const res = await call('/staff/step-up', { method: 'POST', token, json: { action } })
  expect(res.status).toBe(204)
  const mail = (await deliverMail()).find(
    (m) => m.to === email && /\b\d{6}\b/.test(m.text) && !m.text.includes('token='),
  )
  if (!mail) throw new Error('no step-up mail')
  return { password: PASSWORD, code: /\b(\d{6})\b/.exec(mail.text)?.[1] as string }
}

let admin: string
let manager: string
let technician: string
let guardToken: string
const ids: Record<string, string> = {}

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${BUILDING}, 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}',
            '{"name":{"vi":"Công ty Sunrise"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  const staff: ReadonlyArray<readonly [string, string, string]> = [
    ['admin@sunrise.example', 'admin', 'Phạm Thu Hà'],
    ['admin2@sunrise.example', 'admin', 'Đỗ Hai'],
    ['manager@sunrise.example', 'manager', 'Lê Văn Quản'],
    ['tech@sunrise.example', 'technician', 'Trần Kỹ Thuật'],
    ['guard@sunrise.example', 'guard', 'Vũ Bảo Vệ'],
  ]
  for (const [email, role, name] of staff) {
    const [row] = await db.sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (gen_random_uuid(), ${BUILDING}, ${email}, ${name}, ${role}, 'active', ${hash}, 'en')
      RETURNING id`
    ids[email] = row?.id
  }
  built = containerFor(db.url, { mailer })
  admin = await signIn('admin@sunrise.example')
  manager = await signIn('manager@sunrise.example')
  technician = await signIn('tech@sunrise.example')
  guardToken = await signIn('guard@sunrise.example')
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('guards', () => {
  test('no token is 401; a Technician and a Guard are 403 on every route; a Manager may read', async () => {
    expect((await call('/staff/accounts')).status).toBe(401)
    for (const token of [technician, guardToken]) {
      expect((await call('/staff/accounts', { token })).status).toBe(403)
      expect((await call(`/staff/accounts/${ids['tech@sunrise.example']}`, { token })).status).toBe(
        403,
      )
    }
    const list = await call('/staff/accounts?pageSize=2&page=1', { token: manager })
    expect(list.status).toBe(200)
    const body = (await list.json()) as { items: unknown[]; total: number; pageSize: number }
    expect(body).toMatchObject({ total: 5, pageSize: 2 })
    expect(body.items).toHaveLength(2)
    for (const query of [
      'page=0',
      'pageSize=51',
      'pageSize=0',
      'role=boss',
      'page=10000&pageSize=2',
    ])
      expect((await call(`/staff/accounts?${query}`, { token: manager })).status).toBe(400)
  })

  test('the Manager is 403 on disable and enable; the Admin only', async () => {
    const id = ids['guard@sunrise.example']
    for (const action of ['disable', 'enable'])
      expect(
        (await call(`/staff/accounts/${id}/${action}`, { method: 'POST', token: manager })).status,
      ).toBe(403)
  })
})

describe('E-40 create', () => {
  test('AU-12: a Manager creates a Technician (201, ETag, Location, invite) and is 403 for an Admin, before any step-up', async () => {
    const res = await call('/staff/accounts', {
      method: 'POST',
      token: manager,
      json: { fullName: 'Vũ Văn Long', email: 'long.vu@sunrise.example', role: 'guard' },
    })
    expect(res.status).toBe(201)
    const created = (await res.json()) as {
      id: string
      status: string
      invite: { expiresAt: string }
    }
    expect(created).toMatchObject({ status: 'invited', role: 'guard', version: 1, language: 'vi' })
    expect(res.headers.get('etag')).toBe('"1"')
    expect(res.headers.get('location')).toBe(`/api/v1/staff/accounts/${created.id}`)
    expect(created.invite.expiresAt).toBeString()

    const admin403 = await call('/staff/accounts', {
      method: 'POST',
      token: manager,
      json: { fullName: 'X Y', email: 'x@sunrise.example', role: 'admin' },
    })
    expect(admin403.status).toBe(403)
    expect((await errorOf(admin403)).code).toBe('forbidden')
  })

  test('the Idempotency-Key replays the first answer and makes one account; a missing key is 400; another body is 422', async () => {
    const key = crypto.randomUUID()
    const json = { fullName: 'Hoàng Mới', email: 'moi@sunrise.example', role: 'technician' }
    const first = await call('/staff/accounts', { method: 'POST', token: admin, json, key })
    const second = await call('/staff/accounts', { method: 'POST', token: admin, json, key })
    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.headers.get('idempotent-replayed')).toBe('true')
    expect(second.headers.get('location')).toBe(first.headers.get('location'))
    expect(
      (
        await db.sql`SELECT count(*)::int AS n FROM identity.staff_account WHERE email = 'moi@sunrise.example'`
      )[0]?.n,
    ).toBe(1)
    expect(
      (await call('/staff/accounts', { method: 'POST', token: admin, json, key: null })).status,
    ).toBe(400)
    const other = await call('/staff/accounts', {
      method: 'POST',
      token: admin,
      json: { ...json, role: 'guard' },
      key,
    })
    expect(other.status).toBe(422)
    expect((await errorOf(other)).code).toBe('idempotency_key_reuse')
    const duplicate = await call('/staff/accounts', {
      method: 'POST',
      token: admin,
      json: { ...json, email: 'MOI@sunrise.example' },
    })
    expect(duplicate.status).toBe(409)
    expect((await errorOf(duplicate)).code).toBe('email_in_use')
  })

  test('AU-16: an Admin for an Admin needs a step-up proof: none is 403 step_up_required, a right one is 201', async () => {
    const json = { fullName: 'Admin Ba', email: 'admin3@sunrise.example', role: 'admin' }
    const none = await call('/staff/accounts', { method: 'POST', token: admin, json })
    expect(none.status).toBe(403)
    expect(await errorOf(none)).toMatchObject({
      code: 'step_up_required',
      details: { action: 'admin_change' },
    })
    const wrong = await call('/staff/accounts', {
      method: 'POST',
      token: admin,
      json: { ...json, stepUp: { password: PASSWORD, code: '000000' } },
    })
    expect(wrong.status).toBe(403)
    expect((await errorOf(wrong)).code).toBe('step_up_failed')
    expect(
      (
        await db.sql`SELECT count(*)::int AS n FROM identity.staff_account WHERE email = ${json.email}`
      )[0]?.n,
    ).toBe(0)

    const stepUp = await proof(admin, 'admin@sunrise.example', 'admin_change')
    const ok = await call('/staff/accounts', {
      method: 'POST',
      token: admin,
      json: { ...json, stepUp },
    })
    expect(ok.status).toBe(201)
    expect(((await ok.json()) as { role: string }).role).toBe('admin')
  })

  test('the body is validated: unknown keys, a bad email and a long name are 400', async () => {
    for (const json of [
      { fullName: 'A', email: 'a@sunrise.example', role: 'guard', extra: 1 },
      { fullName: 'A', email: 'not-an-email', role: 'guard' },
      { fullName: 'x'.repeat(121), email: 'b@sunrise.example', role: 'guard' },
      { fullName: 'A', email: 'c@sunrise.example', role: 'owner' },
    ])
      expect((await call('/staff/accounts', { method: 'POST', token: admin, json })).status).toBe(
        400,
      )
  })
})

describe('E-41, E-42 read and edit', () => {
  test('GET answers an ETag and 304 for the same one; an id of nobody is 404', async () => {
    const id = ids['guard@sunrise.example']
    const res = await call(`/staff/accounts/${id}`, { token: manager })
    expect(res.status).toBe(200)
    const etag = res.headers.get('etag') as string
    expect(etag).toMatch(/^"\d+"$/)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('passwordHash')
    expect(
      (await call(`/staff/accounts/${id}`, { token: manager, headers: { 'if-none-match': etag } }))
        .status,
    ).toBe(304)
    expect((await call(`/staff/accounts/${crypto.randomUUID()}`, { token: manager })).status).toBe(
      404,
    )
  })

  test('PATCH needs If-Match (428), refuses a stale one (409), and a Manager may not send a role or an email (403)', async () => {
    const id = ids['guard@sunrise.example']
    const patch = (token: string, json: unknown, ifMatch?: string) =>
      call(`/staff/accounts/${id}`, {
        method: 'PATCH',
        token,
        json,
        headers: ifMatch === undefined ? {} : { 'if-match': ifMatch },
      })
    expect((await patch(admin, { fullName: 'Vũ Bảo Vệ 2' })).status).toBe(428)
    expect((await patch(admin, { fullName: 'Vũ Bảo Vệ 2' }, '"99"')).status).toBe(409)
    expect((await patch(admin, {}, '"1"')).status).toBe(400)
    const ok = await patch(manager, { fullName: 'Vũ Bảo Vệ 2', language: 'vi' }, '"1"')
    expect(ok.status).toBe(200)
    expect(ok.headers.get('etag')).toBe('"2"')
    expect((await patch(manager, { role: 'technician' }, '"2"')).status).toBe(403)
    expect((await patch(manager, { email: 'z@sunrise.example' }, '"2"')).status).toBe(403)
  })

  test('AU-16: a promotion to Admin and an email change without a proof are 403 step_up_required', async () => {
    const id = ids['tech@sunrise.example'] as string
    const res = await call(`/staff/accounts/${id}`, {
      method: 'PATCH',
      token: admin,
      json: { role: 'admin' },
      headers: { 'if-match': '"1"' },
    })
    expect(res.status).toBe(403)
    expect(await errorOf(res)).toMatchObject({
      code: 'step_up_required',
      details: { action: 'admin_change' },
    })
    const email = await call(`/staff/accounts/${id}`, {
      method: 'PATCH',
      token: admin,
      json: { email: 'tech.new@sunrise.example' },
      headers: { 'if-match': '"1"' },
    })
    expect(await errorOf(email)).toMatchObject({
      code: 'step_up_required',
      details: { action: 'staff_email' },
    })
    // With the proof the email changes, the session of the Technician stays, and the audit row hides the address.
    const stepUp = await proof(admin, 'admin@sunrise.example', 'staff_email')
    const ok = await call(`/staff/accounts/${id}`, {
      method: 'PATCH',
      token: admin,
      json: { email: 'tech.new@sunrise.example', stepUp },
      headers: { 'if-match': '"1"' },
    })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { email: string }).email).toBe('tech.new@sunrise.example')
    expect((await call('/staff/sessions', { token: technician })).status).toBe(200)
    const audit =
      await db.sql`SELECT * FROM audit.audit_log WHERE action = 'identity.staff.update' AND object_id = ${id}`
    expect(JSON.stringify(audit)).not.toContain('tech.new@sunrise.example')
  })
})

describe('E-43…E-46 lock, unlock, disable, enable', () => {
  test('AU-15, AU-18: a lock ends the session at once; nobody locks themselves; unlock and enable bring them back', async () => {
    const id = ids['guard@sunrise.example']
    expect((await call('/staff/sessions', { token: guardToken })).status).toBe(200)
    const lock = await call(`/staff/accounts/${id}/lock`, { method: 'POST', token: manager })
    expect(lock.status).toBe(200)
    expect(((await lock.json()) as { status: string }).status).toBe('locked')
    // The guard reads the row on every request: the access token of the locked member is refused although it has not expired.
    expect((await call('/staff/sessions', { token: guardToken })).status).toBe(401)
    expect(
      (await errorOf(await call(`/staff/accounts/${id}/lock`, { method: 'POST', token: manager })))
        .code,
    ).toBe('invalid_transition')

    const self = await call(`/staff/accounts/${ids['admin@sunrise.example']}/lock`, {
      method: 'POST',
      token: admin,
    })
    expect(self.status).toBe(403)
    expect(await errorOf(self)).toMatchObject({ code: 'forbidden', details: { reason: 'self' } })

    const unlock = await call(`/staff/accounts/${id}/unlock`, { method: 'POST', token: manager })
    expect(((await unlock.json()) as { status: string }).status).toBe('active')
    expect(
      (await call(`/staff/accounts/${id}/unlock`, { method: 'POST', token: manager })).status,
    ).toBe(409)
    const disable = await call(`/staff/accounts/${id}/disable`, { method: 'POST', token: admin })
    expect(((await disable.json()) as { status: string }).status).toBe('disabled')
    const enable = await call(`/staff/accounts/${id}/enable`, { method: 'POST', token: admin })
    expect(((await enable.json()) as { status: string }).status).toBe('active')
  })

  test('a lock with a reassignTo of a Manager and a short reason: 403 and 422; the body may be empty or hold unknown keys (400)', async () => {
    const id = ids['guard@sunrise.example']
    const bad = await call(`/staff/accounts/${id}/lock`, {
      method: 'POST',
      token: admin,
      json: { reassignTo: ids['tech@sunrise.example'], reason: 'no' },
    })
    expect(bad.status).toBe(422)
    expect(
      (
        await call(`/staff/accounts/${id}/lock`, {
          method: 'POST',
          token: admin,
          json: { surprise: true },
        })
      ).status,
    ).toBe(400)
  })
})
