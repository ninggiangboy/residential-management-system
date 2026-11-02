import { describe, expect, test } from 'bun:test'
import type { LocalDate } from '@rms/shared-types'
import { checkFeeSet, type KnownUnit, planFeeImport, sameFeeCounts } from './plan'
import { parseFeeRow } from './row-rules'
import type { Cell } from './sheet'

const OCTOBER = '2026-10-01' as LocalDate

type Cells = Partial<Record<string, Cell>>
const rows = (...cells: Cells[]) =>
  cells.map((row, index) =>
    parseFeeRow({ row: index + 2, cells: { fee_month: '10/2026', ...row } }, OCTOBER),
  )

const fee = (unit: string, item: string, amount: number): Cells => ({
  unit_code: unit,
  item_name: item,
  amount,
})

const units = (...known: [string, boolean][]): Map<string, KnownUnit> =>
  new Map(
    known.map(([code, hasActiveOwner]) => [
      code.toLowerCase(),
      { unitId: `id-${code}`, code, hasActiveOwner },
    ]),
  )

function plan(parsed: ReturnType<typeof rows>, known: Map<string, KnownUnit>) {
  const set = checkFeeSet(parsed)
  return planFeeImport({
    rowCount: parsed.length,
    survivors: set.survivors,
    earlierIssues: [...parsed.flatMap((row) => row.issues), ...set.issues],
    units: known,
  })
}

describe('the set layer (DQ-75, DQ-76)', () => {
  test('IM-60 the same unit and item in another case is charge_item_duplicate on the second row; the first stands', () => {
    const set = checkFeeSet(rows(fee('A-1510', 'Phí quản lý', 1), fee('a-1510', 'PHÍ  QUẢN LÝ', 2)))
    expect(set.survivors.map((row) => row.row)).toEqual([2])
    expect(set.issues).toEqual([
      {
        row: 3,
        unitCode: 'a-1510',
        column: 'item_name',
        severity: 'error',
        code: 'charge_item_duplicate',
        params: { item: 'PHÍ QUẢN LÝ', firstRow: 2 },
      },
    ])
  })

  test('IM-59 a unit whose lines sum to −5,000 gets charge_total_zero on every row', () => {
    const set = checkFeeSet(
      rows(fee('A-1', 'Phí', 1_000), {
        unit_code: 'A-1',
        item_name: 'Giảm',
        kind: 'adjustment',
        amount: -6_000,
        note: 'x',
      }),
    )
    expect(set.survivors).toEqual([])
    expect(set.issues.map((issue) => [issue.row, issue.column, issue.code, issue.params])).toEqual([
      [2, 'amount', 'charge_total_zero', { code: 'A-1', total: -5_000 }],
      [3, 'amount', 'charge_total_zero', { code: 'A-1', total: -5_000 }],
    ])
  })

  test('IM-92 a valid row and a wrong one: the valid one stands; a fee and an equal adjustment total 0 and both go', () => {
    const result = plan(
      rows(
        fee('B-1', 'Phí', 500_000),
        { unit_code: 'B-1', item_name: 'Nước', quantity: '1.0001', unit_price: 1 },
        fee('B-2', 'Phí', 1_000_000),
        { unit_code: 'B-2', item_name: 'Trừ', kind: 'adjustment', amount: -1_000_000, note: 'x' },
      ),
      units(['B-1', true], ['B-2', true]),
    )
    expect(
      result.charges.map((charge) => [charge.unitCode, Number(charge.amount), charge.lines.length]),
    ).toEqual([['B-1', 500_000, 1]])
    expect(result.preview.issues.map((issue) => [issue.row, issue.code])).toEqual([
      [3, 'quantity_invalid'],
      [4, 'charge_total_zero'],
      [5, 'charge_total_zero'],
    ])
  })
})

describe('the db layer and the preview (DQ-77, DQ-78, DOC-21 §4.4)', () => {
  test('IM-62, IM-63 unknown unit, no owner, a vacant unit with an owner, a lower-case code that stores the unit code', () => {
    const result = plan(
      rows(
        fee('A-9999', 'Phí', 1),
        fee('A-2', 'Phí', 1),
        fee('A-3', 'Phí', 1),
        fee('a-1508', 'Phí', 2_488_000),
      ),
      units(['A-2', false], ['A-3', true], ['A-1508', true]),
    )
    expect(
      result.preview.issues.map((issue) => [issue.row, issue.column, issue.code, issue.params]),
    ).toEqual([
      [2, 'unit_code', 'unit_not_found', { code: 'A-9999' }],
      [3, 'unit_code', 'unit_without_owner', { code: 'A-2' }],
    ])
    expect(result.charges.map((charge) => charge.unitCode)).toEqual(['A-3', 'A-1508'])
    expect(result.preview.validRows[1]).toEqual({
      row: 5,
      unitCode: 'A-1508',
      itemName: 'Phí',
      kind: 'fee',
      quantity: '1',
      unitPrice: 2_488_000,
      amount: 2_488_000,
    })
  })

  test('the A-1508 fixture: three lines in file order make one charge of 2,638,000; counts are complete', () => {
    const result = plan(
      rows(
        { unit_code: 'A-1508', item_name: 'Phí quản lý', quantity: 1, unit_price: 2_488_000 },
        {
          unit_code: 'A-1508',
          item_name: 'Nước',
          item_name_en: 'Water',
          quantity: '12.345',
          unit_price: 15_000,
        },
        {
          unit_code: 'A-1508',
          item_name: 'Điều chỉnh',
          kind: 'adjustment',
          amount: -35_175,
          note: 'Trừ phí nước tính thừa tháng 9',
        },
      ),
      units(['A-1508', true]),
    )
    expect(result.charges).toHaveLength(1)
    expect(result.charges[0]?.lines.map((line) => Number(line.amount))).toEqual([
      2_488_000, 185_175, -35_175,
    ])
    expect(result.preview.counts).toEqual({
      rows: 3,
      valid: 3,
      errors: 0,
      warnings: 0,
      charges: 1,
      lines: 3,
      totalAmount: 2_638_000,
    })
    expect(result.preview.validRows[1]).toMatchObject({ itemNameEn: 'Water', quantity: '12.345' })
  })

  test('IM-75 600 errors: 500 listed, errors first, truncated, counts.errors = 600; IM-74 50 valid rows listed', () => {
    const cells = [
      ...Array.from({ length: 600 }, (_, i) => fee(`E-${i}`, 'Phí', 0)),
      ...Array.from({ length: 60 }, (_, i) => fee(`V-${i}`, 'Phí', 1)),
    ]
    const known = units(
      ...Array.from({ length: 60 }, (_, i): [string, boolean] => [`V-${i}`, true]),
    )
    const result = plan(rows(...cells), known)
    expect(result.preview.issues).toHaveLength(500)
    expect(result.preview.issuesTruncated).toBe(true)
    expect(result.preview.counts.errors).toBe(600)
    expect(result.preview.validRows).toHaveLength(50)
    expect(result.preview.counts.valid).toBe(60)
  })

  test('DQ-50 sameFeeCounts compares every count', () => {
    const counts = {
      rows: 1,
      valid: 1,
      errors: 0,
      warnings: 0,
      charges: 1,
      lines: 1,
      totalAmount: 5,
    }
    expect(sameFeeCounts(counts, { ...counts })).toBe(true)
    expect(sameFeeCounts(counts, { ...counts, totalAmount: 6 })).toBe(false)
  })
})
