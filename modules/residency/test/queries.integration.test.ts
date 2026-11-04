import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/** The reads of `ResidencyApi` on PostgreSQL 18.6 (DOC-27 §2.1, DOC-09 §7.2). */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const api = () => h.residency.api

describe('getMembership', () => {
  test('a locked row is returned so the guard can refuse it; a removed one and a stranger are not', async () => {
    const active = await h.seedMembership({ memberType: 'family', canPay: false })
    const locked = await h.seedMembership({ status: 'locked' })
    const removed = await h.seedMembership({ status: 'removed' })
    const found = await api().getMembership(active.accountId, active.unit.id)
    expect(found).toMatchObject({
      membershipId: active.id,
      buildingId: BUILDING,
      unitId: active.unit.id,
      memberType: 'family',
      canPay: false,
      status: 'active',
    })
    expect(found?.startedAt).toBe(h.clock.now().toISOString())
    expect((await api().getMembership(locked.accountId, locked.unit.id))?.status).toBe('locked')
    expect(await api().getMembership(removed.accountId, removed.unit.id)).toBeNull()
    expect(await api().getMembership(crypto.randomUUID(), active.unit.id)).toBeNull()
    expect(await api().getMembership(active.accountId, crypto.randomUUID())).toBeNull()
  })

  test('RM-51 the lookup is one index scan on membership_one_per_account_unit', async () => {
    const { accountId, unit } = await h.seedMembership()
    const plan = await h.admin.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      return tx`EXPLAIN SELECT id FROM residency.membership WHERE account_id = ${accountId} AND unit_id = ${unit.id} AND status <> 'removed'`
    })
    expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(
      'membership_one_per_account_unit',
    )
  })
})

describe('listActiveMemberships', () => {
  test('RM-49 an account with one active and one locked membership gets one row, with the unit code, ordered by code', async () => {
    const accountId = crypto.randomUUID()
    const b = await h.seedUnit(BUILDING, 'B-200')
    const a = await h.seedUnit(BUILDING, 'A-100')
    const c = await h.seedUnit(BUILDING, 'C-300')
    await h.seedMembership({ accountId, unit: b, memberType: 'owner' })
    await h.seedMembership({ accountId, unit: a, memberType: 'tenant', canPay: true })
    await h.seedMembership({ accountId, unit: c, status: 'locked' })
    const rows = await api().listActiveMemberships(accountId)
    expect(rows.map((row) => row.unitCode)).toEqual(['A-100', 'B-200'])
    expect(rows[0]).toMatchObject({
      unitId: a.id,
      buildingId: BUILDING,
      memberType: 'tenant',
      canPay: true,
    })
    expect(await api().listActiveMemberships(crypto.randomUUID())).toEqual([])
  })

  test('activeUnitIds and ownedUnitIds', async () => {
    const accountId = crypto.randomUUID()
    const owned = await h.seedMembership({ accountId, memberType: 'owner' })
    const lockedOwner = await h.seedMembership({ accountId, memberType: 'owner', status: 'locked' })
    const family = await h.seedMembership({ accountId, memberType: 'family' })
    await h.seedMembership({ accountId, status: 'removed' })
    expect((await api().activeUnitIds(accountId)).sort()).toEqual(
      [owned.unit.id, family.unit.id].sort(),
    )
    // A locked owner is still the owner: only a transfer ends it (DOC-35 §10.1).
    expect((await api().ownedUnitIds(accountId)).sort()).toEqual(
      [owned.unit.id, lockedOwner.unit.id].sort(),
    )
  })
})

describe('buildingIdsOfAccounts', () => {
  test('RM-50 the buildings of the non-removed memberships; an account with none is absent', async () => {
    const demo = crypto.randomUUID()
    const nobody = crypto.randomUUID()
    const gone = crypto.randomUUID()
    await h.seedMembership({ accountId: demo, unit: await h.seedUnit(BUILDING) })
    await h.seedMembership({ accountId: demo, unit: await h.seedUnit(BUILDING) })
    await h.seedMembership({
      accountId: demo,
      unit: await h.seedUnit(OTHER_BUILDING),
      status: 'locked',
    })
    await h.seedMembership({ accountId: gone, status: 'removed' })
    const rows = await api().buildingIdsOfAccounts([demo, nobody, gone])
    expect(rows.map((row) => `${row.accountId}:${row.buildingId}`).sort()).toEqual(
      [`${demo}:${BUILDING}`, `${demo}:${OTHER_BUILDING}`].sort(),
    )
    expect(await api().buildingIdsOfAccounts([])).toEqual([])
  })
})

describe('recipients, scan and units', () => {
  test('listRecipients follows the policy table: a tenant receives for `pay` only with can_pay; paged by membership id', async () => {
    const unit = await h.seedUnit()
    const owner = await h.seedMembership({ unit, memberType: 'owner' })
    const family = await h.seedMembership({ unit, memberType: 'family' })
    const payer = await h.seedMembership({ unit, memberType: 'tenant', canPay: true })
    await h.seedMembership({ unit, memberType: 'tenant', canPay: false })
    await h.seedMembership({ unit, memberType: 'helper' })
    await h.seedMembership({ unit, memberType: 'family', status: 'locked' })
    const pay = await api().listRecipients(unit.id, 'pay')
    expect(pay.items.map((row) => row.membershipId).sort()).toEqual(
      [owner.id, family.id, payer.id].sort(),
    )
    expect(pay.next).toBeNull()
    expect((await api().listRecipients(unit.id, 'view_fees')).items).toHaveLength(4)
    expect((await api().listRecipients(unit.id, 'broadcast_notices')).items).toHaveLength(5)
    expect(
      (await api().listRecipients(unit.id, 'manage_members')).items.map((row) => row.membershipId),
    ).toEqual([owner.id])
    const first = await api().listRecipients(unit.id, 'view_fees', { limit: 3 })
    expect(first.items).toHaveLength(3)
    expect(first.next).not.toBeNull()
    const second = await api().listRecipients(unit.id, 'view_fees', {
      limit: 3,
      after: first.next as string,
    })
    expect(second.items).toHaveLength(1)
    expect(second.next).toBeNull()
  })

  test('listNoticeRecipients gives each account once however many units, in account order, in pages', async () => {
    const building = '018f0000-0000-7000-8000-0000000000aa' as typeof BUILDING
    const unitA = await h.seedUnit(building)
    const unitB = await h.seedUnit(building)
    const accounts = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort()
    for (const accountId of accounts) await h.seedMembership({ accountId, unit: unitA })
    await h.seedMembership({ accountId: accounts[0] as string, unit: unitB })
    await h.seedMembership({ unit: unitB, status: 'locked' })
    const first = await api().listNoticeRecipients(building, null, 2)
    expect(first.items.map((row) => row.accountId)).toEqual(accounts.slice(0, 2))
    const second = await api().listNoticeRecipients(building, first.next, 2)
    expect(second.items.map((row) => row.accountId)).toEqual(accounts.slice(2))
    expect(second.next).toBeNull()
  })

  test('getMembershipForScan returns the row whatever its status, with credentialVersion', async () => {
    const removed = await h.seedMembership({ status: 'removed', credentialVersion: 4 })
    expect(await api().getMembershipForScan(removed.id)).toMatchObject({
      membershipId: removed.id,
      status: 'removed',
      credentialVersion: 4,
    })
    expect(await api().getMembershipForScan(crypto.randomUUID())).toBeNull()
  })

  test('getUnits answers code, floor and occupancy', async () => {
    const unit = await h.seedUnit(BUILDING, 'Z-901')
    expect(await api().getUnits([unit.id, crypto.randomUUID()])).toEqual([
      { unitId: unit.id, code: 'Z-901', floor: expect.any(Number), occupancy: 'occupied' },
    ])
    expect(await api().getUnits([])).toEqual([])
  })

  test('findUnitsByCodes (DR-265): lower-case match, the stored code, one row per code, an owner that is not removed', async () => {
    const owned = await h.seedUnit(BUILDING, 'Q-1508')
    await h.seedMembership({ unit: owned, memberType: 'owner' })
    const lockedOwner = await h.seedUnit(BUILDING, 'Q-1509')
    await h.seedMembership({ unit: lockedOwner, memberType: 'owner', status: 'locked' })
    const tenantOnly = await h.seedUnit(BUILDING, 'Q-1510')
    await h.seedMembership({ unit: tenantOnly, memberType: 'tenant' })
    await h.seedMembership({ unit: tenantOnly, memberType: 'owner', status: 'removed' })
    const elsewhere = await h.seedUnit(OTHER_BUILDING, 'Q-1511')
    await h.seedMembership({ unit: elsewhere, memberType: 'owner' })
    const found = await api().findUnitsByCodes(BUILDING, [
      'q-1508',
      'Q-1508',
      ' Q-1509 ',
      'q-1510',
      'q-1511',
      'q-9999',
    ])
    expect(found.sort((a, b) => a.code.localeCompare(b.code))).toEqual([
      { unitId: owned.id, code: 'Q-1508', occupancy: 'occupied', hasActiveOwner: true },
      { unitId: lockedOwner.id, code: 'Q-1509', occupancy: 'occupied', hasActiveOwner: true },
      { unitId: tenantOnly.id, code: 'Q-1510', occupancy: 'occupied', hasActiveOwner: false },
    ])
    expect(await api().findUnitsByCodes(BUILDING, [])).toEqual([])
    await expect(
      api().findUnitsByCodes(
        BUILDING,
        Array.from({ length: 5001 }, (_, i) => `x-${i}`),
      ),
    ).rejects.toThrow('at most 5,000')
  })
})

describe('unitOwnerNames', () => {
  test('DR-292, DOC-34 §6.1: the active owner full name of a unit of the building', async () => {
    const unit = await h.seedUnit(BUILDING, 'OW-1')
    const owner = await h.seedMembership({ unit, memberType: 'owner' })
    await h.seedProfile(owner.accountId, BUILDING, 'Trần Minh Anh')
    expect(await api().unitOwnerNames(BUILDING, [unit.id])).toEqual([
      { unitId: unit.id, ownerName: 'Trần Minh Anh' },
    ])
    expect(await api().unitOwnerNames(BUILDING, [])).toEqual([])
  })

  test('a unit with no active owner, or only an ended one, answers null', async () => {
    const vacant = await h.seedUnit(BUILDING, 'OW-2')
    await h.seedMembership({ unit: vacant, memberType: 'tenant' })
    const ended = await h.seedUnit(BUILDING, 'OW-3')
    const former = await h.seedMembership({ unit: ended, memberType: 'owner', status: 'removed' })
    await h.seedProfile(former.accountId, BUILDING, 'Former Owner')
    expect(await api().unitOwnerNames(BUILDING, [vacant.id, ended.id])).toEqual([
      { unitId: vacant.id, ownerName: null },
      { unitId: ended.id, ownerName: null },
    ])
  })

  test('a unit of another building never leaks its owner: the name is null', async () => {
    const foreign = await h.seedUnit(OTHER_BUILDING, 'OW-4')
    const owner = await h.seedMembership({ unit: foreign, memberType: 'owner' })
    await h.seedProfile(owner.accountId, OTHER_BUILDING, 'Other Owner')
    expect(await api().unitOwnerNames(BUILDING, [foreign.id])).toEqual([
      { unitId: foreign.id, ownerName: null },
    ])
  })

  test('one row per requested unit, in the input order, a duplicate once, a missing id null', async () => {
    const a = await h.seedUnit(BUILDING, 'OW-5')
    const ownerA = await h.seedMembership({ unit: a, memberType: 'owner' })
    await h.seedProfile(ownerA.accountId, BUILDING, 'Owner A')
    const b = await h.seedUnit(BUILDING, 'OW-6')
    const missing = crypto.randomUUID()
    expect(await api().unitOwnerNames(BUILDING, [b.id, a.id, b.id, missing])).toEqual([
      { unitId: b.id, ownerName: null },
      { unitId: a.id, ownerName: 'Owner A' },
      { unitId: missing, ownerName: null },
    ])
  })

  test('more than 500 ids is refused', async () => {
    await expect(
      api().unitOwnerNames(
        BUILDING,
        Array.from({ length: 501 }, () => crypto.randomUUID()),
      ),
    ).rejects.toThrow('at most 500')
  })
})
