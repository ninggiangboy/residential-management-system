import type { TestDb } from '@rms/test-support'

/**
 * The shared seed of the three finance HTTP suites (P2-15): the calls, the sign-ins and the rows the finance routes read
 * (DOC-21 §3, DOC-22 §5, §8.4, §9). The routes themselves live in `modules/finance/src/presentation/*`; here the harness is a
 * real container over a cloned template database, driven with `app.handle` (see `support.ts`).
 */

/** The password of every staff account a test seeds (argon2id, the cheap cost of the other suites). */
export const PASSWORD = 'Sunrise2026!'

/** The building time zone of every seeded building (`building.building.time_zone`'s default). */
export const TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** What `containerFor` answers for `app`; a helper only needs to drive requests. */
export type App = { handle(request: Request): Promise<Response> | Response }

export interface ApiInit extends RequestInit {
  token?: string
  json?: unknown
  /** `Idempotency-Key`: a generated one for a POST, `null` to send none. */
  key?: string | null
  unit?: string
}

/** One request against `app` at `/api/v1`; a POST carries an `Idempotency-Key` unless `key` is null. */
export function api(app: App, path: string, init: ApiInit = {}): Promise<Response> {
  const { token, json, key, unit, headers, ...rest } = init
  return Promise.resolve(
    app.handle(
      new Request(`http://localhost/api/v1${path}`, {
        ...rest,
        headers: {
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(unit ? { 'x-unit-id': unit } : {}),
          ...(rest.method === 'POST' && key !== null
            ? { 'idempotency-key': key ?? crypto.randomUUID() }
            : {}),
          ...headers,
        },
        body: json === undefined ? undefined : JSON.stringify(json),
      }),
    ),
  )
}

export const bodyOf = async <T = Record<string, unknown>>(res: Response): Promise<T> =>
  (await res.json()) as T

export const errorOf = async (res: Response) =>
  (await bodyOf<{ error: { code: string; details?: unknown } }>(res)).error

export async function signInStaff(app: App, email: string): Promise<string> {
  const res = await api(app, '/auth/staff/login', {
    method: 'POST',
    key: null,
    json: { email, password: PASSWORD, client: 'app' },
  })
  if (res.status !== 200) throw new Error(`staff login ${email} answered ${res.status}`)
  return (await bodyOf<{ accessToken: string }>(res)).accessToken
}

/** A demo account signs in with the fixed code, the way to a real resident token without an SMS. */
export async function signInResident(app: App, phone: string): Promise<string> {
  const requested = await api(app, '/auth/otp', { method: 'POST', key: null, json: { phone } })
  const { challengeId } = await bodyOf<{ challengeId: string }>(requested)
  const verified = await api(app, '/auth/otp/verify', {
    method: 'POST',
    key: null,
    json: { challengeId, code: '123456' },
  })
  if (verified.status !== 200)
    throw new Error(`otp verify for ${phone} answered ${verified.status}`)
  return (await bodyOf<{ accessToken: string }>(verified)).accessToken
}

/** The building-local calendar day (`YYYY-MM-DD`) of an instant, which `receivedOn` and the DR-40 window compare with. */
export function localDay(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

let phoneSeq = 0
/** A unique demo phone number. */
export function nextPhone(): string {
  phoneSeq += 1
  return `+84907${String(phoneSeq).padStart(6, '0')}`
}

export async function seedBuilding(
  db: TestDb,
  id: string,
  code: string,
  isDemo = false,
): Promise<void> {
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
    VALUES (${id}, ${code}, '{"vi":"Chung cư","en":"Apartments"}',
            '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', ${isDemo})`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${id})`
}

export async function seedStaff(
  db: TestDb,
  opts: { buildingId: string; email: string; role: string; fullName?: string; language?: string },
): Promise<string> {
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  const [row] = await db.sql<{ id: string }[]>`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (gen_random_uuid(), ${opts.buildingId}, ${opts.email}, ${opts.fullName ?? opts.role}, ${opts.role}, 'active', ${hash}, ${opts.language ?? 'en'})
    RETURNING id`
  if (!row) throw new Error('seedStaff inserted no row')
  return row.id
}

export async function seedUnit(
  db: TestDb,
  opts: { buildingId: string; code: string; floor?: number; occupancy?: string },
): Promise<string> {
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
    VALUES (${id}, ${opts.buildingId}, ${opts.code}, ${opts.floor ?? 15}, ${opts.occupancy ?? 'occupied'})`
  return id
}

export async function seedResidentAccount(
  db: TestDb,
  opts: { phone: string; displayName?: string },
): Promise<string> {
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.resident_account (id, phone, display_name, is_demo)
    VALUES (${id}, ${opts.phone}, ${opts.displayName ?? opts.phone}, true)`
  return id
}

export async function seedMembership(
  db: TestDb,
  opts: {
    buildingId: string
    accountId: string
    unitId: string
    memberType: string
    canPay?: boolean
    /** `membership.created_at`: the start of the DR-40 window (`UnitContext.startedAt`). */
    createdAt?: Date
  },
): Promise<string> {
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, can_pay, added_by_kind, added_by, created_at)
    VALUES (${id}, ${opts.buildingId}, ${opts.accountId}, ${opts.unitId}, ${opts.memberType}, ${opts.canPay ?? false}, 'staff', ${crypto.randomUUID()}, ${opts.createdAt ?? new Date()})`
  return id
}

/** A resident account with one membership: the fixture of the resident and authz suites. */
export async function seedResident(
  db: TestDb,
  opts: { buildingId: string; unitId: string; memberType: string; createdAt?: Date },
): Promise<{ accountId: string; phone: string; membershipId: string }> {
  const phone = nextPhone()
  const accountId = await seedResidentAccount(db, { phone })
  const membershipId = await seedMembership(db, { ...opts, accountId })
  return { accountId, phone, membershipId }
}

export interface SeededCharge {
  readonly batchId: string
  readonly chargeId: string
}

/**
 * A published batch with one `open` charge (version 2) and one fee line for a unit, the fixture of the resident reads and the
 * void/recall flows (DOC-21 §5.1). Written straight with SQL so the due date and the fee month are the test's.
 */
export async function seedPublishedCharge(
  db: TestDb,
  opts: {
    buildingId: string
    unitId: string
    unitCode: string
    amount: number
    code: string
    feeMonth?: string
    dueDate?: string
    itemName?: string
  },
): Promise<SeededCharge> {
  const batchId = crypto.randomUUID()
  const chargeId = crypto.randomUUID()
  const item = opts.itemName ?? 'Phí quản lý'
  await db.sql`
    INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, status, created_by, published_at, published_by, version)
    VALUES (${batchId}, ${opts.buildingId}, ${opts.code},
            '{"vi":"Phí tháng","en":"Monthly fee"}'::jsonb,
            ${opts.feeMonth ?? '2026-10-01'}::date, ${opts.dueDate ?? '2026-11-10'}::date,
            'published', ${crypto.randomUUID()}, now(), ${crypto.randomUUID()}, 2)`
  await db.sql`
    INSERT INTO finance.charge (id, building_id, batch_id, unit_id, unit_code, amount, status, version)
    VALUES (${chargeId}, ${opts.buildingId}, ${batchId}, ${opts.unitId}, ${opts.unitCode}, ${opts.amount}, 'draft', 1)`
  await db.sql`
    INSERT INTO finance.charge_line (id, building_id, charge_id, position, kind, item_name, quantity, unit_price, amount)
    VALUES (${crypto.randomUUID()}, ${opts.buildingId}, ${chargeId}, 1, 'fee',
            jsonb_build_object('vi', ${item}::text, 'en', ${`${item} (EN)`}::text), 1, ${opts.amount}, ${opts.amount})`
  await db.sql`UPDATE finance.charge SET status = 'open', version = 2, updated_at = now() WHERE id = ${chargeId}`
  return { batchId, chargeId }
}

let orderSeq = 5_000_000
/** A `pending` payment intent, the FK a gateway event with an outcome other than `unknown_order` needs (DOC-15 §9.3). */
export async function seedIntent(
  db: TestDb,
  opts: { buildingId: string; unitId: string; amount: number },
): Promise<string> {
  const id = crypto.randomUUID()
  orderSeq += 1
  const order = orderSeq
  await db.sql`
    INSERT INTO finance.payment_intent (id, building_id, unit_id, code, order_code, amount, status, gateway_config_id, provider, link_id, created_by, display_until, expires_at)
    VALUES (${id}, ${opts.buildingId}, ${opts.unitId}, ${`TT-261019-${order}`}, ${order}, ${opts.amount}, 'pending',
            ${crypto.randomUUID()}, 'fake', ${`link-${order}`}, ${crypto.randomUUID()}, now() + interval '30 minutes', now() + interval '60 minutes')`
  return id
}

/** A money-log row of the gateway half (DOC-22 §9.4). `amount_short`, `refunded`, … need an `intentId` (`ck_gateway_event_intent`). */
export async function seedGatewayEvent(
  db: TestDb,
  opts: {
    buildingId: string
    unitId?: string
    outcome?: string
    amount?: number
    reference?: string
    receivedAt?: Date
    intentId?: string
    reviewed?: { by: string; at: Date; note: string }
  },
): Promise<string> {
  const id = crypto.randomUUID()
  const at = opts.receivedAt ?? new Date()
  await db.sql`
    INSERT INTO finance.gateway_event (id, building_id, provider, reference, order_code, amount, paid_at, source, payload, intent_id, unit_id, outcome, reviewed_by, reviewed_at, review_note, received_at)
    VALUES (${id}, ${opts.buildingId}, 'fake', ${opts.reference ?? crypto.randomUUID()}, ${null}, ${opts.amount ?? 100_000}, ${at},
            'webhook', '{}'::jsonb, ${opts.intentId ?? null}, ${opts.unitId ?? null}, ${opts.outcome ?? 'unknown_order'},
            ${opts.reviewed?.by ?? null}, ${opts.reviewed?.at ?? null}, ${opts.reviewed?.note ?? null}, ${at})`
  return id
}
