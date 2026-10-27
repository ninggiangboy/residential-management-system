import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHarness, type Harness, HEADER, workbookOf } from './support'

/**
 * The counters and the gauge of DOC-27 §15 (DOC-40 §4.3, P1-18): each use case reports what it did, once, after the change is
 * written. The harness records what the module told `MetricsPort`.
 */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

describe('memberships', () => {
  test('a lock by staff and an unlock are counted by change and actor', async () => {
    const membership = await h.seedMembership({ memberType: 'family' })
    const change = (status: 'locked' | 'active') =>
      h.residency.useCases.changeMembership.execute(h.staff(), membership.id, { status })
    await change('locked')
    await change('active')
    expect(h.metrics.count('membership_changes_total', { change: 'locked', actor: 'staff' })).toBe(
      1,
    )
    expect(
      h.metrics.count('membership_changes_total', { change: 'unlocked', actor: 'staff' }),
    ).toBe(1)
  })

  test('a transfer counts itself, the members it removed and the owner it added', async () => {
    const unit = await h.seedUnit()
    await h.seedMembership({ unit, memberType: 'owner' })
    await h.seedMembership({ unit, memberType: 'family' })
    await h.residency.useCases.transferOwnership.execute(h.staff(), unit.id, {
      phone: '0912345678',
      fullName: 'Trần Thị Bình',
      keepMembers: false,
      reason: 'Sold on 2026-10-15; contract 15/2026',
      version: 1,
    })
    expect(h.metrics.count('owner_transfers_total', { keep_members: 'false' })).toBe(1)
    expect(h.metrics.count('membership_changes_total', { change: 'removed', actor: 'staff' })).toBe(
      2,
    )
    expect(h.metrics.count('membership_changes_total', { change: 'added', actor: 'staff' })).toBe(1)
  })

  test('a resident added by staff is `added`', async () => {
    const unit = await h.seedUnit()
    await h.seedMembership({ unit, memberType: 'owner' })
    const before = h.metrics.count('membership_changes_total', { change: 'added', actor: 'staff' })
    await h.residency.useCases.createResident.execute(h.staff(), {
      unitId: unit.id,
      memberType: 'family',
      phone: '0912345601',
      fullName: 'Lê Thị Cẩm',
      canPay: false,
      email: null,
      note: null,
    })
    expect(h.metrics.count('membership_changes_total', { change: 'added', actor: 'staff' })).toBe(
      before + 1,
    )
  })
})

describe('imports', () => {
  test('the validation is timed once, whatever the file says', async () => {
    const staff = h.staff()
    const fileId = await h.files.put(staff.staffId, await workbookOf([HEADER]))
    await h.residency.useCases.validateUnitOwnerImport.execute(staff, { fileId }).catch(() => {})
    const observed = h.metrics.observations('import_validate_duration_seconds')
    expect(observed.length).toBeLessThanOrEqual(1)
    for (const seconds of observed) expect(seconds).toBeLessThan(10)
  })
})

describe('units_without_owner', () => {
  test('counts the units that are lived in and have no owner', async () => {
    const gauge = h.residency.gauges?.find((entry) => entry.name === 'units_without_owner')
    const before = (await gauge?.read())?.[0]?.value ?? -1
    await h.seedUnit() // `occupied` by the harness, with no membership
    const withOwner = await h.seedUnit()
    await h.seedMembership({ unit: withOwner, memberType: 'owner' })
    expect((await gauge?.read())?.[0]?.value).toBe(before + 1)
  })
})
