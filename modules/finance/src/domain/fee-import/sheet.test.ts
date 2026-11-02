import { describe, expect, test } from 'bun:test'
import { feeColumnOfHeader } from './columns'
import { readFeeSheet, type Sheet } from './sheet'

const sheetOf = (
  headers: (string | null)[],
  rows: Sheet['rows'] = [{ row: 2, cells: ['A-1508'] }],
) => ({
  headers,
  rows,
})

describe('the headers of DOC-18 §2.1 (IM-87, IM-88, IM-53)', () => {
  test('IM-87 vi, en and mixed resolve to the canonical columns; the EN item column does not collide; Ghi chú is note', () => {
    expect(
      [
        'Mã căn hộ',
        'Tháng phí',
        'Tên khoản',
        'Tên khoản (EN)',
        'SL',
        'Đơn giá',
        'Thành tiền',
        'Loại',
        'Ghi chú',
      ].map(feeColumnOfHeader),
    ).toEqual([
      'unit_code',
      'fee_month',
      'item_name',
      'item_name_en',
      'quantity',
      'unit_price',
      'amount',
      'kind',
      'note',
    ])
    expect(
      [
        'Unit',
        'Month',
        'Item name',
        'Item name (EN)',
        'Qty',
        'Price',
        'Total',
        'Type',
        'Reason',
      ].map(feeColumnOfHeader),
    ).toEqual([
      'unit_code',
      'fee_month',
      'item_name',
      'item_name_en',
      'quantity',
      'unit_price',
      'amount',
      'kind',
      'note',
    ])
    expect(feeColumnOfHeader('  THÁNG PHÍ ')).toBe('fee_month')
    expect(feeColumnOfHeader('Tầng')).toBeNull()
  })

  test('IM-53 mixed languages read the same; an unknown column is one warning and is ignored', () => {
    const read = readFeeSheet(sheetOf(['Unit code', 'Tháng phí', 'Item', 'Số tiền', 'Tầng']))
    expect(read.ok && read.unknownColumns).toEqual(['Tầng'])
  })

  test('IM-88 the three required columns are named together, DQ-02 is not raised; only the unit code names two', () => {
    expect(readFeeSheet(sheetOf(['Mã căn hộ', 'Thành tiền']))).toEqual({
      ok: false,
      code: 'import_missing_column',
      params: { columns: 'fee_month, item_name' },
    })
    expect(readFeeSheet(sheetOf(['Tháng phí', 'Tên khoản', 'Thành tiền']))).toMatchObject({
      code: 'import_missing_column',
      params: { columns: 'unit_code' },
    })
  })

  test('IM-54 neither price nor amount is import_no_price; a duplicate column and an empty sheet fail too', () => {
    expect(readFeeSheet(sheetOf(['Mã căn hộ', 'Tháng phí', 'Tên khoản', 'SL']))).toMatchObject({
      code: 'import_no_price',
    })
    expect(
      readFeeSheet(sheetOf(['Mã căn hộ', 'Unit', 'Tháng phí', 'Tên khoản', 'Đơn giá'])),
    ).toMatchObject({
      code: 'import_duplicate_column',
      params: { column: 'unit_code' },
    })
    expect(
      readFeeSheet(sheetOf(['Mã căn hộ', 'Tháng phí', 'Tên khoản', 'Đơn giá'], [])),
    ).toMatchObject({
      code: 'import_empty',
    })
  })
})
