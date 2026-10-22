import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  ForbiddenError,
  PreconditionRequiredError,
  RuleViolationError,
  VersionConflictError,
} from '@core/kernel'
import { Value } from '@sinclair/typebox/value'
import { sql } from 'drizzle-orm'
import {
  BuildingPatchSchema,
  DEFAULT_SETTINGS,
  SettingsPatchSchema,
  SettingsUpdateSchema,
} from '../src/contracts'
import { BUILDING, createHarness, DEMO_BUILDING, type Harness, jpeg } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness({ settingsCacheSeconds: 60 })
  theAdmin = h.staff('admin')
})
afterAll(async () => {
  await h.close()
})

// The same Admin throughout (a file can be attached only by the account that registered it); BD-09 uses two.
let theAdmin: ReturnType<Harness['staff']>
const admin = () => theAdmin
const settingsRow = async () =>
  (
    await h.db
      .sql`SELECT data, version FROM building.building_setting WHERE building_id = ${BUILDING}`
  )[0]
const buildingRow = async () =>
  (await h.db.sql`SELECT * FROM building.building WHERE id = ${BUILDING}`)[0]
const auditRows = async (action: string) =>
  h.db
    .sql`SELECT action, actor_role, object_type, object_id, changes, details FROM audit.audit_log WHERE action = ${action} ORDER BY id`
const etag = async () => (await h.building.settings.get(admin())).etag

describe('settings (DOC-36 §4, §5)', () => {
  test('BD-04 getSettings gives the defaults for {} and the saved keys over them', async () => {
    expect(await h.building.api.getSettings(BUILDING)).toEqual(DEFAULT_SETTINGS)
    const current = await etag()
    await h.building.settings.update(admin(), {
      etag: current,
      settings: { defaultDueDays: 12, lockout: { maxAttempts: 7, minutes: 30 } },
    })
    expect(await h.building.api.getSettings(BUILDING)).toEqual({
      ...DEFAULT_SETTINGS,
      defaultDueDays: 12,
      lockout: { maxAttempts: 7, minutes: 30 },
    })
    // an unknown building has the defaults too: the row is the Admin's, the defaults are the code's
    expect(await h.building.api.getSettings(crypto.randomUUID())).toEqual(DEFAULT_SETTINGS)
  })

  test('BD-01 the Admin saves and the change is audited with the keys that changed; a Manager gets 403', async () => {
    const current = await etag()
    const document = await h.building.settings.update(admin(), {
      etag: current,
      settings: { feeNoticeLanguage: 'both' },
    })
    expect(document.settings.feeNoticeLanguage).toBe('both')
    expect(document.saved).toEqual(expect.arrayContaining(['feeNoticeLanguage', 'defaultDueDays']))
    const rows = await auditRows('building.settings.update')
    expect(rows.at(-1)).toMatchObject({
      actor_role: 'admin',
      object_type: 'building_setting',
      object_id: BUILDING,
      changes: [{ field: 'feeNoticeLanguage', before: 'vi', after: 'both' }],
    })
    for (const role of ['manager', 'technician', 'guard'] as const) {
      await expect(h.building.settings.get(h.staff(role))).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        h.building.settings.update(h.staff(role), {
          etag: document.etag,
          settings: { defaultDueDays: 5 },
        }),
      ).rejects.toBeInstanceOf(ForbiddenError)
    }
  })

  test('BD-02 a value out of range is 422 setting_invalid with its path; an unknown key and a wrong type are refused by the shape', async () => {
    const current = await etag()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ defaultDueDays: -1 }, 'settings.defaultDueDays'],
      [{ feeNoticeLanguage: 'fr' }, 'settings.feeNoticeLanguage'],
      [{ lockout: { maxAttempts: 5, minutes: 4 } }, 'settings.lockout.minutes'],
      [{ storageQuotaBytes: 1000 }, 'settings.storageQuotaBytes'],
      [{ maxCarsPerUnit: 21 }, 'settings.maxCarsPerUnit'],
    ]
    const before = await settingsRow()
    for (const [settings, path] of cases) {
      const error = await h.building.settings
        .update(admin(), { etag: current, settings: settings as never })
        .then(
          () => null,
          (e) => e,
        )
      expect(error).toBeInstanceOf(RuleViolationError)
      expect(error.details).toEqual([expect.objectContaining({ code: 'setting_invalid', path })])
    }
    expect(Value.Check(SettingsPatchSchema, { defaultDueDays: 'ten' })).toBe(false)
    expect(Value.Check(SettingsPatchSchema, { unknownKey: 1 })).toBe(false)
    expect(Value.Check(SettingsPatchSchema, { lockout: { maxAttempts: 5 } })).toBe(false)
    expect(Value.Check(SettingsPatchSchema, { defaultDueDays: 15, maxCarsPerUnit: null })).toBe(
      true,
    )
    expect(await settingsRow()).toEqual(before)
  })

  test('BD-05 a patch sets two keys and removes one: the removed key answers its default and the version moves by one', async () => {
    await h.building.settings.update(admin(), {
      etag: await etag(),
      settings: { maxCarsPerUnit: 3 },
    })
    const before = await settingsRow()
    await h.building.settings.update(admin(), {
      etag: await etag(),
      settings: { defaultDueDays: 15, feeNoticeLanguage: 'both', maxCarsPerUnit: null },
    })
    const after = await settingsRow()
    expect(after?.data).toMatchObject({ defaultDueDays: 15, feeNoticeLanguage: 'both' })
    expect(after?.data).not.toHaveProperty('maxCarsPerUnit')
    expect(after?.version).toBe(before?.version + 1)
    expect((await h.building.api.getSettings(BUILDING)).maxCarsPerUnit).toBe(
      DEFAULT_SETTINGS.maxCarsPerUnit,
    )
    const last = (await auditRows('building.settings.update')).at(-1)
    expect(last?.changes).toEqual(
      expect.arrayContaining([
        { field: 'maxCarsPerUnit', before: 3, after: 2 },
        { field: 'defaultDueDays', before: 12, after: 15 },
      ]),
    )
  })

  test('BD-06 a stale If-Match is 409 with the fresh document; a missing one is 428', async () => {
    const stale = await etag()
    await h.building.settings.update(admin(), { etag: stale, settings: { defaultDueDays: 20 } })
    const error = await h.building.settings
      .update(admin(), { etag: stale, settings: { defaultDueDays: 30 } })
      .then(
        () => null,
        (e) => e,
      )
    expect(error).toBeInstanceOf(VersionConflictError)
    expect(error.details.current.settings.defaultDueDays).toBe(20)
    expect(error.details.current.etag).not.toBe(stale)
    await expect(
      h.building.settings.update(admin(), { etag: undefined, settings: { defaultDueDays: 30 } }),
    ).rejects.toBeInstanceOf(PreconditionRequiredError)
    expect((await h.building.api.getSettings(BUILDING)).defaultDueDays).toBe(20)
  })

  test('BD-07 a patch that changes only the hotline moves the building version and leaves the settings alone', async () => {
    const [building0, settings0] = [await buildingRow(), await settingsRow()]
    const document = await h.building.settings.update(admin(), {
      etag: await etag(),
      building: { hotline: '1900 5678' },
    })
    const [building1, settings1] = [await buildingRow(), await settingsRow()]
    expect(building1?.version).toBe(building0?.version + 1)
    expect(building1?.hotline).toBe('1900 5678')
    expect(settings1?.version).toBe(settings0?.version)
    expect(document.building.hotline).toBe('1900 5678')
    expect((await auditRows('building.building.update')).at(-1)?.changes).toEqual([
      { field: 'hotline', before: '1900 1234', after: '1900 5678' },
    ])
  })

  test('BD-08 code, timeZone and isDemo are not editable: the shape refuses them', () => {
    for (const body of [
      { timeZone: 'UTC' },
      { code: 'X-1' },
      { isDemo: true },
      { id: crypto.randomUUID() },
    ])
      expect(Value.Check(BuildingPatchSchema, body)).toBe(false)
    expect(Value.Check(SettingsUpdateSchema, { building: { timeZone: 'UTC' } })).toBe(false)
    expect(
      Value.Check(SettingsUpdateSchema, {
        building: { hotline: null },
        settings: { defaultDueDays: 3 },
      }),
    ).toBe(true)
  })

  test('the rules of DOC-36 §4.2: a bad field is 400 with its path and nothing changes', async () => {
    const before = await buildingRow()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: { vi: '' } }, 'building.name.vi'],
      [{ company: { name: { vi: 'Công ty' }, taxCode: '12-34' } }, 'building.company.taxCode'],
      [{ hotline: 'call me maybe' }, 'building.hotline'],
      [{ email: 'not an email' }, 'building.email'],
      [{ address: '' }, 'building.address'],
      [{ workingHours: { vi: '' } }, 'building.workingHours.vi'],
    ]
    for (const [building, path] of cases) {
      const error = await h.building.settings
        .update(admin(), { etag: await etag(), building: building as never })
        .then(
          () => null,
          (e) => e,
        )
      expect(error?.code).toBe('validation_failed')
      expect(error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]))
    }
    expect(await buildingRow()).toEqual(before)
  })

  test('the building email and company contact are masked in the audit row', async () => {
    await h.building.settings.update(admin(), {
      etag: await etag(),
      building: {
        email: 'bql@sunrise.example',
        company: {
          name: { vi: 'Công ty Sunrise' },
          taxCode: '0312345678',
          phone: '028 3822 0000',
          email: 'office@sunrise.example',
        },
      },
    })
    const changes = (await auditRows('building.building.update')).at(-1)?.changes as Array<{
      field: string
      after: string | null
    }>
    expect(changes.find((c) => c.field === 'email')?.after).toBe('b•••@sunrise.example')
    expect(changes.find((c) => c.field === 'company.email')?.after).toBe('o•••@sunrise.example')
    expect(changes.find((c) => c.field === 'company.phone')?.after).toBe('•••••000')
    expect(JSON.stringify(changes)).not.toContain('bql@')
  })

  test('BD-09 two Admins saving at the same version: one succeeds, the other gets 409', async () => {
    const current = await etag()
    const results = await Promise.allSettled([
      h.building.settings.update(h.staff('admin'), {
        etag: current,
        settings: { defaultDueDays: 31 },
      }),
      h.building.settings.update(h.staff('admin'), {
        etag: current,
        settings: { defaultDueDays: 32 },
      }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(loser.reason).toBeInstanceOf(VersionConflictError)
    expect([31, 32]).toContain((await h.building.api.getSettings(BUILDING)).defaultDueDays)
  })

  test('BD-11 another process sees a change within the cache time; the saving process sees it at once', async () => {
    const current = await etag()
    expect((await h.building.api.getSettings(BUILDING)).defaultDueDays).toBeGreaterThan(0)
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = data || '{"defaultDueDays": 44}', version = version + 1 WHERE building_id = '${BUILDING}'`,
    )
    expect((await h.building.api.getSettings(BUILDING)).defaultDueDays).not.toBe(44)
    h.clock.advance(61_000)
    expect((await h.building.api.getSettings(BUILDING)).defaultDueDays).toBe(44)
    await h.building.settings.update(admin(), {
      etag: await etag(),
      settings: { defaultDueDays: 9 },
    })
    expect((await h.building.api.getSettings(BUILDING)).defaultDueDays).toBe(9)
    void current
  })

  test('BD-12 a quota lowered under the usage is accepted, and the next register is 413', async () => {
    const actor = h.resident()
    const body = await jpeg(640, 480)
    const first = await h.building.files.register(actor, {
      module: 'identity',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: body.byteLength,
    })
    expect(first.fileId).toBeDefined()
    await h.building.settings.update(admin(), {
      etag: await etag(),
      settings: { storageQuotaBytes: 1_073_741_824 },
    })
    const filler = h.ids.next()
    await h.admin.unsafe(`
      INSERT INTO building.file_object (id, building_id, module, purpose, object_key, mime, size, status, account_kind, account_id, verified_at, attached_at)
      VALUES ('${filler}', '${BUILDING}', 'tickets', 'ticket_media', 'test/${BUILDING}/tickets/2026/10/${filler}.jpg', 'image/jpeg',
              2000000000, 'attached', 'system', '00000000-0000-0000-0000-000000000000', now(), now())`)
    await expect(
      h.building.files.register(actor, {
        module: 'identity',
        purpose: 'avatar',
        mime: 'image/jpeg',
        size: 1000,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' })
    expect((await h.building.files.usage(BUILDING)).ratio).toBeGreaterThan(1)
    // put things back for the tests after this one
    await h.admin.unsafe(`DELETE FROM building.file_object WHERE id = '${filler}'`)
    await h.building.settings.update(admin(), {
      etag: await etag(),
      settings: { storageQuotaBytes: null },
    })
  })

  test('BD-13 accountDeletionDays can be read after a change', async () => {
    await h.building.settings.update(admin(), {
      etag: await etag(),
      settings: { accountDeletionDays: 7 },
    })
    expect((await h.building.api.getSettings(BUILDING)).accountDeletionDays).toBe(7)
  })
})

describe('the logo (DOC-36 §4.2, BD-10)', () => {
  async function logoFile() {
    const actor = h.actorOf(admin())
    const body = new Uint8Array(
      await (await import('sharp'))
        .default({
          create: { width: 400, height: 400, channels: 3, background: { r: 51, g: 170, b: 119 } },
        })
        .png()
        .toBuffer(),
    )
    const ticket = await h.building.files.register(actor, {
      module: 'building',
      purpose: 'logo',
      mime: 'image/png',
      size: body.byteLength,
    })
    await h.clientPut(ticket, body)
    await h.building.files.verify(actor, ticket.fileId)
    return ticket.fileId
  }
  const status = async (id: string) => (await h.fileRow(id))?.status

  test('BD-10 a replaced logo: the new file is attached and the old one goes through remove in the same transaction', async () => {
    const [first, second] = [await logoFile(), await logoFile()]
    const staff = admin()
    const withFirst = await h.building.settings.update(staff, {
      etag: await etag(),
      building: { logoFileId: first },
    })
    expect(withFirst.building.logoFileId).toBe(first)
    expect(withFirst.building.logoUrl).toContain('/')
    expect(await h.fileRow(first)).toMatchObject({
      status: 'attached',
      owner_ref: `building:${BUILDING}`,
    })

    await h.building.settings.update(staff, {
      etag: await etag(),
      building: { logoFileId: second },
    })
    expect(await status(first)).toBe('deleted')
    expect(await status(second)).toBe('attached')
    expect((await buildingRow())?.logo_file).toBe(second)
  })

  test('BD-10 when the transaction fails after the swap, the old logo is kept and the new file stays verified', async () => {
    const [current, replacement] = [(await buildingRow())?.logo_file as string, await logoFile()]
    await h.admin.unsafe('ALTER TABLE audit.audit_log RENAME TO audit_log_away')
    try {
      await expect(
        h.building.settings.update(admin(), {
          etag: await etag(),
          building: { logoFileId: replacement },
        }),
      ).rejects.toBeDefined()
    } finally {
      await h.admin.unsafe('ALTER TABLE audit.audit_log_away RENAME TO audit_log')
    }
    expect((await buildingRow())?.logo_file).toBe(current)
    expect(await status(current)).toBe('attached')
    expect(await status(replacement)).toBe('verified')
  })

  test('a file that is not a logo is refused, and null removes the logo', async () => {
    const actor = h.resident()
    const ticket = await h.building.files.register(actor, {
      module: 'identity',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: 100,
    })
    await expect(
      h.building.settings.update(admin(), {
        etag: await etag(),
        building: { logoFileId: ticket.fileId },
      }),
    ).rejects.toMatchObject({ details: [{ code: 'not_a_logo' }] })
    const logo = (await buildingRow())?.logo_file as string
    const document = await h.building.settings.update(admin(), {
      etag: await etag(),
      building: { logoFileId: null },
    })
    expect(document.building.logoFileId).toBeNull()
    expect(document.building.logoUrl).toBeNull()
    expect(await status(logo)).toBe('deleted')
  })
})

describe('BuildingApi (DOC-36 §3)', () => {
  test('getBuilding, listBuildings and isDemo; an unknown id is null and false', async () => {
    expect(await h.building.api.getBuilding(BUILDING)).toMatchObject({
      buildingId: BUILDING,
      code: 'SUNRISE-A',
      timeZone: 'Asia/Ho_Chi_Minh',
      isDemo: false,
    })
    expect((await h.building.api.listBuildings()).map((b) => [b.code, b.isDemo])).toEqual([
      ['DEMO-A', true],
      ['SUNRISE-A', false],
    ])
    expect(await h.building.api.isDemo(DEMO_BUILDING)).toBe(true)
    expect(await h.building.api.isDemo(BUILDING)).toBe(false)
    expect(await h.building.api.isDemo(crypto.randomUUID())).toBe(false)
    expect(await h.building.api.getBuilding(crypto.randomUUID())).toBeNull()
  })

  test('the feature flags are the same map for every building', async () => {
    expect(await h.building.features.get(BUILDING)).toEqual({ ticketDeadlines: false })
    expect(await h.building.features.get(DEMO_BUILDING)).toEqual({ ticketDeadlines: false })
  })

  test('BD-04 a stored value outside its rule falls back to the default instead of breaking a request', async () => {
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = '{"defaultDueDays": 9999, "lockout": {"maxAttempts": 1, "minutes": 20}}' WHERE building_id = '${DEMO_BUILDING}'`,
    )
    const settings = await h.building.api.getSettings(DEMO_BUILDING)
    expect(settings.defaultDueDays).toBe(DEFAULT_SETTINGS.defaultDueDays)
    expect(settings.lockout).toEqual({ maxAttempts: 5, minutes: 20 })
    void sql
  })
})
