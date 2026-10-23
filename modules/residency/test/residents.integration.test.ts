import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import type { BuildingId } from '@rms/shared-types'
import { cccdAad } from '../src/domain/resident-profile'
import { createHarness, type Harness } from './support'

/**
 * The staff add, edit, phone change, list and search of residents on PostgreSQL 18.6 (DOC-27 §5, §8, §11; RM-19, RM-22,
 * RM-29…RM-39). The accounts come from the stand-in of `identity` on the real `identity.resident_account` table.
 */

const PEOPLE = '018f0000-0000-7000-8000-0000000000a1' as BuildingId

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

const staff = () => h.staff('manager', PEOPLE)
const unitIn = (code: string) => h.seedUnit(PEOPLE, code)
const add = (
  unitId: string,
  phone: string,
  extra: Partial<Parameters<Harness['residency']['useCases']['createResident']['execute']>[1]> = {},
) =>
  h.residency.useCases.createResident.execute(staff(), {
    unitId,
    phone,
    fullName: 'Trần Thị Bình',
    memberType: 'tenant',
    canPay: false,
    email: null,
    note: null,
    ...extra,
  })
const actions = async (objectId: string) =>
  (
    await h.admin`SELECT action FROM audit.audit_log WHERE object_id = ${objectId} ORDER BY at, id`
  ).map((row) => row.action)

describe('CreateResident', () => {
  test('RM-22 adds a tenant: account, profile, membership by staff, history row, one added event, no SMS', async () => {
    const unit = await unitIn('R-1')
    const added = await add(unit.id, '0912345678', { email: 'Binh@Example.com', note: 'tenant' })
    expect(added).toMatchObject({ accountCreated: true })
    const [membership] =
      await h.admin`SELECT * FROM residency.membership WHERE id = ${added.membershipId}`
    expect(membership).toMatchObject({
      member_type: 'tenant',
      can_pay: false,
      status: 'active',
      added_by_kind: 'staff',
    })
    const [profile] =
      await h.admin`SELECT * FROM residency.resident_profile WHERE account_id = ${added.accountId}`
    expect(profile).toMatchObject({
      full_name: 'Trần Thị Bình',
      email: 'binh@example.com',
      note: 'tenant',
    })
    const [account] =
      await h.admin`SELECT phone, display_name FROM identity.resident_account WHERE id = ${added.accountId}`
    expect(account).toMatchObject({ phone: '+84912345678', display_name: 'Trần Thị Bình' })
    const history =
      await h.admin`SELECT kind, actor_kind, details FROM residency.unit_history WHERE unit_id = ${unit.id}`
    expect(history).toMatchObject([
      { kind: 'member_added', actor_kind: 'staff', details: { memberType: 'tenant' } },
    ])
    const events = (await h.events('residency.membership_changed.v1')).filter(
      (e) => e.aggregateId === unit.id,
    )
    expect(events.map((e) => (e.payload as { change: string }).change)).toEqual(['added'])
    expect(await actions(added.membershipId)).toEqual(['residency.membership.add'])
    expect(await actions(added.accountId)).toEqual(['residency.profile.update'])
    const sms = await h.admin`SELECT 1 FROM identity.outbox_messages`.catch(() => [])
    expect(sms).toHaveLength(0)
  })

  test('RM-19 the same phone and unit twice is 409 member_exists with the first membership; one account', async () => {
    const unit = await unitIn('R-2')
    const first = await add(unit.id, '0912000002')
    const error = await failure(add(unit.id, '0912000002'))
    expect(error.code).toBe('member_exists')
    expect(JSON.stringify(error.details)).toContain(first.membershipId)
    const accounts =
      await h.admin`SELECT 1 FROM identity.resident_account WHERE phone = '+84912000002'`
    expect(accounts).toHaveLength(1)
  })

  test('an existing account is linked: no second account, the account keeps its name, the profile its first name', async () => {
    const unit = await unitIn('R-3')
    const other = await unitIn('R-4')
    const first = await add(unit.id, '0912000003', { fullName: 'First Name' })
    const second = await add(other.id, '0912000003', { fullName: 'Second Name' })
    expect(second).toMatchObject({ accountId: first.accountId, accountCreated: false })
    const [profile] =
      await h.admin`SELECT full_name FROM residency.resident_profile WHERE account_id = ${first.accountId}`
    expect(profile?.full_name).toBe('First Name')
  })

  test('RM-29 an owner is added only to an ownerless unit, with owner_changed and no membership event', async () => {
    const unit = await unitIn('R-5')
    const owner = await add(unit.id, '0912000005', { memberType: 'owner' })
    const history =
      await h.admin`SELECT kind, details FROM residency.unit_history WHERE unit_id = ${unit.id}`
    expect(history).toMatchObject([
      { kind: 'owner_changed', details: { from: null, to: owner.accountId, source: 'manager' } },
    ])
    const owned = (await h.events('residency.owner_changed.v1')).filter(
      (e) => e.aggregateId === unit.id,
    )
    expect(owned).toHaveLength(1)
    const error = await failure(add(unit.id, '0912000055', { memberType: 'owner' }))
    expect(error.code).toBe('unit_has_owner')
    expect(JSON.stringify(error.details)).toContain(owner.membershipId)
    // The refusal rolled the new account back with everything else.
    expect(
      await h.admin`SELECT 1 FROM identity.resident_account WHERE phone = '+84912000055'`,
    ).toHaveLength(0)
  })

  test('two owners added at once: one wins and the other is unit_has_owner', async () => {
    const unit = await unitIn('R-6')
    const results = await Promise.allSettled([
      add(unit.id, '0912000061', { memberType: 'owner' }),
      add(unit.id, '0912000062', { memberType: 'owner' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const [loser] = results.filter((r) => r.status === 'rejected')
    expect(((loser as PromiseRejectedResult).reason as DomainError).code).toBe('unit_has_owner')
  })

  test('canPay on a family member is 422 can_pay_tenant_only; a tenant keeps it', async () => {
    const unit = await unitIn('R-7')
    const error = await failure(add(unit.id, '0912000007', { memberType: 'family', canPay: true }))
    expect(error.code).toBe('validation_failed')
    expect(JSON.stringify(error.details)).toContain('can_pay_tenant_only')
    const tenant = await add(unit.id, '0912000008', { canPay: true })
    const [row] =
      await h.admin`SELECT can_pay FROM residency.membership WHERE id = ${tenant.membershipId}`
    expect(row?.can_pay).toBe(true)
  })

  test('a number valid nowhere is 400, a name without a letter is 400, an unknown unit is 404', async () => {
    const unit = await unitIn('R-8')
    expect((await failure(add(unit.id, '12345'))).code).toBe('validation_failed')
    expect((await failure(add(unit.id, '0912000009', { fullName: '12' }))).code).toBe(
      'validation_failed',
    )
    expect((await failure(add(crypto.randomUUID(), '0912000009'))).code).toBe('not_found')
    expect(
      await h.admin`SELECT 1 FROM identity.resident_account WHERE phone = '+84912000009'`,
    ).toHaveLength(0)
  })

  test('a unit of another building is 404 and a Guard is refused', async () => {
    const foreign = await h.seedUnit()
    expect((await failure(add(foreign.id, '0912000010'))).code).toBe('not_found')
    const unit = await unitIn('R-9')
    const guard = h.staff('guard', PEOPLE)
    const error = await failure(
      h.residency.useCases.createResident.execute(guard, {
        unitId: unit.id,
        phone: '0912000010',
        fullName: 'Guard Try',
        memberType: 'helper',
        canPay: false,
        email: null,
        note: null,
      }),
    )
    expect(error.code).toBe('forbidden')
  })
})

describe('ChangeLoginPhone', () => {
  test('RM-31 a free number changes the account and audits both numbers masked; memberships stay', async () => {
    const unit = await unitIn('P-1')
    const added = await add(unit.id, '0913000001')
    await h.residency.useCases.changeLoginPhone.execute(staff(), added.accountId, '0987654321')
    const [account] =
      await h.admin`SELECT phone FROM identity.resident_account WHERE id = ${added.accountId}`
    expect(account?.phone).toBe('+84987654321')
    const [audit] = await h.admin`SELECT action, changes FROM audit.audit_log
      WHERE object_id = ${added.accountId} AND action = 'residency.login_phone.change'`
    expect(audit?.changes).toEqual([
      { field: 'phone', before: '+84•••••001', after: '+84•••••321' },
    ])
    const [membership] =
      await h.admin`SELECT credential_version, status FROM residency.membership WHERE id = ${added.membershipId}`
    expect(membership).toMatchObject({ credential_version: 1, status: 'active' })
    const history =
      await h.admin`SELECT 1 FROM residency.unit_history WHERE unit_id = ${unit.id} AND kind <> 'member_added'`
    expect(history).toHaveLength(0)
  })

  test('the same number is a no-op: nothing written, nothing audited', async () => {
    const unit = await unitIn('P-2')
    const added = await add(unit.id, '0913000002')
    const before = h.identity.phoneChanges.length
    await h.residency.useCases.changeLoginPhone.execute(staff(), added.accountId, '+84913000002')
    expect(h.identity.phoneChanges.length).toBe(before)
    expect(await actions(added.accountId)).not.toContain('residency.login_phone.change')
  })

  test('RM-30 a number that has an account is 409 phone_in_use and nothing changes', async () => {
    const a = await add((await unitIn('P-3')).id, '0913000003')
    await add((await unitIn('P-4')).id, '0913000004')
    expect(
      (
        await failure(
          h.residency.useCases.changeLoginPhone.execute(staff(), a.accountId, '0913000004'),
        )
      ).code,
    ).toBe('phone_in_use')
    const [account] =
      await h.admin`SELECT phone FROM identity.resident_account WHERE id = ${a.accountId}`
    expect(account?.phone).toBe('+84913000003')
  })

  test('RM-32 an account with no profile in the building is 404; an invalid number is 400', async () => {
    const stray = await h.seedAccount('+84913000099', 'Stray')
    expect(
      (await failure(h.residency.useCases.changeLoginPhone.execute(staff(), stray, '0913000098')))
        .code,
    ).toBe('not_found')
    const a = await add((await unitIn('P-5')).id, '0913000005')
    expect(
      (await failure(h.residency.useCases.changeLoginPhone.execute(staff(), a.accountId, '123')))
        .code,
    ).toBe('validation_failed')
  })
})

describe('search and lists', () => {
  const SEARCH = '018f0000-0000-7000-8000-0000000000a2' as BuildingId
  const searcher = () => h.staff('manager', SEARCH)
  let unitCode: string

  beforeAll(async () => {
    const unit = await h.seedUnit(SEARCH, 'A-1508')
    unitCode = unit.code
    for (const [phone, name] of [
      ['+84901234567', 'Nguyễn Văn An'],
      ['+84907654321', 'Đặng Văn Hùng'],
      ['+84908111222', 'Lê Thị Mai'],
    ] as const) {
      const id = await h.seedAccount(phone, name)
      await h.seedProfile(id, SEARCH, name)
      await h.seedMembership({ accountId: id, unit, memberType: 'tenant' })
    }
  })

  const names = async (q: string) =>
    (await h.residency.queries.residents.list(searcher(), { q, limit: 50 })).items.map(
      (i) => i.fullName,
    )

  test('RM-33 a name is found without diacritics: "nguyen", "van an", "dang van"', async () => {
    expect(await names('nguyen')).toEqual(['Nguyễn Văn An'])
    expect(await names('van an')).toEqual(['Nguyễn Văn An'])
    expect(await names('dang van')).toEqual(['Đặng Văn Hùng'])
    expect(await names('VĂN')).toEqual(expect.arrayContaining(['Nguyễn Văn An', 'Đặng Văn Hùng']))
  })

  test('RM-34 a phone fragment of 4 digits finds the number; 3 digits search nothing; a unit code finds no resident', async () => {
    expect(await names('4567')).toEqual(['Nguyễn Văn An'])
    expect(await names('0901234567')).toEqual(['Nguyễn Văn An'])
    expect(await names('+84 901 234 567')).toEqual(['Nguyễn Văn An'])
    expect(await names('567')).toEqual([])
    expect(await names('ng')).toEqual([])
    expect(await names(unitCode)).toEqual([])
  })

  test('RM-36 the list shows the full phone, the masked ID number and no date of birth', async () => {
    const [row] = (await h.residency.queries.residents.list(searcher(), { q: 'nguyen', limit: 50 }))
      .items
    expect(row).toMatchObject({
      phone: '+84901234567',
      cccdMasked: null,
      accountStatus: 'active',
      lastAppOpenAt: null,
    })
    expect(row?.memberships).toMatchObject([
      { unitCode: 'A-1508', memberType: 'tenant', status: 'active' },
    ])
    expect(JSON.stringify(row)).not.toContain('dateOfBirth')
  })

  test('the list pages by account id, filters by unit, type and status, and reports the building total', async () => {
    const unit = await h.seedUnit(SEARCH, 'A-1509')
    const id = await h.seedAccount('+84909999999', 'Phạm Văn Cường')
    await h.seedProfile(id, SEARCH, 'Phạm Văn Cường')
    await h.seedMembership({ accountId: id, unit, memberType: 'family', status: 'locked' })
    const all = await h.residency.queries.residents.list(searcher(), { limit: 2 })
    expect(all.items).toHaveLength(2)
    expect(all.next).not.toBeNull()
    expect(all.total).toBe(4)
    const rest = await h.residency.queries.residents.list(searcher(), {
      limit: 2,
      after: all.next ?? undefined,
    })
    expect(rest.items).toHaveLength(2)
    expect(rest.next).toBeNull()
    const byUnit = await h.residency.queries.residents.list(searcher(), {
      limit: 50,
      unitId: unit.id,
    })
    expect(byUnit.items.map((i) => i.fullName)).toEqual(['Phạm Văn Cường'])
    const locked = await h.residency.queries.residents.list(searcher(), {
      limit: 50,
      status: 'locked',
    })
    expect(locked.items.map((i) => i.fullName)).toEqual(['Phạm Văn Cường'])
    const owners = await h.residency.queries.residents.list(searcher(), {
      limit: 50,
      memberType: 'owner',
    })
    expect(owners.items).toEqual([])
  })

  test('neverSignedIn keeps only accounts with no app open; deletion=requested only those in deletion_requested', async () => {
    const opened = await h.seedAccount('+84908888881', 'Opened App')
    await h.admin`UPDATE identity.resident_account SET last_app_open_at = now() WHERE id = ${opened}`
    await h.seedProfile(opened, SEARCH, 'Opened App')
    const asked = await h.seedAccount('+84908888882', 'Asked Deletion')
    await h.admin`UPDATE identity.resident_account SET status = 'deletion_requested', deletion_requested_at = now() WHERE id = ${asked}`
    await h.seedProfile(asked, SEARCH, 'Asked Deletion')
    const never = await h.residency.queries.residents.list(searcher(), {
      limit: 50,
      neverSignedIn: true,
    })
    expect(never.items.map((i) => i.fullName)).not.toContain('Opened App')
    expect(never.items.length).toBeGreaterThan(0)
    const pending = await h.residency.queries.residents.list(searcher(), {
      limit: 50,
      deletion: 'requested',
    })
    expect(pending.items.map((i) => i.fullName)).toEqual(['Asked Deletion'])
    expect(pending.items[0]?.deletion.requestedAt).not.toBeNull()
  })

  test('ResidencyApi.lookup returns units by prefix and residents with the full phone, each kind at most the limit', async () => {
    const found = await h.residency.api.lookup(SEARCH, 'A-15')
    expect(found.units.map((u) => u.code)).toEqual(['A-1508', 'A-1509'])
    const byName = await h.residency.api.lookup(SEARCH, 'nguyen')
    expect(byName.residents).toMatchObject([
      { fullName: 'Nguyễn Văn An', phone: '+84901234567', memberships: [{ unitCode: 'A-1508' }] },
    ])
    expect((await h.residency.api.lookup(SEARCH, 'a-15', { limitPerKind: 1 })).units).toHaveLength(
      1,
    )
    expect((await h.residency.api.lookup(SEARCH, 'a')).units).toEqual([])
  })
})

describe('the resident detail', () => {
  const DETAIL = '018f0000-0000-7000-8000-0000000000a3' as BuildingId
  const detailStaff = () => h.staff('manager', DETAIL)

  test('RM-37 returns the full ID number and birth date after writing one pii.read row', async () => {
    const accountId = await h.seedAccount('+84914000001', 'Ông An')
    await h.seedProfile(accountId, DETAIL, 'Nguyễn Văn An')
    await h.residency.useCases.updateProfile.execute(detailStaff(), accountId, {
      edit: { cccd: '079085012345', dateOfBirth: '1985-04-03', email: 'an@example.com' },
      version: 1,
    })
    const unit = await h.seedUnit(DETAIL, 'D-1')
    await h.seedMembership({ accountId, unit, memberType: 'owner' })
    const detail = await h.residency.queries.residents.get(detailStaff(), accountId)
    expect(detail).toMatchObject({
      accountId,
      phone: '+84914000001',
      accountStatus: 'active',
      profile: {
        cccd: '079085012345',
        dateOfBirth: '1985-04-03',
        email: 'an@example.com',
        version: 2,
      },
      memberships: [{ unitCode: 'D-1', memberType: 'owner' }],
      deletion: { requestedAt: null, approvedAt: null },
    })
    const [row] = await h.admin`SELECT object_type, details, changes FROM audit.audit_log
      WHERE object_id = ${accountId} AND action = 'pii.read'`
    expect(row).toMatchObject({
      object_type: 'resident_profile',
      details: { view: 'detail', fields: ['cccd', 'dateOfBirth'] },
      changes: [],
    })
    expect(JSON.stringify(row)).not.toContain('079085012345')
    // The number is sealed at rest.
    const [stored] =
      await h.admin`SELECT cccd_enc FROM residency.resident_profile WHERE account_id = ${accountId}`
    expect(await h.pii.open(cccdAad(DETAIL, accountId), stored?.cccd_enc)).toBe('079085012345')
  })

  test('RM-37 a failed pii.read insert returns no data', async () => {
    const failing = await createHarness({
      audited: () => async () => {
        throw new Error('audit insert failed')
      },
    })
    try {
      const accountId = await failing.seedAccount('+84914000002', 'X')
      await failing.seedProfile(accountId, DETAIL, 'X')
      await expect(
        failing.residency.queries.residents.get(failing.staff('manager', DETAIL), accountId),
      ).rejects.toThrow('audit insert failed')
    } finally {
      await failing.close()
    }
  })

  test('a person with no profile in the building, and an unknown account, are 404', async () => {
    const stray = await h.seedAccount('+84914000003', 'Stray')
    expect((await failure(h.residency.queries.residents.get(detailStaff(), stray))).code).toBe(
      'not_found',
    )
    expect(
      (await failure(h.residency.queries.residents.get(detailStaff(), crypto.randomUUID()))).code,
    ).toBe('not_found')
  })

  test('a Technician and a Guard cannot list or read', async () => {
    for (const role of ['technician', 'guard'] as const) {
      const denied = h.staff(role, DETAIL)
      expect((await failure(h.residency.queries.residents.list(denied, { limit: 5 }))).code).toBe(
        'forbidden',
      )
      expect(
        (await failure(h.residency.queries.residents.get(denied, crypto.randomUUID()))).code,
      ).toBe('forbidden')
    }
  })
})
