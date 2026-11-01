import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { NotFoundError } from '@core/kernel'
import type { DemoPlan } from '@rms/shared-types'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

/** OTHER_BUILDING plays the demo building here; BUILDING is the real one. */
const DEMO = OTHER_BUILDING
const ADMIN = '018f0d04-0000-7000-8000-000000000001'
const UNIT_1 = '018f0d06-0000-7000-8000-000000000001'
const UNIT_2 = '018f0d06-0000-7000-8000-000000000002'
const UNIT_3 = '018f0d06-0000-7000-8000-000000000003'
const OWNER = '018f0d05-0000-7000-8000-000000000001'
const FAMILY = '018f0d05-0000-7000-8000-000000000002'
const TYPE_APARTMENT = '018f0d08-0000-7000-8000-000000000001'
const TYPE_STUDIO = '018f0d08-0000-7000-8000-000000000002'

const plan: DemoPlan = {
  building: {} as DemoPlan['building'],
  gateway: {} as DemoPlan['gateway'],
  terms: [],
  termsPublisherId: ADMIN,
  unitTypes: [
    {
      id: TYPE_APARTMENT,
      code: 'apartment',
      name: { vi: 'Căn hộ', en: 'Apartment' },
      defaultBedrooms: 2,
      defaultAreaM2: 68,
    },
    {
      id: TYPE_STUDIO,
      code: 'studio',
      name: { vi: 'Studio', en: 'Studio' },
      defaultBedrooms: 0,
      defaultAreaM2: 32,
    },
  ],
  units: [
    {
      id: UNIT_1,
      code: 'A-0101',
      floor: 1,
      unitTypeCode: 'apartment',
      bedrooms: 2,
      areaM2: 60.5,
      occupancy: 'occupied',
    },
    {
      id: UNIT_2,
      code: 'A-0102',
      floor: 1,
      unitTypeCode: 'apartment',
      bedrooms: 1,
      areaM2: 45,
      occupancy: 'rented',
    },
    {
      id: UNIT_3,
      code: 'A-0103',
      floor: 1,
      unitTypeCode: 'studio',
      bedrooms: 0,
      areaM2: 32,
      occupancy: 'vacant',
    },
  ],
  staff: [{ id: ADMIN, email: 'admin@demo.rms.invalid', fullName: 'Quản trị Demo', role: 'admin' }],
  residents: [
    {
      id: OWNER,
      phone: '+12025550101',
      displayName: 'Demo Owner',
      memberships: [
        {
          id: '018f0d07-0000-7000-8000-000000000001',
          unitCode: 'A-0101',
          memberType: 'owner',
          canPay: true,
        },
        {
          id: '018f0d07-0000-7000-8000-000000000002',
          unitCode: 'A-0102',
          memberType: 'owner',
          canPay: true,
        },
      ],
    },
    {
      id: FAMILY,
      phone: '+12025550102',
      displayName: 'Demo Family',
      memberships: [
        {
          id: '018f0d07-0000-7000-8000-000000000003',
          unitCode: 'A-0101',
          memberType: 'family',
          canPay: true,
        },
      ],
    },
  ],
}
const ctx = { today: '2026-10-20' as never, plan, password: 'demo-password-1' }

const count = async (table: string, where = 'true') =>
  Number((await h.admin.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]?.n)

describe('residency in the demo reset (DOC-36 §9.1, §10.2)', () => {
  test('BD-37 resetDemo and seedDemo of a building that is not a demo building refuse and change nothing', async () => {
    const unit = await h.seedUnit(BUILDING)
    for (const buildingId of [BUILDING, crypto.randomUUID()]) {
      await expect(h.residency.demo.resetDemo(buildingId)).rejects.toBeInstanceOf(NotFoundError)
      await expect(h.residency.demo.seedDemo(buildingId, ctx)).rejects.toBeInstanceOf(NotFoundError)
    }
    expect(await count('residency.unit', `id = '${unit.id}'`)).toBe(1)
    expect(await count('residency.unit', `id = '${UNIT_1}'`)).toBe(0)
  })

  test('the seed creates the units, the profiles and the memberships of the plan, added by the demo Admin', async () => {
    h.demoBuildings.add(DEMO)
    expect(await h.residency.demo.seedDemo(DEMO, ctx)).toEqual({
      'residency.unit_type': 2,
      'residency.unit': 3,
      'residency.resident_profile': 2,
      'residency.membership': 3,
    })
    // BD-49: each unit holds the type its code names, the types seeded first.
    const typed =
      await h.admin`SELECT u.code, t.code AS type FROM residency.unit u JOIN residency.unit_type t ON t.id = u.unit_type_id WHERE u.building_id = ${DEMO} ORDER BY u.code`
    expect(typed.map((row) => [row.code, row.type])).toEqual([
      ['A-0101', 'apartment'],
      ['A-0102', 'apartment'],
      ['A-0103', 'studio'],
    ])
    const units =
      await h.admin`SELECT code, occupancy, floor, bedrooms, area_m2 FROM residency.unit WHERE building_id = ${DEMO} ORDER BY code`
    expect(units.map((unit) => [unit.code, unit.occupancy, Number(unit.area_m2)])).toEqual([
      ['A-0101', 'occupied', 60.5],
      ['A-0102', 'rented', 45],
      ['A-0103', 'vacant', 32],
    ])
    const members =
      await h.admin`SELECT member_type, status, added_by_kind, added_by FROM residency.membership WHERE building_id = ${DEMO} ORDER BY id`
    expect(
      members.map((member) => [
        member.member_type,
        member.status,
        member.added_by_kind,
        member.added_by,
      ]),
    ).toEqual([
      ['owner', 'active', 'staff', ADMIN],
      ['owner', 'active', 'staff', ADMIN],
      ['family', 'active', 'staff', ADMIN],
    ])
    expect(
      await count(
        'residency.resident_profile',
        `building_id = '${DEMO}' AND full_name = 'Demo Owner'`,
      ),
    ).toBe(1)
  })

  test('the owner is found through the module, so a demo resident sees the unit at sign-in', async () => {
    const active = await h.residency.api.listActiveMemberships(OWNER)
    expect(active.map((membership) => membership.unitCode).sort()).toEqual(['A-0101', 'A-0102'])
  })

  test('BD-38 a reset deletes the demo building’s rows only, and the seed comes back with the same ids', async () => {
    const real = await h.seedUnit(BUILDING)
    await h.admin`INSERT INTO residency.unit_history (id, building_id, unit_id, kind, actor_kind) VALUES (${crypto.randomUUID()}, ${DEMO}, ${UNIT_1}, 'moved_in', 'system')`
    const deleted = await h.residency.demo.resetDemo(DEMO)
    expect(deleted).toEqual({
      'residency.unit_history': 1,
      'residency.membership': 3,
      'residency.resident_profile': 2,
      'residency.import_job': 0,
      'residency.unit': 3,
      'residency.unit_type': 2,
    })
    expect(await count('residency.unit', `building_id = '${DEMO}'`)).toBe(0)
    expect(await count('residency.unit', `id = '${real.id}'`)).toBe(1)

    await h.residency.demo.seedDemo(DEMO, ctx)
    expect(await count('residency.unit', `id IN ('${UNIT_1}', '${UNIT_2}', '${UNIT_3}')`)).toBe(3)
    // BD-50: the same two type ids come back, and a second reset deletes the units before the types it holds.
    expect(
      await count('residency.unit_type', `id IN ('${TYPE_APARTMENT}', '${TYPE_STUDIO}')`),
    ).toBe(2)
    await h.residency.demo.resetDemo(DEMO)
    await h.residency.demo.seedDemo(DEMO, ctx)
    expect(await count('residency.unit_type', `building_id = '${DEMO}'`)).toBe(2)
    expect(await count('residency.membership', `id = '018f0d07-0000-7000-8000-000000000003'`)).toBe(
      1,
    )
  })

  test('a plan whose membership names a unit it does not have fails and leaves nothing half-seeded', async () => {
    await h.residency.demo.resetDemo(DEMO)
    const broken: DemoPlan = {
      ...plan,
      residents: [
        {
          ...plan.residents[0]!,
          memberships: [
            { id: crypto.randomUUID(), unitCode: 'A-9999', memberType: 'owner', canPay: true },
          ],
        },
      ],
    }
    await expect(
      h.database.run(async () => {
        await h.residency.demo.seedDemo(DEMO, { ...ctx, plan: broken })
      }),
    ).rejects.toThrow('A-9999')
    await h.residency.demo.seedDemo(DEMO, ctx)
  })
})
