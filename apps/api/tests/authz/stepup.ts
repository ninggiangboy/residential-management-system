import type { Mailer } from '@core/mail'
import type { Envelope } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { cloneDatabase } from '@rms/test-support'
import type { ContainerOverrides } from '../../src/bootstrap/container'
import { appOver, IDS, PASSWORD, type World } from './world'

/**
 * The step-up pass of EXP-10 §7.1 (C8): E-40, E-42 and E-50 called without a valid proof, or with one that was spent, expired,
 * bound to another action or belongs to another Admin, cause no change. Each case runs in a copy of the world, so "unchanged" is
 * a comparison of one snapshot before and after.
 */

export interface StepUpCase {
  id: string
  variant: string
  /** What the case checks, in the words of the table of §7.1. */
  title: string
  ok: boolean
  detail?: string
}

interface Variant {
  name: string
  action: 'admin_change' | 'staff_email' | 'gateway_config'
  /** The request that needs the proof; `proof` is added to its body, `version` is the `If-Match` it sends. */
  request(
    proof: Proof | undefined,
    version?: string,
  ): {
    method: string
    path: string
    json: Record<string, unknown>
    headers?: Record<string, string>
  }
  /** What the action would write, as a string: byte-equal before and after means "unchanged". */
  snapshot(h: Harness): Promise<string>
  /** A request that fails for a business reason once the proof is accepted (S8): a 409. */
  business(proof: Proof): {
    method: string
    path: string
    json: Record<string, unknown>
    headers?: Record<string, string>
  }
  /** The second use of a proof (S4, S9): a request that would change something again, so a refusal is the proof's and not a no-op's. */
  again?(proof: Proof): {
    method: string
    path: string
    json: Record<string, unknown>
    headers?: Record<string, string>
  }
  /** A row the business failure needs to exist (the gateway of the building), and the version of the row it leaves. */
  seed?: { version: string; run(h: Harness, world: World): Promise<void> }
}

interface Proof {
  password: string
  code: string
}

class Harness {
  private constructor(
    readonly world: World,
    readonly db: Awaited<ReturnType<typeof cloneDatabase>>,
    readonly built: ReturnType<typeof appOver>,
    readonly mails: Array<{ to: string; text: string }>,
    readonly clock: FakeClock,
  ) {}

  static async open(world: World, overrides: ContainerOverrides = {}) {
    const db = await cloneDatabase(world.db)
    const mails: Array<{ to: string; text: string }> = []
    const clock = new FakeClock(new Date())
    const mailer: Mailer = {
      send: async (mail) => void mails.push({ to: mail.to, text: mail.text }),
    }
    return new Harness(world, db, appOver(db.url, { mailer, clock, ...overrides }), mails, clock)
  }

  async close() {
    await this.built.container.close()
    await this.db.drop()
  }

  call(path: string, init: RequestInit & { json?: unknown; token?: string } = {}) {
    const { json, token, headers, ...rest } = init
    return this.built.app.handle(
      new Request(`http://localhost/api/v1${path}`, {
        ...rest,
        headers: {
          'x-app-id': 'web',
          ...(json === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: json === undefined ? undefined : JSON.stringify(json),
      }),
    )
  }

  /** The relay of the test: each pending mail command goes to the handler of `identity`, which sends through the recorder. */
  async deliverMail() {
    const before = this.mails.length
    const rows = await this.db.sql`
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
      for (const handler of this.built.container.identity.handlers ?? [])
        if (handler.eventType === row.type) await handler.handle(envelope)
      await this.db
        .sql`UPDATE identity.outbox_messages SET published_at = now() WHERE id = ${row.id}`
    }
    return this.mails.slice(before)
  }

  /** `POST /staff/step-up`, then the code the Admin reads in the mail. */
  async code(token: string, email: string, action: string): Promise<string> {
    const res = await this.call('/staff/step-up', { method: 'POST', token, json: { action } })
    if (res.status !== 204) throw new Error(`E-38 answered ${res.status}`)
    const mail = (await this.deliverMail()).find(
      (m) => m.to === email && /\b\d{6}\b/.test(m.text) && !m.text.includes('token='),
    )
    if (!mail) throw new Error('no step-up mail')
    return /\b(\d{6})\b/.exec(mail.text)?.[1] as string
  }

  /** How many notices of a step-up the outbox holds (AU-48: one per active Admin). */
  async notices(): Promise<number> {
    const [row] = await this.db.sql`
      SELECT count(*)::int AS n FROM identity.outbox_messages
       WHERE type = 'identity.mail_requested.v1' AND payload::text LIKE '%step_up_notice%'`
    return row?.n as number
  }
}

const admin = (w: World) => w.tokens['staff.admin'] as string
const ADMIN_EMAIL = 'admin@b1.example'
const TECHNICIAN = '__technician__'

const withProof = (json: Record<string, unknown>, proof?: Proof) =>
  proof ? { ...json, stepUp: proof } : json

const GATEWAY = {
  provider: 'payos',
  driver: 'payos',
  status: 'active',
  receivingAccount: {
    bankBin: '970436',
    accountNumber: '0011001234567',
    accountName: 'CONG TY QUAN LY SUNRISE',
  },
  secrets: {
    clientId: 'client-id-0001',
    apiKey: 'api-key-abcdef123456',
    checksumKey: 'chk-key-9z8y7x6w5v',
  },
}

const VARIANTS: Variant[] = [
  {
    name: 'E-40 admin',
    action: 'admin_change',
    request: (proof) => ({
      method: 'POST',
      path: '/staff/accounts',
      json: withProof(
        { fullName: 'New Admin', email: 'new.admin@b1.example', role: 'admin' },
        proof,
      ),
      headers: { 'idempotency-key': crypto.randomUUID() },
    }),
    snapshot: async (h) =>
      JSON.stringify(await h.db.sql`SELECT email, role FROM identity.staff_account ORDER BY email`),
    // A duplicate email is a 409 once the proof is accepted.
    business: (proof) => ({
      method: 'POST',
      path: '/staff/accounts',
      json: withProof({ fullName: 'Duplicate', email: 'manager@b1.example', role: 'admin' }, proof),
      headers: { 'idempotency-key': crypto.randomUUID() },
    }),
  },
  {
    name: 'E-42 promote',
    action: 'admin_change',
    request: (proof, version = '1') => ({
      method: 'PATCH',
      path: `/staff/accounts/${IDS.staffTarget}`,
      json: withProof({ role: 'admin' }, proof),
      headers: { 'if-match': `"${version}"` },
    }),
    snapshot: async (h) =>
      JSON.stringify(
        await h.db.sql`SELECT email, role, version FROM identity.staff_account ORDER BY email`,
      ),
    business: (proof) => ({
      method: 'PATCH',
      path: `/staff/accounts/${IDS.staffTarget}`,
      json: withProof({ role: 'admin' }, proof),
      headers: { 'if-match': '"999"' },
    }),
    again: (proof) => ({
      method: 'PATCH',
      path: `/staff/accounts/${TECHNICIAN}`,
      json: withProof({ role: 'admin' }, proof),
      headers: { 'if-match': '"1"' },
    }),
  },
  {
    name: 'E-42 email',
    action: 'staff_email',
    request: (proof, version = '1') => ({
      method: 'PATCH',
      path: `/staff/accounts/${IDS.staffTarget}`,
      json: withProof({ email: 'moved@b1.example' }, proof),
      headers: { 'if-match': `"${version}"` },
    }),
    snapshot: async (h) =>
      JSON.stringify(
        await h.db.sql`SELECT email, role, version FROM identity.staff_account ORDER BY email`,
      ),
    business: (proof) => ({
      method: 'PATCH',
      path: `/staff/accounts/${IDS.staffTarget}`,
      json: withProof({ email: 'moved@b1.example' }, proof),
      headers: { 'if-match': '"999"' },
    }),
    again: (proof) => ({
      method: 'PATCH',
      path: `/staff/accounts/${TECHNICIAN}`,
      json: withProof({ email: 'moved.again@b1.example' }, proof),
      headers: { 'if-match': '"1"' },
    }),
  },
  {
    name: 'E-50 gateway',
    action: 'gateway_config',
    request: (proof, version) => ({
      method: 'PUT',
      path: '/staff/gateway',
      json: withProof(GATEWAY, proof),
      headers: version ? { 'if-match': `"${version}"` } : ({} as Record<string, string>),
    }),
    snapshot: async (h) =>
      JSON.stringify(await h.db.sql`SELECT * FROM building.gateway_config ORDER BY building_id`),
    business: (proof) => ({
      method: 'PUT',
      path: '/staff/gateway',
      json: withProof(GATEWAY, proof),
      headers: { 'if-match': '"999"' },
    }),
    again: (proof) => ({
      method: 'PUT',
      path: '/staff/gateway',
      json: withProof(GATEWAY, proof),
      headers: { 'if-match': '"1"' },
    }),
    // The business failure of a save is a stale version, which only a row that exists can have.
    seed: {
      version: '1',
      async run(h, world) {
        const proof = {
          password: PASSWORD,
          code: await h.code(admin(world), ADMIN_EMAIL, 'gateway_config'),
        }
        const res = await h.call('/staff/gateway', {
          method: 'PUT',
          token: admin(world),
          json: withProof(GATEWAY, proof),
        })
        if (res.status !== 201) throw new Error(`the first gateway save answered ${res.status}`)
      },
    },
  },
]

const errorOf = async (res: { json(): Promise<unknown> }) =>
  (
    (await res.json().catch(() => ({}))) as {
      error?: { code?: string; details?: Record<string, unknown> }
    }
  ).error ?? {}

type Run = Awaited<ReturnType<Harness['call']>>

/** The cases of §7.1 for one variant, each in its own copy of the world. */
async function runVariant(
  world: World,
  v: Variant,
  overrides: ContainerOverrides,
): Promise<StepUpCase[]> {
  const out: StepUpCase[] = []
  const record = (id: string, title: string, ok: boolean, detail?: string) =>
    out.push({ id, variant: v.name, title, ok, detail: ok ? undefined : detail })

  const send = (
    h: Harness,
    req: ReturnType<Variant['request']>,
    token = admin(world),
  ): Promise<Run> =>
    h.call(req.path.replace(TECHNICIAN, world.accounts['staff.technician'] as string), {
      method: req.method,
      token,
      json: req.json,
      headers: req.headers,
    })

  /** A case that must be refused with `status` and `code` and leave the snapshot as it was. */
  const refused = async (
    id: string,
    title: string,
    status: number,
    code: string,
    prepare: (h: Harness) => Promise<Parameters<Variant['request']>[0]>,
    extra?: (h: Harness, res: Run) => Promise<string | undefined>,
  ) => {
    const h = await Harness.open(world, overrides)
    try {
      const proof = await prepare(h)
      const before = await v.snapshot(h)
      const res = await send(h, v.request(proof))
      const error = await errorOf(res.clone())
      const after = await v.snapshot(h)
      const problems = [
        res.status !== status || error.code !== code
          ? `got ${res.status} ${error.code}, want ${status} ${code}`
          : '',
        before !== after ? 'the data changed' : '',
        (await extra?.(h, res)) ?? '',
      ].filter(Boolean)
      record(id, title, problems.length === 0, problems.join('; '))
    } finally {
      await h.close()
    }
  }

  await refused(
    'S0',
    'no stepUp object',
    403,
    'step_up_required',
    async () => undefined,
    async (_h, res) => {
      const details = (await errorOf(res.clone())).details
      return details?.action === v.action
        ? undefined
        : `details.action is ${JSON.stringify(details)}`
    },
  )
  await refused(
    'S1',
    'wrong password, right code',
    403,
    'step_up_failed',
    async (h) => ({
      password: 'not the password',
      code: await h.code(admin(world), ADMIN_EMAIL, v.action),
    }),
    async (h) => {
      // AU-47: the wrong password counts toward the lockout of the account and leaves the attempts of the code alone.
      const [account] = await h.db
        .sql`SELECT failed_attempts FROM identity.staff_account WHERE email = ${ADMIN_EMAIL}`
      const [code] = await h.db
        .sql`SELECT attempts FROM identity.password_token WHERE kind = 'step_up' AND action = ${v.action} AND staff_id = ${world.accounts['staff.admin'] as string}`
      return account?.failed_attempts === 1 && code?.attempts === 0
        ? undefined
        : `failed_attempts ${account?.failed_attempts}, code attempts ${code?.attempts}, want 1 and 0`
    },
  )
  await refused(
    'S2',
    'right password, wrong code',
    403,
    'step_up_failed',
    async (h) => {
      await h.code(admin(world), ADMIN_EMAIL, v.action)
      return { password: PASSWORD, code: '000000' }
    },
    async (h, res) => {
      const left = (await errorOf(res.clone())).details?.attemptsLeft
      // AU-46: the count of a wrong code is committed apart from the request that failed, so it stays after the rollback.
      const [code] = await h.db
        .sql`SELECT attempts FROM identity.password_token WHERE kind = 'step_up' AND action = ${v.action} AND staff_id = ${world.accounts['staff.admin'] as string}`
      return left === 4 && code?.attempts === 1
        ? undefined
        : `attemptsLeft ${left}, attempts ${code?.attempts}, want 4 and 1`
    },
  )
  await refused('S3', 'the right code at 10 min 1 s', 403, 'step_up_failed', async (h) => {
    const code = await h.code(admin(world), ADMIN_EMAIL, v.action)
    h.clock.advance(10 * 60_000 + 1000)
    return { password: PASSWORD, code }
  })
  await refused('S5', 'a code requested for another action', 403, 'step_up_failed', async (h) => {
    const other = v.action === 'gateway_config' ? 'staff_email' : 'gateway_config'
    return { password: PASSWORD, code: await h.code(admin(world), ADMIN_EMAIL, other) }
  })
  await refused('S6', "another Admin's code, right password", 403, 'step_up_failed', async (h) => ({
    password: PASSWORD,
    code: await h.code(world.admin2.token, world.admin2.email, v.action),
  }))
  await refused(
    'S7',
    'the right code after five wrong ones',
    403,
    'step_up_failed',
    async (h) => {
      const code = await h.code(admin(world), ADMIN_EMAIL, v.action)
      for (let i = 0; i < 5; i++) await send(h, v.request({ password: PASSWORD, code: '000000' }))
      return { password: PASSWORD, code }
    },
    async (_h, res) => {
      const left = (await errorOf(res.clone())).details?.attemptsLeft
      return left === 0 ? undefined : `attemptsLeft is ${left}, want 0`
    },
  )

  // S4 needs a success first, then the same code again.
  {
    const h = await Harness.open(world, overrides)
    try {
      const proof = { password: PASSWORD, code: await h.code(admin(world), ADMIN_EMAIL, v.action) }
      const first = await send(h, v.request(proof))
      const afterFirst = await v.snapshot(h)
      const second = await send(h, (v.again ?? v.request)(proof))
      const error = await errorOf(second.clone())
      const problems = [
        first.status >= 300 ? `the first use answered ${first.status}` : '',
        second.status !== 403 || error.code !== 'step_up_failed'
          ? `the second use answered ${second.status} ${error.code}`
          : '',
        (await v.snapshot(h)) !== afterFirst ? 'the second use changed the data' : '',
      ].filter(Boolean)
      record(
        'S4',
        'the right code a second time after a success',
        problems.length === 0,
        problems.join('; '),
      )
    } finally {
      await h.close()
    }
  }

  // S8, then S9 with the same code: a business failure keeps the code live, the success spends it.
  {
    const h = await Harness.open(world, overrides)
    try {
      if (v.seed) await v.seed.run(h, world)
      await h.deliverMail()
      const proof = { password: PASSWORD, code: await h.code(admin(world), ADMIN_EMAIL, v.action) }
      const noticesBefore = await h.notices()
      const before = await v.snapshot(h)
      const failed = await send(h, v.business(proof))
      const status = failed.status
      const problems = [
        status !== 409 ? `the business failure answered ${status}` : '',
        (await v.snapshot(h)) !== before ? 'the data changed' : '',
        (await h.notices()) !== noticesBefore ? 'a notice was written' : '',
      ].filter(Boolean)
      record(
        'S8',
        'a business failure after a valid proof',
        problems.length === 0,
        problems.join('; '),
      )

      const ok = await send(h, v.request(proof, v.seed?.version))
      await h.deliverMail()
      const second = await send(h, (v.again ?? v.request)(proof))
      const admins = 2
      const problems9 = [
        ok.status < 200 || ok.status >= 300 ? `the success answered ${ok.status}` : '',
        (await v.snapshot(h)) === before ? 'the data did not change' : '',
        (await h.notices()) - noticesBefore !== admins
          ? `${(await h.notices()) - noticesBefore} notices, want ${admins}`
          : '',
        second.status !== 403 ? `the code worked twice (${second.status})` : '',
      ].filter(Boolean)
      record(
        'S9',
        'the right password and a fresh code',
        problems9.length === 0,
        problems9.join('; '),
      )
    } finally {
      await h.close()
    }
  }
  return out
}

/** The rows of "other actors" of §7.1 and the rows of E-38. */
async function runOthers(world: World, overrides: ContainerOverrides): Promise<StepUpCase[]> {
  const out: StepUpCase[] = []
  const check = (id: string, variant: string, title: string, got: string, want: string) =>
    out.push({
      id,
      variant,
      title,
      ok: got === want,
      detail: got === want ? undefined : `got ${got}, want ${want}`,
    })
  const answer = async (res: Response) =>
    `${res.status} ${(await errorOf(res.clone())).code ?? ''}`.trim()

  const h = await Harness.open(world, overrides)
  try {
    const manager = world.tokens['staff.manager'] as string
    for (const v of VARIANTS) {
      const req = v.request(undefined)
      check(
        'O1',
        v.name,
        'a Manager without a proof is forbidden, not step_up_required',
        await answer(
          await h.call(req.path, {
            method: req.method,
            token: manager,
            json: req.json,
            headers: req.headers,
          }),
        ),
        '403 forbidden',
      )
    }
    for (const actor of ['staff.technician', 'staff.guard', 'res.owner', 'anon'] as const) {
      const req = VARIANTS[0]!.request(undefined)
      const token = world.tokens[actor] ?? undefined
      const want =
        actor === 'res.owner' || actor === 'anon' ? '401 unauthenticated' : '403 forbidden'
      check(
        'O2',
        actor,
        'E-40 for an Admin role',
        await answer(
          await h.call(req.path, {
            method: req.method,
            token,
            json: req.json,
            headers: req.headers,
          }),
        ),
        want,
      )
    }
    const technician = (name: string) => ({
      json: { fullName: 'Tech', email: `${name}@b1.example`, role: 'technician' },
      headers: { 'idempotency-key': crypto.randomUUID() },
    })
    for (const [actor, token] of [
      ['staff.admin', admin(world)],
      ['staff.manager', manager],
    ] as const)
      check(
        'O3',
        actor,
        'E-40 with role technician needs no proof',
        await answer(
          await h.call('/staff/accounts', { method: 'POST', token, ...technician(`t-${actor}`) }),
        ),
        '201',
      )
    check(
      'O4',
      'staff.admin',
      'E-42 changing only fullName needs no proof',
      await answer(
        await h.call(`/staff/accounts/${IDS.staffTarget}`, {
          method: 'PATCH',
          token: admin(world),
          json: { fullName: 'Renamed' },
          headers: { 'if-match': '"1"' },
        }),
      ),
      '200',
    )
    check(
      'O5',
      'staff.admin',
      'E-38 with an unknown action',
      await answer(
        await h.call('/staff/step-up', {
          method: 'POST',
          token: admin(world),
          json: { action: 'delete_building' },
        }),
      ),
      '400 validation_failed',
    )
    check(
      'O6',
      'staff.manager',
      'E-38 is for Admins',
      await answer(
        await h.call('/staff/step-up', {
          method: 'POST',
          token: manager,
          json: { action: 'staff_email' },
        }),
      ),
      '403 forbidden',
    )
    const codes: string[] = []
    for (let i = 0; i < 6; i++)
      codes.push(
        await answer(
          await h.call('/staff/step-up', {
            method: 'POST',
            token: admin(world),
            json: { action: 'staff_email' },
          }),
        ),
      )
    check(
      'O7',
      'staff.admin',
      'E-38 six times in an hour: the sixth is rate limited',
      codes
        .slice(0, 5)
        .concat(codes[5] ?? '')
        .join(','),
      ['204', '204', '204', '204', '204', '429 rate_limited'].join(','),
    )
  } finally {
    await h.close()
  }
  return out
}

/** Every case of EXP-10 §7.1; `failures` are the ones whose result differs from the table (C8). */
export async function runStepUpPass(
  world: World,
  {
    overrides = {},
    variants,
  }: { overrides?: ContainerOverrides; variants?: readonly string[] } = {},
): Promise<{ cases: StepUpCase[]; failures: StepUpCase[] }> {
  const cases: StepUpCase[] = []
  for (const variant of VARIANTS)
    if (!variants || variants.includes(variant.name))
      cases.push(...(await runVariant(world, variant, overrides)))
  if (!variants) cases.push(...(await runOthers(world, overrides)))
  return { cases, failures: cases.filter((c) => !c.ok) }
}
