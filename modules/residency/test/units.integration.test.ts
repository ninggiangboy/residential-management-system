import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/** `CreateUnit`, `UpdateUnit` and the unit reads on PostgreSQL 18.6 (DOC-27 §4, §10; RM-35, RM-40, RM-41). */

const LISTED = '018f0000-0000-7000-8000-000000000005' as typeof BUILDING

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

const create = (code: string, extra: object = {}, staff = h.staff()) =>
  h.residency.useCases.createUnit.execute(staff, { code, ...extra })
const update = (
  id: string,
  edit: Parameters<Harness['residency']['useCases']['updateUnit']['execute']>[2]['edit'],
  version: number | undefined,
  staff = h.staff(),
) => h.residency.useCases.updateUnit.execute(staff, id, { edit, version })
const audits = (objectId: string) =>
  h.admin`SELECT action, changes FROM audit.audit_log WHERE object_id = ${objectId} ORDER BY at, id`
const history = async (unitId: string) =>
  h.admin`SELECT kind, actor_kind, details FROM residency.unit_history WHERE unit_id = ${unitId} ORDER BY at, id`

describe('CreateUnit', () => {
  test('stores the code upper-case, trimmed, with the optional fields and an audit row', async () => {
    const unit = await create(' a-1509 ', { floor: 15, bedrooms: 3, areaM2: '82', note: 'corner' })
    expect(unit).toMatchObject({
      code: 'A-1509',
      floor: 15,
      bedrooms: 3,
      areaM2: '82.00',
      occupancy: 'vacant',
      version: 1,
    })
    const [row] = await audits(unit.id)
    expect(row?.action).toBe('residency.unit.create')
    // The free-text note is a deny-listed field: it is recorded masked.
    expect(JSON.stringify(row?.changes)).not.toContain('corner')
    expect(JSON.stringify(row?.changes)).toContain('[masked]')
  })

  test('RM-40 a duplicate code, in another case, is 409 unit_code_in_use; another building may reuse it', async () => {
    await create('B-100')
    expect((await failure(create('b-100'))).code).toBe('unit_code_in_use')
    await create('B-100', {}, h.staff('manager', OTHER_BUILDING))
  })

  test('refuses a code, a floor, a bedroom count and an area outside the rules, and writes nothing', async () => {
    for (const bad of [
      { code: '-A1' },
      { code: 'A 1' },
      { code: '' },
      { code: 'A'.repeat(21) },
      { code: 'C-1', floor: 151 },
      { code: 'C-1', floor: -6 },
      { code: 'C-1', bedrooms: 21 },
      { code: 'C-1', areaM2: '0' },
      { code: 'C-1', areaM2: '2000.01' },
      { code: 'C-1', areaM2: '12.345' },
    ]) {
      const { code, ...rest } = bad
      expect((await failure(create(code, rest))).code).toBe('validation_failed')
    }
    const rows = await h.admin`SELECT 1 FROM residency.unit WHERE code LIKE 'C-1'`
    expect(rows).toHaveLength(0)
  })

  test('a Technician and a Guard are refused', async () => {
    for (const role of ['technician', 'guard'] as const)
      expect((await failure(create('D-1', {}, h.staff(role)))).code).toBe('forbidden')
  })
})

describe('UpdateUnit', () => {
  test('edits fields under If-Match, bumps the version and audits the changed fields', async () => {
    const unit = await create('E-100', { floor: 1 })
    const after = await update(unit.id, { floor: 2, note: 'x', areaM2: '50.5' }, 1)
    expect(after).toMatchObject({ floor: 2, note: 'x', areaM2: '50.50', version: 2 })
    const rows = await audits(unit.id)
    expect(rows.map((row) => row.action)).toEqual([
      'residency.unit.create',
      'residency.unit.update',
    ])
    expect(JSON.stringify(rows[1]?.changes)).toContain('floor')
  })

  test('RM-40 a stale If-Match is 409 version_conflict with the fresh unit; a missing one is 428', async () => {
    const unit = await create('E-101')
    await update(unit.id, { floor: 3 }, 1)
    const stale = await failure(update(unit.id, { floor: 4 }, 1))
    expect(stale.code).toBe('version_conflict')
    expect(JSON.stringify(stale.details)).toContain('"version":2')
    expect((await failure(update(unit.id, { floor: 4 }, undefined))).code).toBe(
      'precondition_required',
    )
  })

  test('an empty edit is 400 min_properties; the same values change nothing and keep the version', async () => {
    const unit = await create('E-102', { floor: 5 })
    expect((await failure(update(unit.id, {}, 1))).code).toBe('validation_failed')
    expect(await update(unit.id, { floor: 5 }, 1)).toMatchObject({ version: 1 })
  })

  test('two edits with one version: one wins, the other is version_conflict', async () => {
    const unit = await create('E-103')
    const results = await Promise.allSettled([
      update(unit.id, { note: 'a' }, 1),
      update(unit.id, { note: 'b' }, 1),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const [loser] = results.filter((r) => r.status === 'rejected')
    expect(((loser as PromiseRejectedResult).reason as DomainError).code).toBe('version_conflict')
  })

  test('renaming to a code another unit has is 409 unit_code_in_use, in any case', async () => {
    await create('E-104')
    const other = await create('E-105')
    expect((await failure(update(other.id, { code: 'e-104' }, 1))).code).toBe('unit_code_in_use')
    expect(await update(other.id, { code: 'e-106' }, 1)).toMatchObject({ code: 'E-106' })
  })

  test('RM-41 history rows only across vacancy: moved_out, moved_in, none between occupied and rented', async () => {
    const unit = await create('F-100', { occupancy: 'occupied' })
    await update(unit.id, { occupancy: 'vacant' }, 1)
    await update(unit.id, { occupancy: 'rented' }, 2)
    await update(unit.id, { occupancy: 'occupied' }, 3)
    expect(await history(unit.id)).toMatchObject([
      { kind: 'moved_out', actor_kind: 'staff', details: { from: 'occupied', to: 'vacant' } },
      { kind: 'moved_in', actor_kind: 'staff', details: { from: 'vacant', to: 'rented' } },
    ])
    const actions = (await audits(unit.id)).map((row) => row.action)
    expect(actions.filter((a) => a === 'residency.unit.update')).toHaveLength(3)
  })

  test("another building's unit is 404", async () => {
    const unit = await create('F-101', {}, h.staff('manager', OTHER_BUILDING))
    expect((await failure(update(unit.id, { floor: 1 }, 1))).code).toBe('not_found')
  })
})

describe('the unit reads', () => {
  test('RM-35 the list is in code order with the owner and the member count; the summary covers the building', async () => {
    const staff = h.staff('admin', LISTED)
    const a = await create('A-20', { occupancy: 'occupied' }, staff)
    await create('A-100', { occupancy: 'rented', bedrooms: 2 }, staff)
    await create('A-3', {}, staff)
    const owner = await h.seedAccount('+84901000001', 'An')
    await h.seedProfile(owner, LISTED, 'Nguyễn Văn An')
    await h.seedMembership({
      accountId: owner,
      memberType: 'owner',
      unit: { id: a.id, buildingId: LISTED },
    })
    await h.seedMembership({ memberType: 'tenant', unit: { id: a.id, buildingId: LISTED } })
    const page = await h.residency.queries.units.list(staff, { limit: 50 })
    expect(page.items.map((item) => item.code)).toEqual(['A-100', 'A-20', 'A-3'])
    expect(page.summary).toEqual({ total: 3, occupied: 1, rented: 1, vacant: 1 })
    expect(page.items[1]).toMatchObject({
      memberCount: 2,
      owner: { accountId: owner, fullName: 'Nguyễn Văn An', phone: '+84901000001' },
    })
    expect(page.items[0]?.owner).toBeNull()
    const filtered = await h.residency.queries.units.list(staff, { limit: 50, bedrooms: 2 })
    expect(filtered.items.map((item) => item.code)).toEqual(['A-100'])
    expect(filtered.summary.total).toBe(3)
  })

  test('the list pages by keyset on (code, id)', async () => {
    const staff = h.staff('manager', '018f0000-0000-7000-8000-000000000003' as typeof BUILDING)
    for (const code of ['K-1', 'K-2', 'K-3']) await create(code, {}, staff)
    const first = await h.residency.queries.units.list(staff, { limit: 2 })
    expect(first.items.map((item) => item.code)).toEqual(['K-1', 'K-2'])
    expect(first.next).not.toBeNull()
    const second = await h.residency.queries.units.list(staff, {
      limit: 2,
      after: first.next ?? undefined,
    })
    expect(second.items.map((item) => item.code)).toEqual(['K-3'])
    expect(second.next).toBeNull()
  })

  test('RM-35 a code search finds the prefix, the exact match first, at most 20, and one character finds nothing', async () => {
    const staff = h.staff('manager', '018f0000-0000-7000-8000-000000000004' as typeof BUILDING)
    for (const code of ['A-15', 'A-150', 'A-1508', 'A-1509', 'A-16', 'A-155'])
      await create(code, {}, staff)
    const found = await h.residency.queries.units.list(staff, { limit: 50, q: 'a-15' })
    expect(found.items.map((item) => item.code)).toEqual([
      'A-15',
      'A-150',
      'A-1508',
      'A-1509',
      'A-155',
    ])
    expect(found.next).toBeNull()
    expect((await h.residency.queries.units.list(staff, { limit: 50, q: 'a' })).items).toEqual([])
  })

  test("the detail lists the owner and the members oldest first; another building's unit is 404", async () => {
    const unit = await create('G-1')
    const ownerId = await h.seedAccount('+84901000002', 'Owner')
    await h.seedProfile(ownerId, BUILDING, 'Chủ Hộ')
    const unitRef = { id: unit.id, buildingId: BUILDING }
    await h.seedMembership({ accountId: ownerId, memberType: 'owner', unit: unitRef })
    const later = await h.seedMembership({
      unit: unitRef,
      createdAt: new Date('2026-10-02T00:00:00Z'),
    })
    const earlier = await h.seedMembership({
      unit: unitRef,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    })
    const detail = await h.residency.queries.units.get(h.staff(), unit.id)
    expect(detail.owner).toMatchObject({ accountId: ownerId, fullName: 'Chủ Hộ' })
    expect(detail.members.map((m) => m.membershipId)).toEqual([earlier.id, later.id])
    expect(detail.debt).toEqual({ openChargeCount: 0, openAmount: 0, oldestDueDate: null })
    expect(
      (await failure(h.residency.queries.units.get(h.staff('manager', OTHER_BUILDING), unit.id)))
        .code,
    ).toBe('not_found')
  })

  test('the history is newest first with the actor shown by name and pages by (at, id)', async () => {
    const unit = await create('G-2', { occupancy: 'occupied' })
    await update(unit.id, { occupancy: 'vacant' }, 1)
    h.clock.advance(1000)
    await update(unit.id, { occupancy: 'rented' }, 2)
    const page = await h.residency.queries.units.history(h.staff(), unit.id, { limit: 1 })
    expect(page.items.map((item) => item.kind)).toEqual(['moved_in'])
    expect(page.next).not.toBeNull()
    const rest = await h.residency.queries.units.history(h.staff(), unit.id, {
      limit: 5,
      after: page.next ?? undefined,
    })
    expect(rest.items.map((item) => item.kind)).toEqual(['moved_out'])
    expect(JSON.stringify(page.items)).not.toContain('+84')
  })
})
