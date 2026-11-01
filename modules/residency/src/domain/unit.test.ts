import { describe, expect, test } from 'bun:test'
import { Unit, type UnitRecord, unitCodeOf } from './unit'

const stored: UnitRecord = {
  id: 'u1',
  buildingId: 'b1',
  code: 'A-1508',
  floor: 15,
  bedrooms: 2,
  areaM2: '68.50',
  occupancy: 'occupied',
  note: null,
  unitTypeId: null,
  unitType: null,
  version: 3,
}

/** The rules of DOC-27 §4.1 as the aggregate states them. */
describe('unitCodeOf', () => {
  test('trims and stores upper-case', () => {
    expect(unitCodeOf(' a-1509 ')).toBe('A-1509')
    expect(unitCodeOf('b/2.c_d'.replace('_', '-'))).toBe('B/2.C-D')
  })

  test.each(['', ' ', '-A', 'A 1', 'A'.repeat(21), 'Ă-1'])('refuses %p', (bad) => {
    expect(() => unitCodeOf(bad)).toThrow()
  })
})

describe('Unit.create', () => {
  test('defaults occupancy to vacant and writes the area with two decimals', () => {
    expect(Unit.create('id', { code: 'c-1', areaM2: '82' })).toEqual({
      id: 'id',
      code: 'C-1',
      floor: null,
      bedrooms: null,
      areaM2: '82.00',
      unitTypeId: null,
      occupancy: 'vacant',
      note: null,
    })
  })

  test('keeps the type it is given', () => {
    expect(Unit.create('id', { code: 'c-1', unitTypeId: 't1' }).unitTypeId).toBe('t1')
  })
})

describe('Unit.edit', () => {
  test('changes only what differs, expects the version it read and moves it by one', () => {
    const change = new Unit(stored).edit({ floor: 15, note: 'x', occupancy: 'rented' })
    expect(change?.transition).toEqual({
      id: 'u1',
      expect: { version: 3 },
      set: { note: 'x', occupancy: 'rented', version: 4 },
    })
    expect(change?.fields.map((f) => f.field)).toEqual(['occupancy', 'note'])
    expect(change?.vacancy).toBeNull()
  })

  test('nothing to change is null', () => {
    expect(new Unit(stored).edit({ floor: 15, areaM2: '68.5' })).toBeNull()
  })

  test('crossing vacancy names the history row, between occupied and rented none', () => {
    expect(new Unit(stored).edit({ occupancy: 'vacant' })?.vacancy).toBe('moved_out')
    expect(
      new Unit({ ...stored, occupancy: 'vacant' }).edit({ occupancy: 'rented' })?.vacancy,
    ).toBe('moved_in')
    expect(new Unit(stored).edit({ occupancy: 'rented' })?.vacancy).toBeNull()
  })

  test('null clears floor, bedrooms, area and note', () => {
    const change = new Unit(stored).edit({ floor: null, bedrooms: null, areaM2: null })
    expect(change?.transition.set).toMatchObject({ floor: null, bedrooms: null, areaM2: null })
  })

  test('refuses values outside the ranges', () => {
    expect(() => new Unit(stored).edit({ floor: 151 })).toThrow()
    expect(() => new Unit(stored).edit({ bedrooms: -1 })).toThrow()
    expect(() => new Unit(stored).edit({ areaM2: '2001' })).toThrow()
    expect(() => new Unit(stored).edit({ note: 'x'.repeat(501) })).toThrow()
  })
})

describe('Unit.bump', () => {
  test('moves nothing but the version, from the one the caller saw', () => {
    expect(Unit.bump('u1', 3)).toEqual({ id: 'u1', expect: { version: 3 }, set: { version: 4 } })
  })
})

describe('Unit.edit of the type (DR-315)', () => {
  test('changes the type and nothing else: no default is applied', () => {
    const change = new Unit(stored).edit({ unitTypeId: 't1' })
    expect(change?.transition.set).toEqual({ unitTypeId: 't1', version: 4 })
    expect(change?.fields).toEqual([{ field: 'unitTypeId', before: null, after: 't1' }])
  })

  test('null clears the type, and the same type is no change', () => {
    const typed = { ...stored, unitTypeId: 't1' }
    expect(new Unit(typed).edit({ unitTypeId: 't1' })).toBeNull()
    expect(new Unit(typed).edit({ unitTypeId: null })?.transition.set).toEqual({
      unitTypeId: null,
      version: 4,
    })
  })
})
