import { describe, expect, test } from 'bun:test'
import { LibphonenumberPhoneParser } from '../../infrastructure/phone/libphonenumber-phone-parser'
import { parseRow } from './row-rules'
import type { Cell } from './sheet'

/** IM-07…IM-17 and IM-40: the results of DOC-18 §1.3, row by row. The building's today is 2026-10-19 as in the document. */
const context = { today: '2026-10-19', phones: new LibphonenumberPhoneParser() }
const row = (cells: Record<string, Cell>) => parseRow({ row: 2, cells }, context)
const codes = (cells: Record<string, Cell>) => row(cells).issues.map((issue) => issue.code)

describe('IM-07 DQ-10 unit code', () => {
  test.each([
    ['A-1508', 'A-1508'],
    [' a-1508 ', 'A-1508'],
    ['B2.05', 'B2.05'],
  ])('%j is %j', (input, expected) => {
    expect(row({ unit_code: input }).unitCode).toBe(expected)
  })
  test.each(['A 1508', ' ', '-A1', 'A'.repeat(21)])('%j is unit_code_invalid', (input) => {
    expect(codes({ unit_code: input })).toContain('unit_code_invalid')
  })
})

describe('IM-08 DQ-11 DQ-12 floor and bedrooms', () => {
  test.each([
    ['15', 15, 15],
    ['-2', -2, null],
    ['0', 0, 0],
    ['151', null, null],
    ['21', 21, null],
    ['3.5', null, null],
    ['abc', null, null],
  ])('%j → floor %j, bedrooms %j', (input, floor, bedrooms) => {
    const floorRow = row({ unit_code: 'A1', floor: input })
    const bedroomRow = row({ unit_code: 'A1', bedrooms: input })
    expect(floorRow.floor).toBe(floor)
    expect(floorRow.issues.map((i) => i.code)).toEqual(floor === null ? ['floor_invalid'] : [])
    expect(bedroomRow.bedrooms).toBe(bedrooms)
    expect(bedroomRow.issues.map((i) => i.code)).toEqual(
      bedrooms === null ? ['bedrooms_invalid'] : [],
    )
  })
})

describe('IM-09 DQ-13 area', () => {
  test.each([
    ['72.5', '72.50'],
    ['72,5', '72.50'],
    [72.5, '72.50'],
    ['2000', '2000.00'],
  ])('%j is %j', (input, expected) => {
    expect(row({ unit_code: 'A1', area_m2: input }).areaM2).toBe(expected)
  })
  test.each(['2000.01', '72.555', '0', 'abc', '1,000.5'])('%j is area_invalid', (input) => {
    expect(codes({ unit_code: 'A1', area_m2: input })).toEqual(['area_invalid'])
  })
})

describe('IM-10 DQ-14 occupancy', () => {
  test.each([
    ['occupied', 'occupied'],
    ['Đang ở', 'occupied'],
    ['CHO THUÊ', 'rented'],
    ['trống', 'vacant'],
    ['Bỏ trống', 'vacant'],
  ] as const)('%j is %j', (input, expected) => {
    expect(row({ unit_code: 'A1', occupancy: input }).occupancy).toBe(expected)
  })
  test.each(['empty', 'ở'])('%j is occupancy_invalid', (input) => {
    expect(codes({ unit_code: 'A1', occupancy: input })).toEqual(['occupancy_invalid'])
  })
  test('a blank cell is null, which keeps the stored value (IM-40)', () => {
    const blank = row({ unit_code: 'A1', floor: ' ', bedrooms: null, area_m2: null, occupancy: '' })
    expect(blank).toMatchObject({ floor: null, bedrooms: null, areaM2: null, occupancy: null })
    expect(blank.issues).toEqual([])
  })
})

describe('IM-11 DQ-15 DQ-16 the owner cells go together', () => {
  test('only an email: name and phone are required', () => {
    expect(codes({ unit_code: 'A1', owner_email: 'an@example.com' })).toEqual([
      'owner_name_required',
      'owner_phone_required',
    ])
  })
  test('no owner cell: the row changes the unit only', () => {
    expect(row({ unit_code: 'A1', floor: '3' }).owner).toBeNull()
  })
})

describe('IM-12 DQ-17 owner name', () => {
  const name = (input: string) =>
    row({ unit_code: 'A1', owner_name: input, owner_phone: '0901234567' })
  test('collapsed', () => {
    expect(name('  Nguyễn   Văn An ').owner?.name).toBe('Nguyễn Văn An')
  })
  test.each(['A', '12345', 'Trần Thị B\u0007', 'x'.repeat(101)])(
    '%j is owner_name_invalid',
    (input) => {
      expect(name(input).issues.map((i) => i.code)).toEqual(['owner_name_invalid'])
    },
  )
})

describe('IM-13 DQ-18 DQ-19 phone', () => {
  const phone = (input: Cell) =>
    row({ unit_code: 'A1', owner_name: 'Nguyễn Văn An', owner_phone: input })
  test.each([
    ['0901234567', '+84901234567'],
    ['+84 901 234 567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['(090) 123-4567', '+84901234567'],
    [901234567, '+84901234567'],
    ['+65 9123 4567', '+6591234567'],
  ])('%j is %j', (input, expected) => {
    const parsed = phone(input)
    expect(parsed.owner?.phone).toBe(expected)
    expect(parsed.issues).toEqual([])
  })
  test('a landline is accepted with a warning', () => {
    const parsed = phone('02838251234')
    expect(parsed.owner?.phone).toBe('+842838251234')
    expect(parsed.issues.map((i) => [i.code, i.severity])).toEqual([
      ['phone_not_mobile', 'warning'],
    ])
  })
  test.each(['0123456789', '0901 234 56', 'abc'])('%j is phone_invalid', (input) => {
    expect(phone(input).issues.map((i) => i.code)).toEqual(['phone_invalid'])
  })
})

describe('IM-15 DQ-20 email', () => {
  const email = (input: string) =>
    row({ unit_code: 'A1', owner_name: 'An Nguyen', owner_phone: '0901234567', owner_email: input })
  test('lower-cased', () => {
    expect(email('An.Nguyen@Example.COM').owner?.email).toBe('an.nguyen@example.com')
  })
  test.each(['an@', 'an nguyen@x.vn'])('%j is email_invalid', (input) => {
    expect(email(input).issues.map((i) => i.code)).toEqual(['email_invalid'])
  })
})

describe('IM-16 DQ-21 DQ-22 ID number', () => {
  const id = (input: Cell) =>
    row({
      unit_code: 'A1',
      owner_name: 'An Nguyen',
      owner_phone: '0901234567',
      owner_id_number: input,
    })
  test.each([
    ['079085012345', '079085012345'],
    ['079 085 012 345', '079085012345'],
    ['012345678', '012345678'],
  ])('text %j is %j with no warning', (input, expected) => {
    const parsed = id(input)
    expect(parsed.owner?.idNumber).toBe(expected)
    expect(parsed.issues).toEqual([])
  })
  test.each([
    [79085012345, '079085012345'],
    [1234567890, '001234567890'],
  ])('number %j is padded to %j with a warning', (input, expected) => {
    const parsed = id(input)
    expect(parsed.owner?.idNumber).toBe(expected)
    expect(parsed.issues.map((i) => [i.code, i.severity])).toEqual([
      ['id_number_padded', 'warning'],
    ])
  })
  test.each(['12345', 'AB1234567', 'B1234567'])('%j is id_number_invalid', (input) => {
    expect(id(input).issues.map((i) => i.code)).toEqual(['id_number_invalid'])
  })
})

describe('IM-17 DQ-23 date of birth, the same for text, a Date and a serial', () => {
  const dob = (input: Cell) =>
    row({ unit_code: 'A1', owner_name: 'An Nguyen', owner_phone: '0901234567', owner_dob: input })
  test.each(['03/04/1985', '3/4/1985', '1985-04-03', new Date(Date.UTC(1985, 3, 3)), 31140])(
    '%j is 1985-04-03',
    (input) => {
      expect(dob(input).owner?.dateOfBirth).toBe('1985-04-03')
    },
  )
  test.each(['31/02/1990', '04/03/2030', '01/01/1899', '1985/04/03', 31140.5, 0, 99999])(
    '%j is dob_invalid',
    (input) => {
      expect(dob(input).issues.map((i) => i.code)).toEqual(['dob_invalid'])
    },
  )
})
