import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Envelope } from '@core/messaging'
import type { JobContext } from '@core/runtime'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import { containerFor } from './support'

/**
 * The notification core over the whole container against a real PostgreSQL (DOC-31 §4 to §7, NT-10…NT-81): the producers' rules
 * create entries and push requests, the resident and staff inbox endpoints read and mark them, the device endpoints keep one
 * token per session, `SendExpoPush` and the two jobs run their statements, and a repeat of any handler changes nothing.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const PASSWORD = 'Sunrise2026!'

let db: TestDb
let built: ReturnType<typeof containerFor>
let phoneCounter = 0

const call = (
  path: string,
  init: RequestInit & { token?: string; json?: unknown; unit?: string } = {},
) => {
  const { token, json, unit, headers, ...rest } = init
  return built.app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(unit ? { 'x-unit-id': unit } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}
const bodyOf = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T

interface Resident {
  id: string
  token: string
  sid: string
}
async function resident(name: string): Promise<Resident> {
  phoneCounter++
  const phone = `+84904${String(phoneCounter).padStart(6, '0')}`
  const id = crypto.randomUUID()
  await db.sql`INSERT INTO identity.resident_account (id, phone, display_name, is_demo) VALUES (${id}, ${phone}, ${name}, true)`
  return { id, token: '', sid: '' }
}
async function signInResident(account: Resident): Promise<Resident> {
  const [row] = await db.sql<
    { phone: string }[]
  >`SELECT phone FROM identity.resident_account WHERE id = ${account.id}`
  const requested = await call('/auth/otp', { method: 'POST', json: { phone: row?.phone } })
  const { challengeId } = await bodyOf<{ challengeId: string }>(requested)
  const verified = await call('/auth/otp/verify', {
    method: 'POST',
    json: { challengeId, code: '123456' },
  })
  expect(verified.status).toBe(200)
  const { accessToken } = await bodyOf<{ accessToken: string }>(verified)
  const sid = JSON.parse(atob(accessToken.split('.')[1] ?? '')).sid as string
  return { ...account, token: accessToken, sid }
}
async function staffToken(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'app' },
  })
  expect(res.status).toBe(200)
  return (await bodyOf<{ accessToken: string }>(res)).accessToken
}
async function member(accountId: string, unitId: string, type: string) {
  await db.sql`
    INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, can_pay, added_by_kind, added_by)
    VALUES (${crypto.randomUUID()}, ${BUILDING}, ${accountId}, ${unitId}, ${type}, false, 'staff', ${crypto.randomUUID()})`
}

const handlerOf = (name: string) => {
  const handler = built.container.notification.handlers?.find((h) => h.name === name)
  if (!handler) throw new Error(`no handler ${name}`)
  return handler
}
const envelope = (
  type: string,
  payload: Record<string, unknown>,
  id = crypto.randomUUID(),
): Envelope => ({
  id,
  type,
  source: type.split('.')[0] ?? 'test',
  aggregateId: crypto.randomUUID(),
  occurredAt: new Date().toISOString(),
  payload,
  headers: {} as Envelope['headers'],
})
const count = async (table: string, where = 'true') =>
  Number((await db.sql.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]?.n)
const pushMessages = async () =>
  (await db.sql`SELECT id, payload, occurred_at FROM notification.outbox_messages WHERE type = 'notification.push_requested.v1' ORDER BY occurred_at`) as unknown as Array<{
    id: string
    payload: {
      recipients: Array<{ accountId: string; unitId: string | null }>
      route: string
      channel: string
    }
  }>

let u1: string
let u2: string
let an: Resident
let binh: Resident
let chi: Resident
let dung: Resident
let manager: string
let technician: string
let managerId: string
let page: { items: Array<Record<string, any>>; nextCursor: string | null; unreadCount: number }

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${BUILDING}, 'SUNRISE-A', '{"vi":"Chung cư","en":"Apartments"}', '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}',
            '12 Nguyễn Huệ', '1900 1234', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  managerId = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (${managerId}, ${BUILDING}, 'manager@sunrise.example', 'Lê Minh', 'manager', 'active', ${hash}, 'vi'),
           (gen_random_uuid(), ${BUILDING}, 'tech@sunrise.example', 'Võ Kỹ Thuật', 'technician', 'active', ${hash}, 'vi')`
  u1 = crypto.randomUUID()
  u2 = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
    VALUES (${u1}, ${BUILDING}, 'A-1508', 15, 'occupied'), (${u2}, ${BUILDING}, 'A-1509', 15, 'occupied')`
  an = await resident('Nguyễn Văn An')
  binh = await resident('Trần Thị Bình')
  chi = await resident('Chị Giúp Việc')
  dung = await resident('Nguyễn Dũng')
  await member(an.id, u1, 'owner')
  await member(binh.id, u1, 'tenant')
  await member(chi.id, u1, 'helper')
  await member(dung.id, u1, 'family')
  built = containerFor(db.url, {}, { OTP_PER_IP_PER_HOUR: '1000', TRUSTED_PROXY_HOPS: '0' })
  an = await signInResident(an)
  binh = await signInResident(binh)
  chi = await signInResident(chi)
  manager = await staffToken('manager@sunrise.example')
  technician = await staffToken('tech@sunrise.example')
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

const batchPublished = (batchId: string, unitIds: string[], code = 'PH-2610-01') => ({
  buildingId: BUILDING,
  batchId,
  code,
  feeMonth: '2026-10',
  dueDate: '2026-11-20',
  part: 1,
  parts: 1,
  unitIds,
})

describe('creating entries (DOC-31 §4.1)', () => {
  const batchOne = crypto.randomUUID()

  test('NT-10 and NT-11: a batch gives entries to owner, family and tenant, none to the helper, and a repeat writes nothing', async () => {
    const message = envelope('finance.batch_published.v1', batchPublished(batchOne, [u1]))
    const handler = handlerOf('notification.inbox_on_finance_batch_published')
    await handler.handle(message)
    expect(await count('notification.inbox_entry', `template_key = 'fee.batch_published'`)).toBe(3)
    expect(await count('notification.inbox_entry', `account_id = '${chi.id}'`)).toBe(0)
    const pushes = await pushMessages()
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.payload.recipients).toHaveLength(3)
    expect(pushes[0]?.payload).toMatchObject({ route: '/fees', channel: 'default' })

    await handler.handle(message)
    // A new envelope with the same payload: the dedupe key finds every row, so no entry and no message.
    await handler.handle(envelope('finance.batch_published.v1', batchPublished(batchOne, [u1])))
    expect(await count('notification.inbox_entry', `template_key = 'fee.batch_published'`)).toBe(3)
    expect(await pushMessages()).toHaveLength(1)
  })

  test('NT-12: an owner of two charged units gets one entry per unit and one push with no unit', async () => {
    await member(an.id, u2, 'owner')
    const batch = crypto.randomUUID()
    await handlerOf('notification.inbox_on_finance_batch_published').handle(
      envelope('finance.batch_published.v1', batchPublished(batch, [u1, u2], 'PH-2610-02')),
    )
    expect(
      await count('notification.inbox_entry', `account_id = '${an.id}' AND source_id = '${batch}'`),
    ).toBe(2)
    const pushes = (await pushMessages()).filter((m) =>
      m.payload.recipients.some((r) => r.accountId === an.id),
    )
    const mine = pushes.at(-1)?.payload.recipients.find((r) => r.accountId === an.id)
    expect(mine?.unitId).toBeNull()
  })

  test('NT-16: payment.received pushes on the urgent channel', async () => {
    await handlerOf('notification.inbox_on_finance_payment_posted').handle(
      envelope('finance.payment_posted.v1', {
        buildingId: BUILDING,
        paymentId: crypto.randomUUID(),
        unitId: u1,
        source: 'online',
        payerAccountId: binh.id,
        postedAt: new Date().toISOString(),
      }),
    )
    expect(await count('notification.inbox_entry', `template_key = 'payment.received'`)).toBe(3)
    expect((await pushMessages()).at(-1)?.payload.channel).toBe('urgent')
  })

  test('NT-17, LG-48: an unposted transfer reaches the active managers only, with one staff_inbox_created each', async () => {
    const row = crypto.randomUUID()
    await handlerOf('notification.inbox_on_finance_money_unposted').handle(
      envelope('finance.money_unposted.v1', {
        buildingId: BUILDING,
        kind: 'gateway_event',
        rowId: row,
        outcome: 'amount_short',
        amount: 100,
        receivedAt: new Date().toISOString(),
      }),
    )
    const rows =
      await db.sql`SELECT account_kind, account_id FROM notification.inbox_entry WHERE template_key = 'finance.money_unposted'`
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ account_kind: 'staff', account_id: managerId })
    expect(
      await count('notification.outbox_messages', `type = 'notification.staff_inbox_created.v1'`),
    ).toBeGreaterThanOrEqual(1)
  })

  test('NT-15: a voided charge tells owner, family and tenant of the unit', async () => {
    await handlerOf('notification.inbox_on_finance_charge_voided').handle(
      envelope('finance.charge_voided.v1', {
        buildingId: BUILDING,
        chargeId: crypto.randomUUID(),
        batchId: crypto.randomUUID(),
        unitId: u1,
        feeMonth: '2026-10',
      }),
    )
    expect(await count('notification.inbox_entry', `template_key = 'fee.charge_voided'`)).toBe(3)
  })

  test('NT-18 and NT-19: the step-up notice and a member added create entries; other kinds create none', async () => {
    const before = await count('notification.inbox_entry')
    await handlerOf('notification.inbox_on_identity_mail_requested').handle(
      envelope('identity.mail_requested.v1', {
        buildingId: BUILDING,
        staffId: managerId,
        kind: 'password_reset',
        locale: 'vi',
        params: {},
        secretEnc: null,
        expiresAt: null,
      }),
    )
    expect(await count('notification.inbox_entry')).toBe(before)
    await handlerOf('notification.inbox_on_identity_mail_requested').handle(
      envelope('identity.mail_requested.v1', {
        buildingId: BUILDING,
        staffId: managerId,
        kind: 'step_up_notice',
        locale: 'vi',
        params: { action: 'gateway_config', actorName: 'Lê Minh' },
        secretEnc: null,
        expiresAt: null,
      }),
    )
    expect(await count('notification.inbox_entry', `template_key = 'staff.step_up_done'`)).toBe(1)
    await handlerOf('notification.inbox_on_residency_membership_changed').handle(
      envelope('residency.membership_changed.v1', {
        buildingId: BUILDING,
        unitId: u1,
        membershipId: crypto.randomUUID(),
        accountId: dung.id,
        change: 'type_changed',
        memberType: 'family',
      }),
    )
    expect(await count('notification.inbox_entry', `template_key = 'member.added'`)).toBe(0)
  })
})

describe('reading the inbox (DOC-31 §4.4)', () => {
  test('NT-30: An sees the entries of both units newest first, with the target and the unread count', async () => {
    const res = await call('/me/inbox?limit=2', { token: an.token, unit: u1 })
    expect(res.status).toBe(200)
    page = await bodyOf(res)
    expect(page.items).toHaveLength(2)
    expect(page.nextCursor).not.toBeNull()
    expect(page.unreadCount).toBeGreaterThanOrEqual(4)
    const first = page.items[0]
    expect(first).toHaveProperty('templateKey')
    expect(first).toHaveProperty('target.route')
    expect(JSON.stringify(first)).not.toContain('Phí')
    const second = await bodyOf<typeof page>(
      await call(`/me/inbox?limit=100&cursor=${page.nextCursor}`, { token: an.token, unit: u1 }),
    )
    expect(second.items.length).toBeGreaterThanOrEqual(1)
    expect(new Set([...page.items, ...second.items].map((i) => i.id)).size).toBe(
      page.items.length + second.items.length,
    )
  })

  test('NT-31 and NT-32: the same key and params whatever the language, and the unread count stops at 100', async () => {
    await db.sql`
      INSERT INTO notification.inbox_entry (id, building_id, account_kind, account_id, unit_id, template_key, params, source_kind, source_id, dedupe_id)
      SELECT gen_random_uuid(), ${BUILDING}, 'resident', ${binh.id}, ${u1}, 'fee.reminder', '{}'::jsonb, 'debt_reminder', g.id, g.id
        FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 150)) g`
    await db.sql`UPDATE identity.resident_account SET language = 'en' WHERE id = ${binh.id}`
    const en = await bodyOf<typeof page>(
      await call('/me/inbox?limit=1', { token: binh.token, unit: u1 }),
    )
    await db.sql`UPDATE identity.resident_account SET language = 'vi' WHERE id = ${binh.id}`
    const vi = await bodyOf<typeof page>(
      await call('/me/inbox?limit=1', { token: binh.token, unit: u1 }),
    )
    expect(en.items[0]).toEqual(vi.items[0])
    expect(en.items[0]).not.toHaveProperty('title')
    expect(en.unreadCount).toBe(100)
    expect(vi.unreadCount).toBe(100)
  })

  test('a bad cursor is 400 invalid_cursor; a helper is refused (NT-35)', async () => {
    const bad = await call('/me/inbox?cursor=zzz', { token: an.token, unit: u1 })
    expect(bad.status).toBe(400)
    expect((await bodyOf<{ error: { code: string } }>(bad)).error.code).toBe('invalid_cursor')
    const helper = await call('/me/inbox', { token: chi.token, unit: u1 })
    expect(helper.status).toBe(403)
  })

  test('NT-30: an entry of a unit the account no longer holds is hidden and comes back with the membership', async () => {
    const all = await bodyOf<typeof page>(
      await call('/me/inbox?limit=100', { token: an.token, unit: u1 }),
    )
    const inU2 = all.items.filter((item) => item.unitId === u2)
    expect(inU2.length).toBeGreaterThan(0)
    await db.sql`UPDATE residency.membership SET status = 'removed', removed_at = now() WHERE account_id = ${an.id} AND unit_id = ${u2}`
    const hidden = await bodyOf<typeof page>(
      await call('/me/inbox?limit=100', { token: an.token, unit: u1 }),
    )
    expect(hidden.items.some((item) => item.unitId === u2)).toBe(false)
    await db.sql`UPDATE residency.membership SET status = 'active', removed_at = NULL WHERE account_id = ${an.id} AND unit_id = ${u2}`
    const back = await bodyOf<typeof page>(
      await call('/me/inbox?limit=100', { token: an.token, unit: u1 }),
    )
    expect(back.items.some((item) => item.unitId === u2)).toBe(true)
  })

  test('NT-33 and NT-34: read one is 204 and idempotent, another account is 404, read-all leaves a newer entry unread', async () => {
    const all = await bodyOf<typeof page>(
      await call('/me/inbox?limit=100', { token: an.token, unit: u1 }),
    )
    const target = all.items.at(-1)?.id as string
    expect(
      (await call(`/me/inbox/${target}/read`, { method: 'POST', token: an.token, unit: u1 }))
        .status,
    ).toBe(204)
    expect(
      (await call(`/me/inbox/${target}/read`, { method: 'POST', token: an.token, unit: u1 }))
        .status,
    ).toBe(204)
    const other = (
      await bodyOf<typeof page>(await call('/me/inbox?limit=100', { token: binh.token, unit: u1 }))
    ).items[0]?.id
    expect(
      (await call(`/me/inbox/${other}/read`, { method: 'POST', token: an.token, unit: u1 })).status,
    ).toBe(404)

    const upTo = all.items[1]?.id as string
    const first = await bodyOf<{ updated: number; unreadCount: number }>(
      await call('/me/inbox/read-all', {
        method: 'POST',
        token: an.token,
        unit: u1,
        json: { upToId: upTo },
      }),
    )
    expect(first.updated).toBeGreaterThanOrEqual(1)
    const second = await bodyOf<{ updated: number }>(
      await call('/me/inbox/read-all', {
        method: 'POST',
        token: an.token,
        unit: u1,
        json: { upToId: upTo },
      }),
    )
    expect(second.updated).toBe(0)
    const newest = (
      await bodyOf<typeof page>(await call('/me/inbox?limit=1', { token: an.token, unit: u1 }))
    ).items[0]
    expect(newest?.readAt).toBeNull()
  })

  test('NT-36: the Manager sees the money-log entry with its web path; the Technician sees none', async () => {
    const mine = await bodyOf<typeof page>(await call('/staff/inbox', { token: manager }))
    const entry = mine.items.find((item) => item.templateKey === 'finance.money_unposted')
    expect(entry?.webPath).toBe('/transactions?tab=money-log')
    expect(entry?.target).toMatchObject({ route: '/inbox' })
    const theirs = await bodyOf<typeof page>(await call('/staff/inbox', { token: technician }))
    expect(theirs.items).toHaveLength(0)
    expect(
      (await call(`/staff/inbox/${entry?.id}/read`, { method: 'POST', token: technician })).status,
    ).toBe(404)
    expect(
      (await call(`/staff/inbox/${entry?.id}/read`, { method: 'POST', token: manager })).status,
    ).toBe(204)
  })

  test('NT-37: notices.notice_read.v1 marks the notice entry read once', async () => {
    const notice = crypto.randomUUID()
    await db.sql`
      INSERT INTO notification.inbox_entry (id, building_id, account_kind, account_id, template_key, params, source_kind, source_id, dedupe_id)
      VALUES (gen_random_uuid(), ${BUILDING}, 'resident', ${an.id}, 'notice.published', '{}'::jsonb, 'notice', ${notice}, ${notice})`
    const handler = handlerOf('notification.mark_read_on_notices_notice_read')
    const message = envelope('notices.notice_read.v1', {
      buildingId: BUILDING,
      noticeId: notice,
      accountKind: 'resident',
      accountId: an.id,
      readAt: new Date().toISOString(),
    })
    await handler.handle(message)
    await handler.handle(message)
    expect(
      await count('notification.inbox_entry', `source_id = '${notice}' AND read_at IS NOT NULL`),
    ).toBe(1)
    // E-178 leaves a notice entry alone (DOC-31 §4.3)
    const second = crypto.randomUUID()
    const [row] = await db.sql`
      INSERT INTO notification.inbox_entry (id, building_id, account_kind, account_id, template_key, params, source_kind, source_id, dedupe_id)
      VALUES (gen_random_uuid(), ${BUILDING}, 'resident', ${an.id}, 'notice.published', '{}'::jsonb, 'notice', ${second}, ${second}) RETURNING id`
    expect(
      (await call(`/me/inbox/${row?.id}/read`, { method: 'POST', token: an.token, unit: u1 }))
        .status,
    ).toBe(204)
    expect(await count('notification.inbox_entry', `id = '${row?.id}' AND read_at IS NULL`)).toBe(1)
  })
})

describe('device tokens (DOC-31 §5)', () => {
  const TOKEN = 'ExponentPushToken[abcDEF123_-xyz]'
  const register = (
    token: string,
    who: string,
    body: Record<string, unknown> = {},
    path = '/me/devices',
  ) =>
    call(path, {
      method: 'POST',
      token: who,
      json: { expoPushToken: token, platform: 'ios', appVersion: '1.0.3', ...body },
    })

  test('NT-40: the same token again returns the same id and one row', async () => {
    const first = await bodyOf<{ id: string }>(await register(TOKEN, an.token))
    const again = await bodyOf<{ id: string }>(await register(TOKEN, an.token))
    expect(again.id).toBe(first.id)
    expect(await count('notification.device_token', `expo_push_token = '${TOKEN}'`)).toBe(1)
  })

  test('NT-41: a token registered by another account moves to it; the earlier owner removes nothing', async () => {
    const first = await bodyOf<{ id: string }>(await register(TOKEN, an.token))
    const moved = await bodyOf<{ id: string }>(await register(TOKEN, binh.token))
    expect(moved.id).toBe(first.id)
    const [row] =
      await db.sql`SELECT account_id, session_id FROM notification.device_token WHERE id = ${first.id}`
    expect(row).toMatchObject({ account_id: binh.id, session_id: binh.sid })
    expect(
      (await call(`/me/devices/${first.id}`, { method: 'DELETE', token: an.token })).status,
    ).toBe(204)
    expect(await count('notification.device_token', `id = '${first.id}'`)).toBe(1)
  })

  test('NT-42: a new token of the same session replaces the old one', async () => {
    await register('ExponentPushToken[first_tok_1]', chi.token)
    await register('ExponentPushToken[second_tok_2]', chi.token)
    expect(await count('notification.device_token', `session_id = '${chi.sid}'`)).toBe(1)
    expect(
      await count(
        'notification.device_token',
        `expo_push_token = 'ExponentPushToken[second_tok_2]'`,
      ),
    ).toBe(1)
  })

  test('NT-43: malformed tokens are 400', async () => {
    for (const bad of [
      'fcm:abc',
      'ExpoPushToken[a b]',
      `ExponentPushToken[${'x'.repeat(200)}]`,
      crypto.randomUUID(),
    ])
      expect((await register(bad, an.token)).status).toBe(400)
    expect((await register(TOKEN, an.token, { platform: 'web' })).status).toBe(400)
  })

  test('NT-44: a revoked session drops its token; a repeat deletes nothing', async () => {
    const handler = handlerOf('notification.drop_device_token_on_identity_session_revoked')
    const message = envelope('identity.session_revoked.v1', {
      buildingId: null,
      accountKind: 'resident',
      accountId: chi.id,
      sessionId: chi.sid,
      reason: 'sign_out',
    })
    await handler.handle(message)
    expect(await count('notification.device_token', `session_id = '${chi.sid}'`)).toBe(0)
    await handler.handle(message)
  })

  test('NT-45 and NT-46: account deletion drops every token; staff remove only their own, answering 204 either way', async () => {
    await register('ExponentPushToken[an_dev_one1]', an.token)
    await handlerOf('notification.drop_tokens_on_identity_account_deletion_executed').handle(
      envelope('identity.account_deletion_executed.v1', {
        buildingId: null,
        accountId: an.id,
        executedAt: new Date().toISOString(),
      }),
    )
    expect(await count('notification.device_token', `account_id = '${an.id}'`)).toBe(0)

    const mine = await bodyOf<{ id: string }>(
      await register(
        'ExponentPushToken[mgr_dev_one1]',
        manager,
        { platform: 'android' },
        '/staff/devices',
      ),
    )
    expect(
      (await call(`/staff/devices/${crypto.randomUUID()}`, { method: 'DELETE', token: manager }))
        .status,
    ).toBe(204)
    expect(
      (await call(`/staff/devices/${mine.id}`, { method: 'DELETE', token: technician })).status,
    ).toBe(204)
    expect(await count('notification.device_token', `id = '${mine.id}'`)).toBe(1)
    expect(
      (await call(`/staff/devices/${mine.id}`, { method: 'DELETE', token: manager })).status,
    ).toBe(204)
    expect(await count('notification.device_token', `id = '${mine.id}'`)).toBe(0)
  })
})

const jobContext = (): JobContext => ({
  clock: built.container.clock,
  signal: new AbortController().signal,
  logger: built.container.logger,
  manual: false,
  paused: () => false,
  buildings: async () => [],
  withLock: (fn) => fn(),
  snapshot: (fn) => fn(),
})

describe('sending and receipts (DOC-31 §6, §7)', () => {
  test('a push request makes a pending ticket per device; push_receipts settles it; a second run changes nothing', async () => {
    const anNow = await signInResident(await resident('Nguyễn Văn An 2'))
    await member(anNow.id, u1, 'owner').catch(() => undefined)
    // a fresh account with a live session and a registered device
    const dev = 'ExponentPushToken[receipt_dev_1]'
    expect(
      (
        await call('/me/devices', {
          method: 'POST',
          token: anNow.token,
          json: { expoPushToken: dev, platform: 'android', appVersion: '1.0.0' },
        })
      ).status,
    ).toBe(200)
    const message = envelope('notification.push_requested.v1', {
      buildingId: BUILDING,
      templateKey: 'fee.batch_published',
      sourceKind: 'batch',
      sourceId: crypto.randomUUID(),
      params: { batchCode: 'PH-2610-09', feeMonth: '2026-10' },
      channel: 'default',
      route: '/fees',
      entityId: null,
      recipients: [{ accountKind: 'resident', accountId: anNow.id, unitId: null }],
    })
    const sender = handlerOf('notification.send_expo_push')
    await sender.handle(message)
    await sender.handle(message)
    expect(
      await count(
        'notification.push_ticket',
        `message_id = '${message.id}' AND status = 'pending'`,
      ),
    ).toBe(1)

    await db.sql`UPDATE notification.push_ticket SET next_check_at = now() - interval '1 minute' WHERE message_id = ${message.id}`
    const receipts = built.container.notification.jobs?.find((job) => job.name === 'push_receipts')
    const first = await receipts?.run(jobContext())
    expect(first?.did).toBeGreaterThanOrEqual(1)
    expect(
      await count('notification.push_ticket', `message_id = '${message.id}' AND status = 'ok'`),
    ).toBe(1)
    const second = await receipts?.run(jobContext())
    expect(second?.details).toEqual({})
  })

  test('NT-51: the token of a session that ended without an event is deleted by the sender', async () => {
    const ghost = await signInResident(await resident('Ghost'))
    await call('/me/devices', {
      method: 'POST',
      token: ghost.token,
      json: {
        expoPushToken: 'ExponentPushToken[ghost_dev_1]',
        platform: 'ios',
        appVersion: '1.0.0',
      },
    })
    await db.sql`UPDATE identity.refresh_family SET revoked_at = now(), revoked_reason = 'sign_out' WHERE id = ${ghost.sid}`
    await handlerOf('notification.send_expo_push').handle(
      envelope('notification.push_requested.v1', {
        buildingId: BUILDING,
        templateKey: 'fee.reminder',
        sourceKind: 'debt_reminder',
        sourceId: crypto.randomUUID(),
        params: {},
        channel: 'default',
        route: '/fees',
        entityId: null,
        recipients: [{ accountKind: 'resident', accountId: ghost.id, unitId: null }],
      }),
    )
    expect(await count('notification.device_token', `account_id = '${ghost.id}'`)).toBe(0)
    expect(await count('notification.push_ticket', `account_id = '${ghost.id}'`)).toBe(0)
  })

  test('NT-73, NT-80: the purges delete in batches and a second run deletes nothing', async () => {
    await db.sql`UPDATE notification.push_ticket SET created_at = now() - interval '4 days'`
    const receipts = built.container.notification.jobs?.find((job) => job.name === 'push_receipts')
    await receipts?.run(jobContext())
    expect(await count('notification.push_ticket')).toBe(0)

    await db.sql`UPDATE notification.inbox_entry SET created_at = now() - interval '200 days', read_at = NULL WHERE template_key = 'fee.batch_published'`
    const purge = built.container.notification.jobs?.find((job) => job.name === 'inbox_purge')
    const before = await count('notification.inbox_entry')
    const run = await purge?.run(jobContext())
    expect(run?.did).toBeGreaterThan(0)
    expect(await count('notification.inbox_entry')).toBe(before - (run?.did ?? 0))
    expect((await purge?.run(jobContext()))?.did).toBe(0)
  })
})
