import { describe, expect, test } from 'bun:test'
import { UnitType, type UnitTypeRecord, unitTypeCodeOf } from './unit-type'

const now = new Date('2026-11-01T03:00:00.000Z')

const stored: UnitTypeRecord = {
  id: 't1',
  buildingId: 'b1',
  code: 'studio',
  name: { vi: 'Studio', en: 'Studio' },
  defaultBedrooms: 0,
  defaultAreaM2: '32.00',
  status: 'active',
  archivedAt: null,
  version: 1,
}

/** The rules of DOC-27 §4.3 as the aggregate states them. */
describe('unitTypeCodeOf', () => {
  test.each(['studio', 'penthouse', 'a1', 'shop_house'])('accepts %p', (code) => {
    expect(unitTypeCodeOf(code)).toBe(code)
  })

  test.each(['', 'a', 'Studio', '1studio', 'has space', 'x'.repeat(31), 'căn'])(
    'refuses %p',
    (bad) => {
      expect(() => unitTypeCodeOf(bad)).toThrow()
    },
  )
})

describe('UnitType.create', () => {
  test('normalises the names and the area, and keeps the defaults', () => {
    expect(
      UnitType.create('id', {
        code: 'duplex',
        name: { vi: '  Duplex   hai tầng ', en: ' ' },
        defaultBedrooms: 3,
        defaultAreaM2: '120',
      }),
    ).toEqual({
      id: 'id',
      code: 'duplex',
      name: { vi: 'Duplex hai tầng', en: null },
      defaultBedrooms: 3,
      defaultAreaM2: '120.00',
    })
  })

  test('a type may have no default', () => {
    const created = UnitType.create('id', { code: 'shophouse', name: { vi: 'Shophouse' } })
    expect(created.defaultBedrooms).toBeNull()
    expect(created.defaultAreaM2).toBeNull()
  })

  test.each([
    { name: { vi: ' ' } },
    { name: { vi: 'x'.repeat(61) } },
    { name: { vi: 'ok', en: 'x'.repeat(61) } },
    { name: { vi: 'ok' }, defaultBedrooms: 21 },
    { name: { vi: 'ok' }, defaultBedrooms: -1 },
    { name: { vi: 'ok' }, defaultAreaM2: '0' },
    { name: { vi: 'ok' }, defaultAreaM2: '2000.01' },
    { name: { vi: 'ok' }, defaultAreaM2: '1.234' },
  ])('refuses %p', (bad) => {
    expect(() => UnitType.create('id', { code: 'ok_code', ...bad })).toThrow()
  })
})

describe('UnitType.edit', () => {
  test('changes only what differs and moves the version by one', () => {
    const change = new UnitType(stored).edit(
      { name: { vi: 'Studio', en: null }, defaultAreaM2: '35', defaultBedrooms: 0 },
      now,
    )
    expect(change?.transition).toEqual({
      id: 't1',
      expect: { version: 1 },
      set: { name: { vi: 'Studio', en: null }, defaultAreaM2: '35.00', version: 2 },
    })
    expect(change?.fields.map((f) => f.field)).toEqual(['name', 'defaultAreaM2'])
  })

  test('nothing different is no change', () => {
    expect(new UnitType(stored).edit({ defaultBedrooms: 0, status: 'active' }, now)).toBeNull()
  })

  test('null clears a default', () => {
    const change = new UnitType(stored).edit({ defaultBedrooms: null, defaultAreaM2: null }, now)
    expect(change?.transition.set).toEqual({
      defaultBedrooms: null,
      defaultAreaM2: null,
      version: 2,
    })
  })

  test('an archive sets archivedAt and a restore clears it in the same statement', () => {
    const archived = new UnitType(stored).edit({ status: 'archived' }, now)
    expect(archived?.transition.set).toEqual({ status: 'archived', archivedAt: now, version: 2 })
    const restored = new UnitType({ ...stored, status: 'archived', archivedAt: now }).edit(
      { status: 'active' },
      now,
    )
    expect(restored?.transition.set).toEqual({ status: 'active', archivedAt: null, version: 2 })
  })

  test('the defaults a new unit takes', () => {
    expect(new UnitType(stored).defaults).toEqual({ bedrooms: 0, areaM2: '32.00' })
  })
})
