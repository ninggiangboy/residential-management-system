import { describe, expect, test } from 'bun:test'
import { parseTermsMarkdown } from '@rms/shared-types'
import { buildDemoPlan, DEMO_BUILDING_ID } from './plan'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/

describe('the demo plan (DOC-36 §9.1)', () => {
  const plan = buildDemoPlan()

  test('is the same every time: a link to a demo row survives a reset', () => {
    expect(buildDemoPlan()).toEqual(plan)
  })

  test('240 units A-0101…A-1516: 200 occupied, 25 rented, 15 vacant', () => {
    expect(plan.units).toHaveLength(240)
    expect(plan.units[0]?.code).toBe('A-0101')
    expect(plan.units.at(-1)?.code).toBe('A-1516')
    const count = (occupancy: string) =>
      plan.units.filter((unit) => unit.occupancy === occupancy).length
    expect([count('occupied'), count('rented'), count('vacant')]).toEqual([200, 25, 15])
    expect(new Set(plan.units.map((unit) => unit.code)).size).toBe(240)
  })

  test('BD-49: five unit types and each of the 240 units has one, by the layout of DOC-36 §9', () => {
    expect(plan.unitTypes.map((type) => type.code)).toEqual([
      'apartment',
      'studio',
      'duplex',
      'penthouse',
      'shophouse',
    ])
    const codes = new Set(plan.unitTypes.map((type) => type.code))
    const by = (code: string) => plan.units.filter((unit) => unit.unitTypeCode === code)
    for (const unit of plan.units) expect(codes.has(unit.unitTypeCode)).toBe(true)
    expect(plan.unitTypes.map((type) => by(type.code).length)).toEqual([192, 24, 12, 4, 8])
    // A type other than the apartment gives its defaults to its units; a shophouse has no bedroom default.
    for (const type of plan.unitTypes.filter((candidate) => candidate.code !== 'apartment'))
      for (const unit of by(type.code)) {
        expect(unit.bedrooms).toBe(type.defaultBedrooms)
        expect(unit.areaM2).toBe(type.defaultAreaM2 as number)
      }
    expect(by('studio')[0]).toMatchObject({ bedrooms: 0, areaM2: 32 })
    // The store-review owner's unit A-0101 is a shophouse; the demo household A-1508 an apartment.
    expect(plan.units.find((unit) => unit.code === 'A-0101')?.unitTypeCode).toBe('shophouse')
    expect(plan.units.find((unit) => unit.code === 'A-1508')?.unitTypeCode).toBe('apartment')
  })

  test('every id is a UUIDv7-shaped constant and none repeats', () => {
    const ids = [
      plan.building.id,
      plan.gateway.id,
      ...plan.terms.map((terms) => terms.id),
      ...plan.unitTypes.map((type) => type.id),
      ...plan.units.map((unit) => unit.id),
      ...plan.staff.map((person) => person.id),
      ...plan.residents.flatMap((resident) => [
        resident.id,
        ...resident.memberships.map((member) => member.id),
      ]),
    ]
    for (const id of ids) expect(id).toMatch(UUID)
    expect(new Set(ids).size).toBe(ids.length)
    expect(plan.building.id).toBe(DEMO_BUILDING_ID)
  })

  test('four staff, one of each role, on addresses that nothing can deliver to', () => {
    expect(plan.staff.map((person) => person.role)).toEqual([
      'admin',
      'manager',
      'technician',
      'guard',
    ])
    for (const person of plan.staff) expect(person.email).toBe(`${person.role}@demo.rms.invalid`)
    expect(plan.termsPublisherId).toBe(String(plan.staff[0]?.id))
  })

  test('eight residents on the fictional numbers +12025550101…0108', () => {
    expect(plan.residents.map((resident) => resident.phone)).toEqual(
      Array.from({ length: 8 }, (_, at) => `+1202555010${at + 1}`),
    )
  })

  test('the memberships name units of the plan and each unit has at most one owner', () => {
    const codes = new Set(plan.units.map((unit) => unit.code))
    const owners = new Map<string, number>()
    for (const resident of plan.residents)
      for (const member of resident.memberships) {
        expect(codes.has(member.unitCode)).toBe(true)
        if (member.memberType === 'owner')
          owners.set(member.unitCode, (owners.get(member.unitCode) ?? 0) + 1)
      }
    expect([...owners.values()].every((n) => n === 1)).toBe(true)
    // The household of the demo has the four member types; the helper cannot pay.
    const a1508 = plan.residents.flatMap((resident) =>
      resident.memberships.filter((member) => member.unitCode === 'A-1508'),
    )
    expect(a1508.map((member) => member.memberType)).toEqual([
      'owner',
      'family',
      'tenant',
      'helper',
    ])
    expect(a1508.find((member) => member.memberType === 'helper')?.canPay).toBe(false)
  })

  test('the gateway is the fake driver and the terms are in the subset of DOC-35 §9.1', () => {
    expect(plan.gateway.driver).toBe('fake')
    for (const terms of plan.terms)
      expect(Array.isArray(parseTermsMarkdown(terms.text.vi))).toBe(true)
  })
})
