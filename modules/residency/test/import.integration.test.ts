import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import {
  BUILDING,
  createHarness,
  type Harness,
  HEADER,
  OTHER_BUILDING,
  workbookOf,
} from './support'

/**
 * The units-and-owners import on PostgreSQL 18.6 (DOC-18 §4, DOC-27 §9, §17): validation to a stored preview, the commit in one
 * transaction, and what happens when the data, the clock or a second press of "Save" gets in the way.
 */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const failure = async (promise: Promise<unknown>): Promise<DomainError> => {
  try {
    await promise
  } catch (error) {
    return error as DomainError
  }
  throw new Error('expected a failure')
}

let counter = 0
/** A phone and a unit prefix no other test uses, so the tests share one database. */
const fresh = () => {
  counter++
  const n = String(counter).padStart(2, '0')
  return {
    n,
    unit: (suffix: string | number) => `T${n}-${suffix}`,
    phone: (i: number) => `09${n}00${String(i).padStart(4, '0')}`,
  }
}

const uploadOf = async (
  staff: ReturnType<Harness['staff']>,
  rows: readonly (readonly unknown[])[],
) => h.files.put(staff.staffId, await workbookOf([HEADER, ...rows]))

const validate = async (
  staff: ReturnType<Harness['staff']>,
  rows: readonly (readonly unknown[])[],
) => {
  const fileId = await uploadOf(staff, rows)
  return {
    job: await h.residency.useCases.validateUnitOwnerImport.execute(staff, { fileId }),
    fileId,
  }
}

const commit = (staff: ReturnType<Harness['staff']>, importId: string) =>
  h.residency.useCases.commitUnitOwnerImport.execute(staff, importId)

async function seedAccount(phone: string, name: string) {
  const id = h.ids.next()
  await h.admin`INSERT INTO identity.resident_account (id, phone, display_name) VALUES (${id}, ${phone}, ${name})`
  return id
}

const count = async (table: string, where = '') => {
  const [row] = await h.admin.unsafe(`SELECT count(*)::int AS n FROM residency.${table} ${where}`)
  return (row as unknown as { n: number }).n
}

const unitsOf = (prefix: string) => `WHERE building_id = '${BUILDING}' AND code LIKE '${prefix}-%'`

describe('the sample building of DOC-18 §1.6', () => {
  const t = fresh()
  const an = { phone: `+849${t.n}000001` }
  // The accounts and units of the sample, then the seven rows of its table.
  let staff: ReturnType<Harness['staff']>
  const accounts: Record<string, string> = {}
  const units: Record<string, string> = {}
  const rows = (): unknown[][] => [
    [
      t.unit(1508),
      15,
      2,
      '68,5',
      'occupied',
      'Nguyễn Văn An',
      '0901234567',
      'an@example.com',
      '079085012345',
      '03/04/1985',
    ],
    [
      t.unit(1509),
      '',
      '',
      '',
      'Đang ở',
      'Trần Thị Bình',
      '0912345678',
      'binh@example.com',
      12345678912,
      '',
    ],
    [t.unit(1510), '', '', '', '', 'Phạm Thị Dung', '0934567890', '', '', ''],
    [t.unit(1511), 16, 3, 80, '', 'Võ Thị Hà', '0956789012', '', '', ''],
    [t.unit(1512), '', '', '', '', 'Phạm Thị Dung', '0934567890', '', '', ''],
    [t.unit(1513), '', '', '', '', 'Ngô Văn Khoa', '0901234567', '', '', ''],
    [t.unit(1508).toLowerCase(), '', '', '', '', '', '', '', '', ''],
  ]
  void an

  beforeAll(async () => {
    staff = h.staff()
    // The phones of the sample are shared by the whole database: remove the ones an earlier test file left behind.
    await h.admin`DELETE FROM identity.resident_account WHERE phone IN ('+84901234567', '+84912345678', '+84934567890', '+84956789012')`
    for (const [key, phone, name] of [
      ['an', '+84901234567', 'Nguyễn Văn An'],
      ['binh', '+84912345678', 'Trần Thị Bình'],
      ['cuong', '+84987654321', 'Lê Văn Cường'],
      ['dung', '+84934567890', 'Phạm Thị Dung'],
    ] as const)
      accounts[key] = await seedAccount(phone, name)
    for (const [code, floor] of [
      [t.unit(1508), 15],
      [t.unit(1509), 15],
      [t.unit(1510), 15],
      [t.unit(1512), 15],
    ] as const) {
      units[code] = h.ids.next()
      await h.admin`INSERT INTO residency.unit (id, building_id, code, floor, occupancy) VALUES (${units[code]}, ${BUILDING}, ${code}, ${floor}, 'occupied')`
    }
    const owner = (account: string, unit: string, type = 'owner') =>
      h.seedMembership({
        accountId: account,
        unit: { id: unit, buildingId: BUILDING },
        memberType: type as 'owner',
      })
    await owner(accounts.an as string, units[t.unit(1508)] as string)
    await owner(accounts.cuong as string, units[t.unit(1510)] as string)
    await owner(accounts.dung as string, units[t.unit(1512)] as string, 'family')
    await h.seedProfile(accounts.an as string)
    await h.admin`UPDATE residency.resident_profile SET email = 'an@example.com', cccd_enc = 'v1:k1:x:y', cccd_last4 = '2345', date_of_birth = '1985-04-03' WHERE account_id = ${accounts.an as string}`
  })

  test('IM-29 the preview has the counts and the row outcomes of the table', async () => {
    const { job } = await validate(staff, rows())
    expect(job.status).toBe('validated')
    expect(job.result.counts).toEqual({
      rows: 7,
      valid: 3,
      errors: 4,
      warnings: 1,
      unitsToCreate: 1,
      unitsToUpdate: 2,
      accountsToCreate: 1,
      accountsLinked: 2,
      ownersToAdd: 2,
      ownersUnchanged: 1,
    })
    expect(job.result.issues.map((i) => [i.row, i.code])).toEqual([
      [4, 'owner_conflict'],
      [6, 'owner_is_member'],
      [7, 'phone_conflict'],
      [8, 'unit_code_duplicate'],
      // The number cell of row 3 lost its zero in Excel (DQ-22): a warning, the row is valid.
      [3, 'id_number_padded'],
    ])
    expect(job.result.issues[0]?.unitCode).toBe(t.unit(1510))
    expect(job.expiresAt.getTime() - job.createdAt.getTime()).toBe(24 * 3_600_000)
    // Nothing was written to the units tables (E-72).
    expect(await count('unit', unitsOf(`T${t.n}`))).toBe(4)
  })

  test('IM-32 the stored preview holds neither an ID number nor a date of birth', async () => {
    const { job } = await validate(staff, rows())
    const [stored] =
      await h.admin`SELECT result::text AS text FROM residency.import_job WHERE id = ${job.id}`
    expect(stored?.text).not.toContain('079085012345')
    expect(stored?.text).not.toContain('12345678912')
    expect(stored?.text).not.toContain('1985')
    expect(job.result.validRows[1]?.ownerIdNumber).toBe('•••• 8912')
  })

  test('IM-38 the commit writes 3 units, 2 owners, 2 history rows, 1 audit row, the profiles; IM-39 the file goes', async () => {
    const { job, fileId } = await validate(staff, rows())
    const before = {
      history: await count('unit_history'),
      events: (await h.events('residency.owner_changed.v1')).length,
    }
    const { committed } = await commit(staff, job.id)
    expect(committed).toEqual({
      unitsCreated: 1,
      unitsUpdated: 2,
      accountsCreated: 1,
      accountsLinked: 2,
      ownersAdded: 2,
    })

    expect(await count('unit', unitsOf(`T${t.n}`))).toBe(5)
    const owners = await h.admin`
      SELECT u.code, m.account_id FROM residency.membership m JOIN residency.unit u ON u.id = m.unit_id
       WHERE m.member_type = 'owner' AND m.status <> 'removed' AND u.code LIKE ${`T${t.n}-%`} ORDER BY u.code`
    expect(owners.map((o) => o.code)).toEqual([
      t.unit(1508),
      t.unit(1509),
      t.unit(1510),
      t.unit(1511),
    ])
    expect(
      await count('unit_history', `WHERE kind = 'owner_changed' AND details->>'source' = 'import'`),
    ).toBe(2)
    expect((await count('unit_history')) - before.history).toBe(2)
    expect((await h.events('residency.owner_changed.v1')).length - before.events).toBe(2)

    const [audit] =
      await h.admin`SELECT action, details FROM audit.audit_log WHERE object_id = ${job.id}`
    expect(audit?.action).toBe('residency.import.commit')
    expect(audit?.details).toMatchObject({ unitsCreated: 1, unitsUpdated: 2, ownersAdded: 2 })

    // The new account is the owner of A-1511 and its profile holds the name; the existing profile of An kept its values.
    const [ha] =
      await h.admin`SELECT id FROM identity.resident_account WHERE phone = '+84956789012'`
    const [profile] =
      await h.admin`SELECT full_name FROM residency.resident_profile WHERE account_id = ${ha?.id as string}`
    expect(profile?.full_name).toBe('Võ Thị Hà')
    const [binh] =
      await h.admin`SELECT full_name, email, cccd_last4, cccd_enc FROM residency.resident_profile WHERE account_id = ${accounts.binh as string}`
    expect(binh).toMatchObject({
      full_name: 'Trần Thị Bình',
      email: 'binh@example.com',
      cccd_last4: '8912',
    })
    expect(binh?.cccd_enc).toMatch(/^v1:/)
    expect(h.files.stored.get(fileId)?.status).toBe('deleted')

    const [row] =
      await h.admin`SELECT status, committed_at FROM residency.import_job WHERE id = ${job.id}`
    expect(row?.status).toBe('committed')
  })
})

const owner = (name: string, phone: string) => [name, phone, '', '', ''] as const
const row = (code: string, cells: readonly unknown[] = []) => [code, '', '', '', '', ...cells]

describe('the commit and what gets in its way', () => {
  test('IM-33 a second "Save" answers the first result and writes nothing; two at once commit once', async () => {
    const t = fresh()
    const staff = h.staff()
    const rows = [
      row(t.unit(1), owner('Lê Thị Cúc', t.phone(1))),
      row(t.unit(2), owner('Lê Thị Cúc', t.phone(1))),
    ]
    const { job } = await validate(staff, rows)
    const [first, second] = await Promise.all([commit(staff, job.id), commit(staff, job.id)])
    expect(second.committed).toEqual(first.committed)
    expect(first.committed).toMatchObject({ unitsCreated: 2, accountsCreated: 1, ownersAdded: 2 })
    expect(await count('unit', unitsOf(`T${t.n}`))).toBe(2)
    expect(
      await count(
        'unit_history',
        `WHERE details->>'source' = 'import' AND unit_id IN (SELECT id FROM residency.unit WHERE code LIKE 'T${t.n}-%')`,
      ),
    ).toBe(2)
    const audits = await h.admin`SELECT 1 FROM audit.audit_log WHERE object_id = ${job.id}`
    expect(audits).toHaveLength(1)
    // Run twice: the events and the accounts are not doubled.
    const again = await commit(staff, job.id)
    expect(again.committed).toEqual(first.committed)
    const [accounts] =
      await h.admin`SELECT count(*)::int AS n FROM identity.resident_account WHERE phone = ${`+849${t.n}000001`}`
    expect(accounts?.n).toBe(1)
    const events = (await h.events('residency.owner_changed.v1')).filter((e) =>
      String((e.payload as { unitCode: string }).unitCode).startsWith(`T${t.n}-`),
    )
    expect(events).toHaveLength(2)
  })

  test('IM-34 an owner set between the preview and the commit: import_stale, nothing written, the job stays validated', async () => {
    const t = fresh()
    const staff = h.staff()
    const { job, fileId } = await validate(staff, [row(t.unit(1), owner('Lê Thị Cúc', t.phone(1)))])
    expect(job.result.counts).toMatchObject({ unitsToCreate: 1, ownersToAdd: 1 })
    // Someone creates the unit with another owner meanwhile (a transfer, the staff API).
    const unit = await h.seedUnit(BUILDING, t.unit(1))
    await h.seedMembership({ unit, memberType: 'owner' })
    const error = await failure(commit(staff, job.id))
    expect(error.code).toBe('import_stale')
    const [stored] = await h.admin`SELECT status FROM residency.import_job WHERE id = ${job.id}`
    expect(stored?.status).toBe('validated')
    expect(await count('membership', `WHERE unit_id = '${unit.id}'`)).toBe(1)
    expect(h.files.stored.get(fileId)?.status).toBe('attached')
  })

  test('IM-35 after expires_at: import_expired, and a read says expired at once', async () => {
    const t = fresh()
    const staff = h.staff()
    const { job } = await validate(staff, [row(t.unit(1))])
    h.clock.advance(24 * 3_600_000 + 1000)
    expect((await failure(commit(staff, job.id))).code).toBe('import_expired')
    expect((await h.residency.queries.imports.get(staff, job.id)).job.status).toBe('expired')
    expect(await count('unit', unitsOf(`T${t.n}`))).toBe(0)
  })

  test('IM-36 a file that could not be read makes a failed job that cannot be committed', async () => {
    const staff = h.staff()
    const fileId = h.files.put(staff.staffId, await workbookOf([['Tầng'], [3]]))
    const job = await h.residency.useCases.validateUnitOwnerImport.execute(staff, { fileId })
    expect(job.status).toBe('failed')
    expect(job.result.counts.rows).toBe(0)
    expect(job.result.issues).toMatchObject([
      { severity: 'fail', code: 'import_no_header', row: 1 },
    ])
    const error = await failure(commit(staff, job.id))
    expect(error).toMatchObject({ code: 'import_not_ready', details: { status: 'failed' } })
  })

  test('IM-01 a file that is not a workbook is a failed job too', async () => {
    const staff = h.staff()
    const fileId = h.files.put(staff.staffId, new TextEncoder().encode('Mã căn hộ\nA-1\n'))
    const job = await h.residency.useCases.validateUnitOwnerImport.execute(staff, { fileId })
    expect(job.result.issues[0]?.code).toBe('import_file_type')
  })

  test('IM-37 a write that does not match the preview rolls back whole', async () => {
    const t = fresh()
    const staff = h.staff()
    const phone = t.phone(1)
    const { job } = await validate(staff, [row(t.unit(1), owner('Lê Thị Cúc', phone))])
    // The account appears between the preview and the write: the commit would link what the preview said it creates.
    const original = h.identity.findOrCreateResidentAccount
    h.identity.findOrCreateResidentAccount = async (p, name) => ({
      accountId: await seedAccount(`+84${p.slice(1)}`, name),
      created: false,
    })
    try {
      const error = await failure(commit(staff, job.id))
      expect(error.code).toBe('internal_error')
      expect(String((error as Error).message)).toContain('import_integrity')
    } finally {
      h.identity.findOrCreateResidentAccount = original
    }
    expect(await count('unit', unitsOf(`T${t.n}`))).toBe(0)
    expect(
      (await h.admin`SELECT status FROM residency.import_job WHERE id = ${job.id}`)[0]?.status,
    ).toBe('validated')
    // (The real `FilesApi.remove` writes inside the transaction and rolls back with it; the in-memory file store cannot.)
  })
})

describe('what a row writes', () => {
  test('IM-10 IM-40 blank cells keep the stored values; a moved-in unit writes its history', async () => {
    const t = fresh()
    const staff = h.staff()
    const id = h.ids.next()
    await h.admin`INSERT INTO residency.unit (id, building_id, code, floor, bedrooms, area_m2, occupancy) VALUES (${id}, ${BUILDING}, ${t.unit(1)}, 7, 2, 70.5, 'vacant')`
    const { job } = await validate(staff, [row(t.unit(1))])
    await commit(staff, job.id)
    const [kept] =
      await h.admin`SELECT floor, bedrooms, area_m2::text, occupancy FROM residency.unit WHERE id = ${id}`
    expect(kept).toEqual({ floor: 7, bedrooms: 2, area_m2: '70.50', occupancy: 'vacant' })
    const rented = [t.unit(1), 8, '', '', 'cho thuê']
    const second = await validate(staff, [rented])
    await commit(staff, second.job.id)
    const [changed] =
      await h.admin`SELECT floor, bedrooms, occupancy FROM residency.unit WHERE id = ${id}`
    expect(changed).toEqual({ floor: 8, bedrooms: 2, occupancy: 'rented' })
    const [moved] =
      await h.admin`SELECT kind, details FROM residency.unit_history WHERE unit_id = ${id}`
    expect(moved).toMatchObject({ kind: 'moved_in', details: { from: 'vacant', to: 'rented' } })
  })

  test('IM-27 IM-28 RM-45 a stored profile is only filled where empty', async () => {
    const t = fresh()
    const staff = h.staff()
    const phone = t.phone(1)
    const accountId = await seedAccount(`+849${t.n}000001`, 'Account name')
    await h.seedProfile(accountId, BUILDING, 'Nguyễn Văn An')
    await h.admin`UPDATE residency.resident_profile SET cccd_enc = 'v1:k1:a:b', cccd_last4 = '1111' WHERE account_id = ${accountId}`
    const cells = ['Nguyễn Văn Anh', phone, 'an@example.com', '079085012345', '03/04/1985']
    const { job } = await validate(staff, [row(t.unit(1), cells)])
    expect(job.result.issues.map((i) => [i.code, i.severity, i.params])).toEqual([
      ['profile_field_differs', 'warning', { field: 'owner_name' }],
      ['profile_field_differs', 'warning', { field: 'owner_id_number' }],
    ])
    await commit(staff, job.id)
    const [profile] =
      await h.admin`SELECT full_name, email, cccd_enc, cccd_last4, date_of_birth::text, version FROM residency.resident_profile WHERE account_id = ${accountId}`
    expect(profile).toMatchObject({
      full_name: 'Nguyễn Văn An',
      email: 'an@example.com',
      cccd_enc: 'v1:k1:a:b',
      cccd_last4: '1111',
      date_of_birth: '1985-04-03',
      version: 2,
    })
    const [account] =
      await h.admin`SELECT display_name FROM identity.resident_account WHERE id = ${accountId}`
    expect(account?.display_name).toBe('Account name')
  })

  test('RM-43 the owner membership is added by staff, active and without a payer flag', async () => {
    const t = fresh()
    const staff = h.staff()
    const { job } = await validate(staff, [row(t.unit(1), owner('Lê Thị Cúc', t.phone(1)))])
    await commit(staff, job.id)
    const [membership] = await h.admin`
      SELECT m.member_type, m.status, m.can_pay, m.added_by_kind, m.added_by, m.credential_version
        FROM residency.membership m JOIN residency.unit u ON u.id = m.unit_id WHERE u.code = ${t.unit(1)}`
    expect(membership).toMatchObject({
      member_type: 'owner',
      status: 'active',
      can_pay: false,
      added_by_kind: 'staff',
      added_by: staff.staffId,
      credential_version: 1,
    })
  })
})

describe('who may import, and whose jobs are whose', () => {
  test('IM-41 IM-43 a technician and a guard are refused; another building sees nothing', async () => {
    const t = fresh()
    const manager = h.staff('manager')
    const { job } = await validate(manager, [row(t.unit(1))])
    for (const role of ['technician', 'guard'] as const) {
      const other = h.staff(role)
      const fileId = await uploadOf(other, [row(t.unit(2))])
      expect(
        (await failure(h.residency.useCases.validateUnitOwnerImport.execute(other, { fileId })))
          .code,
      ).toBe('forbidden')
      expect((await failure(commit(other, job.id))).code).toBe('forbidden')
      expect((await failure(h.residency.queries.imports.get(other, job.id))).code).toBe('forbidden')
    }
    const stranger = h.staff('manager', OTHER_BUILDING)
    expect((await failure(h.residency.queries.imports.get(stranger, job.id))).code).toBe(
      'not_found',
    )
    expect((await failure(commit(stranger, job.id))).code).toBe('not_found')
    const page = await h.residency.queries.imports.list(stranger, { kind: 'unit_owner', limit: 20 })
    expect(page.items).toEqual([])
  })

  test('a file registered by another staff member is not found (E-72 404)', async () => {
    const t = fresh()
    const owner_ = h.staff()
    const fileId = await uploadOf(owner_, [row(t.unit(1))])
    const error = await failure(
      h.residency.useCases.validateUnitOwnerImport.execute(h.staff(), { fileId }),
    )
    expect(error.code).toBe('not_found')
  })
})

describe('IM-42 the history list', () => {
  test('newest first, a cursor, derived expiry, the status filter, counts and no preview rows', async () => {
    const t = fresh()
    // A building of their own: the list is the building's, so the other tests' jobs must not be in it.
    const building = '018f0000-0000-7000-8000-0000000000a1' as typeof BUILDING
    const staff = h.staff('manager', building)
    const make = async (code: string) => {
      const fileId = h.files.put(staff.staffId, await workbookOf([HEADER, row(code)]))
      return (await h.residency.useCases.validateUnitOwnerImport.execute(staff, { fileId })).id
    }
    const j1 = await make(t.unit(1))
    h.clock.advance(2 * 3_600_000)
    const j2 = await make(t.unit(2))
    h.clock.advance(2 * 3_600_000)
    const j3 = await make(t.unit(3))
    h.clock.advance(21 * 3_600_000)
    const { imports } = h.residency.queries
    const first = await imports.list(staff, { kind: 'unit_owner', limit: 2 })
    expect(first.items.map((i) => i.id)).toEqual([j3, j2])
    expect(first.next).not.toBeNull()
    const second = await imports.list(staff, {
      kind: 'unit_owner',
      limit: 2,
      after: first.next ?? undefined,
    })
    expect(second.items.map((i) => [i.id, i.status])).toEqual([[j1, 'expired']])
    expect(second.next).toBeNull()
    expect(first.items[0]).toMatchObject({ status: 'validated', counts: { rows: 1, valid: 1 } })
    expect(first.items[0]).not.toHaveProperty('result')
    const expired = await imports.list(staff, { kind: 'unit_owner', limit: 20, status: 'expired' })
    expect(expired.items.map((i) => i.id)).toEqual([j1])
    const validated = await imports.list(staff, {
      kind: 'unit_owner',
      limit: 20,
      status: 'validated',
    })
    expect(validated.items.map((i) => i.id)).toEqual([j3, j2])
  })
})

describe('the jobs of DOC-38 §4', () => {
  test('IM-39 import_expire expires a validated job past expires_at and removes its file; a committed job is left', async () => {
    const t = fresh()
    const staff = h.staff()
    const waiting = await validate(staff, [row(t.unit(1))])
    const done = await validate(staff, [row(t.unit(2))])
    await commit(staff, done.job.id)
    h.clock.advance(24 * 3_600_000 + 1000)
    expect(await h.residency.useCases.expireImports.execute(BUILDING)).toBeGreaterThanOrEqual(1)
    const [expired] =
      await h.admin`SELECT status FROM residency.import_job WHERE id = ${waiting.job.id}`
    expect(expired?.status).toBe('expired')
    expect(h.files.stored.get(waiting.fileId)?.status).toBe('deleted')
    const [kept] = await h.admin`SELECT status FROM residency.import_job WHERE id = ${done.job.id}`
    expect(kept?.status).toBe('committed')
    // Run twice: nothing is left to expire.
    expect(await h.residency.useCases.expireImports.execute(BUILDING)).toBe(0)
  })

  test('import_purge deletes jobs older than 30 days and removes the file a failed job kept', async () => {
    const t = fresh()
    const staff = h.staff()
    const failedFile = h.files.put(staff.staffId, await workbookOf([['Tầng'], [3]]))
    const failed = await h.residency.useCases.validateUnitOwnerImport.execute(staff, {
      fileId: failedFile,
    })
    const young = await validate(staff, [row(t.unit(1))])
    h.clock.advance(31 * 86_400_000)
    const recent = await validate(staff, [row(t.unit(2))])
    expect(await h.residency.useCases.purgeImports.execute(BUILDING)).toBeGreaterThanOrEqual(2)
    const left =
      await h.admin`SELECT id FROM residency.import_job WHERE id IN (${failed.id}, ${young.job.id}, ${recent.job.id})`
    expect(left.map((job) => job.id)).toEqual([recent.job.id])
    expect(h.files.stored.get(failedFile)?.status).toBe('deleted')
    expect(await h.residency.useCases.purgeImports.execute(BUILDING)).toBe(0)
  })
})

describe('NFR-12 the file of 2,000 rows', () => {
  test('IM-30 the preview in under 10 s with 40 errors, each with its unit code; the commit follows', async () => {
    const t = fresh()
    const staff = h.staff()
    const rows = Array.from({ length: 2000 }, (_, i) =>
      row(t.unit(i + 1), owner(`Chủ hộ ${i + 1}`, i % 50 === 0 ? 'bad phone' : t.phone(i + 1))),
    )
    const fileId = await uploadOf(staff, rows)
    const started = performance.now()
    const job = await h.residency.useCases.validateUnitOwnerImport.execute(staff, { fileId })
    const seconds = (performance.now() - started) / 1000
    expect(seconds).toBeLessThan(10)
    expect(job.result.counts).toMatchObject({
      rows: 2000,
      valid: 1960,
      errors: 40,
      ownersToAdd: 1960,
    })
    expect(job.result.issues).toHaveLength(40)
    expect(job.result.issues.every((issue) => issue.unitCode?.startsWith(`T${t.n}-`))).toBe(true)
    const committedAt = performance.now()
    const { committed } = await commit(staff, job.id)
    const commitSeconds = (performance.now() - committedAt) / 1000
    expect(committed).toMatchObject({
      unitsCreated: 1960,
      accountsCreated: 1960,
      ownersAdded: 1960,
    })
    console.info(`IM-30: preview ${seconds.toFixed(2)} s, commit ${commitSeconds.toFixed(2)} s`)
  }, 60_000)
})
