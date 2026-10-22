import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ForbiddenError, PreconditionRequiredError, VersionConflictError } from '@core/kernel'
import type { GatewayConfigDto } from '../src/contracts'
import { GatewayInUseError, TermsVersionSupersededError } from '../src/domain/errors'
import { BUILDING, createHarness, DEMO_BUILDING, type Harness } from './support'

let h: Harness
let admin: ReturnType<Harness['staff']>
beforeAll(async () => {
  h = await createHarness({ settingsCacheSeconds: 0 })
  admin = h.staff('admin')
})
afterAll(async () => {
  await h.close()
})

const SECRETS = {
  clientId: 'client-id-0001',
  apiKey: 'api-key-abcdef123456',
  checksumKey: 'chk-key-9z8y7x6w5v',
}
const ACCOUNT = {
  bankBin: '970436',
  accountNumber: '0011001234567',
  accountName: 'CONG TY QUAN LY SUNRISE',
}
const PROOF = { password: 'correct horse battery', code: '482913' }

const input = (over: Record<string, unknown> = {}) => ({
  provider: 'payos' as const,
  driver: 'payos' as const,
  status: 'active' as const,
  receivingAccount: ACCOUNT,
  secrets: SECRETS,
  stepUp: PROOF,
  ...over,
})
const rowOf = async () =>
  (
    await h.db
      .sql`SELECT * FROM building.gateway_config WHERE building_id = ${BUILDING} AND status = 'active'`
  )[0]
const auditText = async () =>
  JSON.stringify(
    await h.db
      .sql`SELECT changes, details, reason FROM audit.audit_log WHERE action LIKE 'building.gateway%'`,
  )

describe('gateway configuration (DOC-36 §7)', () => {
  test('BD-18 the first save creates the row; the blob is encrypted, the view is masked and a short secret shows only dots', async () => {
    const saved = await h.building.gateway.save(
      admin,
      input({ secrets: { ...SECRETS, clientId: 'short' } }),
    )
    expect(saved.created).toBe(true)
    expect(saved.config).toMatchObject({
      provider: 'payos',
      driver: 'payos',
      status: 'active',
      version: 1,
      secrets: { clientId: '••••', apiKey: '••••3456', checksumKey: '••••6w5v' },
    })
    const row = await rowOf()
    expect(row?.secrets_enc).toMatch(/^v1:k1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/)
    expect(row?.secrets_enc).not.toContain('api-key')
    expect(
      JSON.parse(await h.secretBox.open(`gateway_config|${row?.id}`, row?.secrets_enc)),
    ).toEqual({
      ...SECRETS,
      clientId: 'short',
    })
    const view = await h.building.gateway.view(admin)
    expect(view.configs).toHaveLength(1)
    expect(JSON.stringify(view)).not.toContain('api-key-abcdef')
    expect(view.drivers.fake).toEqual({ fields: [], allowed: false })
    expect(view.drivers.payos).toMatchObject({
      allowed: true,
      fields: ['clientId', 'apiKey', 'checksumKey'],
    })
  })

  test('BD-19 a secret is in no audit row: the row lists the fields that changed, the secrets as [masked]', async () => {
    const text = await auditText()
    expect(text).not.toContain('api-key')
    expect(text).not.toContain('chk-key')
    expect(text).toContain('[masked]')
    const [row] = await h.db
      .sql`SELECT changes, details, object_type FROM audit.audit_log WHERE action = 'building.gateway.update'`
    expect(row?.details).toEqual({ stepUp: true })
    expect(row?.object_type).toBe('gateway_config')
    expect(row?.changes).toEqual(
      expect.arrayContaining([
        { field: 'secrets', before: null, after: '[masked]' },
        { field: 'receivingAccount.accountNumber', before: null, after: '0011…4567' },
      ]),
    )
  })

  test('getGatewayConfig decrypts in memory for finance, from the cache, and the blob is never returned', async () => {
    const config = (await h.building.api.getGatewayConfig(BUILDING, 'payos')) as GatewayConfigDto
    expect(config.secrets).toEqual({ ...SECRETS, clientId: 'short' })
    expect(config).not.toHaveProperty('secretsEnc')
    expect(await h.building.api.getGatewayConfig(BUILDING, 'vietqr')).toBeNull()
    expect(await h.building.api.getGatewayConfig(DEMO_BUILDING, 'payos')).toBeNull()
  })

  test('BD-20 without a step-up proof it is 403 step_up_required; a failed proof stops the save; nothing changes', async () => {
    const before = await rowOf()
    await expect(
      h.building.gateway.save(admin, input({ stepUp: undefined, version: 1 })),
    ).rejects.toMatchObject({
      code: 'step_up_required',
    })
    h.stepUpState.failWith = new ForbiddenError('step_up_failed', 'The proof does not match')
    const failure = await h.building.gateway
      .save(admin, input({ version: 1, status: 'disabled' }))
      .then(
        () => null,
        (e) => e,
      )
    h.stepUpState.failWith = undefined
    expect(failure).toMatchObject({ code: 'step_up_failed' })
    expect(await rowOf()).toEqual(before)
    // every attempt that reached the verifier asked for the action `gateway_config`
    expect(h.stepUpState.calls.every((c) => c.action === 'gateway_config')).toBe(true)
  })

  test('BD-23 a save that sends only apiKey keeps the other two secrets; the step-up proof is checked in the same transaction', async () => {
    const before = h.stepUpState.calls.length
    const saved = await h.building.gateway.save(
      admin,
      input({ version: 1, secrets: { apiKey: 'new-api-key-value' } }),
    )
    expect(saved).toMatchObject({ created: false, config: { version: 2 } })
    expect(h.stepUpState.calls.length).toBe(before + 1)
    const row = await rowOf()
    expect(
      JSON.parse(await h.secretBox.open(`gateway_config|${row?.id}`, row?.secrets_enc)),
    ).toEqual({
      clientId: 'short',
      apiKey: 'new-api-key-value',
      checksumKey: SECRETS.checksumKey,
    })
    expect(row?.last_check_at).toBeNull()
    expect(
      (
        await h.db
          .sql`SELECT changes FROM audit.audit_log WHERE action = 'building.gateway.update' ORDER BY id DESC LIMIT 1`
      )[0]?.changes,
    ).toEqual([{ field: 'secrets', before: '[masked]', after: '[masked]' }])
  })

  test('BD-24 a stale version is 409 and a missing one is 428; the row lock and the guarded update', async () => {
    await expect(h.building.gateway.save(admin, input({ version: 1 }))).rejects.toBeInstanceOf(
      VersionConflictError,
    )
    await expect(h.building.gateway.save(admin, input())).rejects.toBeInstanceOf(
      PreconditionRequiredError,
    )
    const ok = await h.building.gateway.save(admin, input({ version: 2 }))
    expect(ok.config.version).toBe(3)
  })

  test('BD-26 a receiving-account change is 409 gateway_in_use while an intent is active; a secrets-only change still passes', async () => {
    h.probeState.active = true
    const before = await rowOf()
    await expect(
      h.building.gateway.save(
        admin,
        input({ version: 3, receivingAccount: { ...ACCOUNT, accountNumber: '0011009999999' } }),
      ),
    ).rejects.toBeInstanceOf(GatewayInUseError)
    await expect(
      h.building.gateway.save(admin, input({ version: 3, status: 'disabled' })),
    ).rejects.toBeInstanceOf(GatewayInUseError)
    expect(await rowOf()).toEqual(before)
    const secretsOnly = await h.building.gateway.save(
      admin,
      input({ version: 3, secrets: { checksumKey: 'rotated-checksum-key' } }),
    )
    expect(secretsOnly.config.version).toBe(4)
    h.probeState.active = false
    const changed = await h.building.gateway.save(
      admin,
      input({
        version: 4,
        secrets: undefined,
        receivingAccount: { ...ACCOUNT, bankBin: '970422', accountNumber: '0011009999999' },
      }),
    )
    expect(changed.config.receivingAccount.bankBin).toBe('970422')
    const last = (
      await h.db
        .sql`SELECT changes FROM audit.audit_log WHERE action = 'building.gateway.update' ORDER BY id DESC LIMIT 1`
    )[0]
    expect(last?.changes).toEqual([
      { field: 'receivingAccount.bankBin', before: '970436', after: '970422' },
      { field: 'receivingAccount.accountNumber', before: '0011…4567', after: '0011…9999' },
    ])
  })

  test('BD-25 an intent that holds the share lock and a change of the receiving account never both win', async () => {
    const config = (await h.building.api.getGatewayConfig(BUILDING, 'payos')) as GatewayConfigDto
    const version = Number((await rowOf())?.version)
    let locked!: () => void
    const held = new Promise<void>((resolve) => {
      locked = resolve
    })
    // The intent: read the configuration with the lock, "create the intent", commit 300 ms later.
    const intent = h.database.run(async () => {
      const read = await h.building.api.getGatewayConfig(BUILDING, 'payos', { lock: 'share' })
      expect(read?.receivingAccount).toEqual(config.receivingAccount)
      locked()
      await Bun.sleep(300)
      h.probeState.active = true
    })
    await held
    const change = h.building.gateway.save(
      admin,
      input({ version, receivingAccount: { ...ACCOUNT, accountNumber: '0011555555555' } }),
    )
    await intent
    // The change waited for the intent's transaction, then saw the intent and refused.
    await expect(change).rejects.toBeInstanceOf(GatewayInUseError)
    expect((await rowOf())?.receiving_account).toEqual(config.receivingAccount)
    h.probeState.active = false
  })

  test('BD-27 fake is for the demo building only', async () => {
    await expect(
      h.building.gateway.save(
        admin,
        input({ provider: 'vietqr', driver: 'fake', secrets: {}, version: undefined }),
      ),
    ).rejects.toMatchObject({ details: [{ code: 'driver_not_allowed' }] })
    const demoAdmin = h.staff('admin', DEMO_BUILDING)
    const saved = await h.building.gateway.save(demoAdmin, input({ driver: 'fake', secrets: {} }))
    expect(saved.config).toMatchObject({ driver: 'fake', secrets: {} })
    expect((await h.building.gateway.view(demoAdmin)).drivers.fake.allowed).toBe(true)
  })

  test('a Manager, Technician or Guard cannot read or change the gateway', async () => {
    for (const role of ['manager', 'technician', 'guard'] as const) {
      await expect(h.building.gateway.view(h.staff(role))).rejects.toBeInstanceOf(ForbiddenError)
      await expect(h.building.gateway.save(h.staff(role), input())).rejects.toBeInstanceOf(
        ForbiddenError,
      )
    }
  })

  test('a new configuration needs every field of the driver, and a field of another driver is refused', async () => {
    const demoAdmin = h.staff('admin', DEMO_BUILDING)
    await expect(
      h.building.gateway.save(
        demoAdmin,
        input({ provider: 'vietqr', driver: 'vietqr', secrets: { clientId: 'only-one' } }),
      ),
    ).rejects.toMatchObject({ details: [{ path: 'secrets.apiKey', code: 'required' }] })
    await expect(
      h.building.gateway.save(
        demoAdmin,
        input({
          provider: 'vietqr',
          driver: 'vietqr',
          secrets: { clientId: 'a', apiKey: 'b', extra: 'c' },
        }),
      ),
    ).rejects.toMatchObject({ details: [{ path: 'secrets.extra', code: 'unknown_key' }] })
    await expect(
      h.building.gateway.save(
        demoAdmin,
        input({ receivingAccount: { ...ACCOUNT, accountNumber: '12' } }),
      ),
    ).rejects.toMatchObject({ details: [{ path: 'receivingAccount.accountNumber' }] })
  })
})

describe('terms and privacy (DOC-35 §9, DOC-36 §8)', () => {
  const text = (heading = 'Scope') => ({
    vi: `## 1. Phạm vi\nPhí được thanh toán **đầy đủ** theo từng khoản.\n\n- ${heading}`,
    en: `## 1. Scope\nFees are paid **in full** per charge.\n\n- ${heading}`,
  })
  const resident = () => h.ids.next()

  test('AD-37 a building with no published version requires nothing', async () => {
    const account = resident()
    expect(await h.building.api.missingTerms(account, BUILDING)).toEqual([])
    expect(await h.building.api.hasAcceptedLatestTerms(account, BUILDING)).toBe(true)
  })

  test('publish writes the next number of its kind and an audit row; the two kinds are numbered separately (AD-34)', async () => {
    const [t1, t2, t3, p1] = [
      await h.building.terms.publish(admin, { kind: 'terms', text: text('one') }),
      await h.building.terms.publish(admin, { kind: 'terms', text: text('two') }),
      await h.building.terms.publish(admin, { kind: 'terms', text: text('three') }),
      await h.building.terms.publish(admin, { kind: 'privacy', text: text('privacy') }),
    ]
    expect([t1.version, t2.version, t3.version, p1.version]).toEqual([1, 2, 3, 1])
    const rows = await h.db
      .sql`SELECT details, object_type FROM audit.audit_log WHERE action = 'building.terms.publish' ORDER BY id`
    expect(rows.map((r) => r.details)).toEqual([
      { kind: 'terms', version: 1 },
      { kind: 'terms', version: 2 },
      { kind: 'terms', version: 3 },
      { kind: 'privacy', version: 1 },
    ])
  })

  test('AD-34 the gate lists only the kinds that the account has not accepted', async () => {
    const account = resident()
    const first = await h.building.api.missingTerms(account, BUILDING)
    expect(first.map((m) => [m.kind, m.version])).toEqual([
      ['privacy', 1],
      ['terms', 3],
    ])
    await h.building.terms.accept({
      accountId: account,
      buildingId: BUILDING,
      versionIds: [first[1]?.versionId as string],
      ip: null,
      appVersion: null,
    })
    expect((await h.building.api.missingTerms(account, BUILDING)).map((m) => m.kind)).toEqual([
      'privacy',
    ])
    expect(await h.building.api.hasAcceptedLatestTerms(account, BUILDING)).toBe(false)
  })

  test('AD-35 accepting twice is fine; a superseded version is 409 with the current ones; an unknown id is 404', async () => {
    const account = resident()
    const [privacy, terms] = await h.building.api.missingTerms(account, BUILDING)
    const accept = (versionIds: string[]) =>
      h.building.terms.accept({
        accountId: account,
        buildingId: BUILDING,
        versionIds,
        ip: '203.0.113.7',
        appVersion: '1.4.0',
      })
    await accept([privacy?.versionId as string, terms?.versionId as string])
    await accept([terms?.versionId as string])
    expect(await h.building.api.hasAcceptedLatestTerms(account, BUILDING)).toBe(true)

    const [v1] = await h.db
      .sql`SELECT id FROM building.terms_version WHERE kind = 'terms' AND version = 1`
    const error = await accept([v1?.id]).then(
      () => null,
      (e) => e,
    )
    expect(error).toBeInstanceOf(TermsVersionSupersededError)
    expect(error.details.current).toEqual(
      expect.arrayContaining([{ kind: 'terms', version: 3, versionId: terms?.versionId }]),
    )
    await expect(accept([crypto.randomUUID()])).rejects.toMatchObject({ code: 'not_found' })
    // a version of another building is not found either
    await expect(
      h.building.terms.accept({
        accountId: account,
        buildingId: DEMO_BUILDING,
        versionIds: [terms?.versionId as string],
        ip: null,
        appVersion: null,
      }),
    ).rejects.toMatchObject({ code: 'not_found' })
  })

  test('AD-36 an acceptance row keeps the account, version, time, IP and app version', async () => {
    const account = resident()
    const [, terms] = await h.building.api.missingTerms(account, BUILDING)
    await h.building.terms.accept({
      accountId: account,
      buildingId: BUILDING,
      versionIds: [terms?.versionId as string],
      ip: '203.0.113.7',
      appVersion: '1.4.0',
    })
    const [row] = await h.db
      .sql`SELECT * FROM building.terms_acceptance WHERE account_id = ${account}`
    expect(row).toMatchObject({
      building_id: BUILDING,
      version_id: terms?.versionId,
      ip: '203.0.113.7',
      app_version: '1.4.0',
    })
    expect(row?.accepted_at).toBeInstanceOf(Date)
  })

  test('AD-33 a new version is refused at the very next request of everyone who accepted the old one', async () => {
    const accounts = Array.from({ length: 5 }, resident)
    for (const account of accounts) {
      const missing = await h.building.api.missingTerms(account, BUILDING)
      await h.building.terms.accept({
        accountId: account,
        buildingId: BUILDING,
        versionIds: missing.map((m) => m.versionId),
        ip: null,
        appVersion: null,
      })
      expect(await h.building.api.hasAcceptedLatestTerms(account, BUILDING)).toBe(true)
    }
    const v4 = await h.building.terms.publish(admin, { kind: 'terms', text: text('four') })
    for (const account of accounts) {
      const missing = await h.building.api.missingTerms(account, BUILDING)
      expect(missing).toEqual([{ kind: 'terms', version: 4, versionId: v4.id }])
      await h.building.terms.accept({
        accountId: account,
        buildingId: BUILDING,
        versionIds: [v4.id],
        ip: null,
        appVersion: null,
      })
      expect(await h.building.api.hasAcceptedLatestTerms(account, BUILDING)).toBe(true)
    }
  })

  test('BD-44 a text outside the Markdown subset is 400 terms_text with the language and the line; nothing is published', async () => {
    const before = Number(
      (await h.db.sql`SELECT count(*)::int AS n FROM building.terms_version`)[0]?.n,
    )
    const bad = (vi: string) =>
      h.building.terms.publish(admin, { kind: 'terms', text: { vi, en: 'ok' } }).then(
        () => null,
        (e) => e,
      )
    expect((await bad('## ok\n\nA <b>bold</b> word')).details).toEqual([
      { path: 'text.vi:3', code: 'terms_text', message: 'html' },
    ])
    expect((await bad('# Title'))?.details?.[0]).toMatchObject({
      path: 'text.vi:1',
      message: 'heading_level',
    })
    expect((await bad('[x](http://example.com)'))?.details?.[0]).toMatchObject({ message: 'link' })
    const english = await h.building.terms
      .publish(admin, { kind: 'terms', text: { vi: 'tốt', en: '<script>' } })
      .then(
        () => null,
        (e) => e,
      )
    expect(english?.details?.[0]?.path).toBe('text.en:1')
    expect(
      Number((await h.db.sql`SELECT count(*)::int AS n FROM building.terms_version`)[0]?.n),
    ).toBe(before)
  })

  test('BD-45 two Admins publishing the next version at the same time: one wins, the other gets 409', async () => {
    const results = await Promise.allSettled([
      h.building.terms.publish(h.staff('admin'), { kind: 'privacy', text: text('a') }),
      h.building.terms.publish(h.staff('admin'), { kind: 'privacy', text: text('b') }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toBeInstanceOf(VersionConflictError)
    const versions = await h.db
      .sql`SELECT version FROM building.terms_version WHERE kind = 'privacy' ORDER BY version`
    expect(versions.map((v) => v.version)).toEqual([1, 2])
  })

  test('BD-46 both languages are required for a real building; the demo building may publish vi only', async () => {
    await expect(
      h.building.terms.publish(admin, { kind: 'terms', text: { vi: '## Chỉ tiếng Việt' } }),
    ).rejects.toMatchObject({
      details: [{ path: 'text.en', code: 'required' }],
    })
    const demo = await h.building.terms.publish(h.staff('admin', DEMO_BUILDING), {
      kind: 'terms',
      text: { vi: '## Chỉ tiếng Việt' },
    })
    expect(demo.version).toBe(1)
  })

  test('only the Admin publishes terms', async () => {
    for (const role of ['manager', 'technician', 'guard'] as const)
      await expect(
        h.building.terms.publish(h.staff(role), { kind: 'terms', text: text() }),
      ).rejects.toBeInstanceOf(ForbiddenError)
  })
})
