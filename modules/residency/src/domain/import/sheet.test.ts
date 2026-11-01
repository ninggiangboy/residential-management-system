import { describe, expect, test } from 'bun:test'
import { columnOfHeader } from './columns'
import { foldKey } from './folding'
import { readSheet } from './sheet'
import { HEADER_ROW } from './test-fixtures'

describe('header matching of DOC-18 §1.1', () => {
  test.each([
    ['Mã căn hộ', 'macanho'],
    ['MÃ CĂN HỘ', 'macanho'],
    ['ma can ho', 'macanho'],
    ['Unit  Code', 'unitcode'],
    ['unit_code', 'unitcode'],
    ['Diện tích (m²)', 'dientichm2'],
    ['DIEN TICH (M2)', 'dientichm2'],
    ['Area (m²)', 'aream2'],
    ['SĐT chủ hộ', 'sdtchuho'],
    ['CMND/CCCD', 'cmndcccd'],
  ])('%j has the key %j', (header, key) => expect(foldKey(header)).toBe(key))

  test.each([
    ['Mã căn hộ', 'unit_code'],
    ['unit_code', 'unit_code'],
    ['DIEN TICH (M2)', 'area_m2'],
    ['CMND/CCCD', 'owner_id_number'],
    ['Ngày sinh', 'owner_dob'],
    ['Tình trạng', 'occupancy'],
    // DR-315: `Loại căn` and `Type` named the bedroom count before; they name the unit type now (IM-85).
    ['Loại căn hộ', 'unit_type'],
    ['LOẠI CĂN', 'unit_type'],
    ['Type', 'unit_type'],
    ['Unit type', 'unit_type'],
    ['Số phòng ngủ', 'bedrooms'],
    ['PN', 'bedrooms'],
    ['Ghi chú', null],
    ['Status', null],
  ] as const)('%j is %j', (header, column) => expect(columnOfHeader(header)).toBe(column))
})

describe('IM-02 IM-03 IM-04 IM-06 the file layer', () => {
  const rows = [{ row: 2, cells: ['A-1'] }]
  test('IM-02: no unit-code header', () => {
    expect(readSheet({ headers: ['Tầng'], rows })).toMatchObject({
      ok: false,
      code: 'import_no_header',
    })
  })
  test('IM-03: two columns for one', () => {
    expect(readSheet({ headers: ['Mã căn hộ', 'Unit code'], rows })).toMatchObject({
      ok: false,
      code: 'import_duplicate_column',
      params: { column: 'unit_code' },
    })
  })
  test('IM-04: a header and no rows', () => {
    expect(readSheet({ headers: HEADER_ROW, rows: [] })).toMatchObject({
      ok: false,
      code: 'import_empty',
    })
  })
  test('IM-06: an extra column is ignored and named', () => {
    const sheet = readSheet({
      headers: ['Mã căn hộ', 'Ghi chú'],
      rows: [{ row: 2, cells: ['A-1', 'x'] }],
    })
    expect(sheet).toMatchObject({ ok: true, unknownColumns: ['Ghi chú'] })
    if (sheet.ok) expect(sheet.rows[0]?.cells).toEqual({ unit_code: 'A-1' })
  })
})
