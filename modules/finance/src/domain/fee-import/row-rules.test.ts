import { describe, expect, test } from 'bun:test'
import { type LocalDate, money } from '@rms/shared-types'
import { type ParsedFeeRow, parseFeeMonth, parseFeeRow } from './row-rules'
import type { Cell } from './sheet'

const OCTOBER = '2026-10-01' as LocalDate

const row = (cells: Partial<Record<string, Cell>>): ParsedFeeRow =>
  parseFeeRow(
    {
      row: 7,
      cells: { unit_code: 'A-1508', fee_month: '10/2026', item_name: 'Phí quản lý', ...cells },
    },
    OCTOBER,
  )

const codes = (parsed: ParsedFeeRow) =>
  parsed.issues.map((issue) => `${issue.column}:${issue.code}`)

describe('DQ-65 the fee month (IM-89)', () => {
  test.each([
    ['10/2026', '2026-10-01'],
    ['1/2026', '2026-01-01'],
    ['2026-10', '2026-10-01'],
    [new Date(Date.UTC(2026, 9, 1)), '2026-10-01'],
    [46296, '2026-10-01'],
    ['13/2026', null],
    ['10/26', null],
    ['Oct 2026', null],
    ['', null],
    [null, null],
  ] as const)('%p → %p', (cell, expected) => {
    expect(parseFeeMonth(cell as Cell)).toBe(expected as LocalDate | null)
  })

  test('IM-61 11/2026 in a batch of 10/2026 is fee_month_mismatch with both months; blank is fee_month_invalid', () => {
    const mismatch = row({ fee_month: '11/2026', amount: 1 })
    expect(mismatch.issues).toEqual([
      {
        row: 7,
        unitCode: 'A-1508',
        column: 'fee_month',
        severity: 'error',
        code: 'fee_month_mismatch',
        params: { expected: '10/2026', got: '11/2026' },
      },
    ])
    expect(codes(row({ fee_month: null, amount: 1 }))).toEqual(['fee_month:fee_month_invalid'])
  })
})

describe('the row rules DQ-64, DQ-67…DQ-74 on a row of the file', () => {
  test('DQ-64 a unit code of 21 characters or with a space is unit_code_invalid; a lower-case code keeps its key', () => {
    expect(codes(row({ unit_code: 'A 1508', amount: 1 }))).toEqual(['unit_code:unit_code_invalid'])
    expect(codes(row({ unit_code: 'A'.repeat(21), amount: 1 }))).toEqual([
      'unit_code:unit_code_invalid',
    ])
    expect(codes(row({ unit_code: null, amount: 1 }))).toEqual(['unit_code:unit_code_invalid'])
    const lower = row({ unit_code: ' a-1508 ', amount: 1 })
    expect([lower.unitCode, lower.codeKey, lower.issues]).toEqual(['a-1508', 'a-1508', []])
  })

  test('IM-55 number cells: 12.345 × 15,000 with 185,000 is amount_mismatch; with 185,175 the line is set', () => {
    const wrong = row({ quantity: 12.345, unit_price: 15_000, amount: 185_000 })
    expect(wrong.issues[0]).toMatchObject({
      column: 'amount',
      code: 'amount_mismatch',
      params: { expected: 185_175, got: 185_000 },
    })
    expect(wrong.line).toBeNull()
    const right = row({ quantity: '12,345', unit_price: 15_000, amount: 185_175 })
    expect(right.line?.amount).toBe(money(185_175))
  })

  test('IM-56 a comma is the decimal mark; four decimals and a negative are quantity_invalid', () => {
    expect(row({ quantity: '12,345', unit_price: 1_000 }).line?.quantityMilli).toBe(12_345n)
    expect(codes(row({ quantity: '12.3456', unit_price: 1_000 }))).toEqual([
      'quantity:quantity_invalid',
    ])
    expect(codes(row({ quantity: -1, unit_price: 1_000 }))).toEqual(['quantity:quantity_invalid'])
  })

  test('IM-57, IM-58 fee row amounts and adjustments; kinds compare by key', () => {
    expect(codes(row({ amount: 0 }))).toEqual(['amount:amount_invalid'])
    expect(codes(row({ amount: -5 }))).toEqual(['amount:amount_invalid'])
    expect(codes(row({ kind: 'Điều chỉnh', amount: -200_000, note: 'Giảm trừ' }))).toEqual([])
    expect(codes(row({ kind: 'adjustment', amount: 0, note: 'x' }))).toEqual([
      'amount:amount_invalid',
    ])
    expect(codes(row({ kind: 'ĐIỀU CHỈNH', amount: -1 }))).toEqual([
      'note:adjustment_note_required',
    ])
    expect(codes(row({ kind: 'PHÍ', amount: 1 }))).toEqual([])
    expect(codes(row({ kind: 'refund', amount: 1 }))).toEqual(['kind:kind_invalid'])
  })

  test('DQ-71 the amount_invalid text gets the kind and the cap', () => {
    expect(row({ kind: 'adjustment', amount: 0, note: 'x' }).issues[0]?.params).toEqual({
      kind: 'adjustment',
      max: 99_999_999_999,
    })
  })

  test('IM-91 the cap: 10 × 9,999,999,999 is accepted, 100 × it and a fee of 100,000,000,000 are amount_invalid', () => {
    expect(row({ quantity: 10, unit_price: 9_999_999_999 }).line?.amount).toBe(
      money(99_999_999_990),
    )
    expect(codes(row({ quantity: 100, unit_price: 9_999_999_999 }))).toEqual([
      'amount:amount_invalid',
    ])
    expect(codes(row({ amount: 100_000_000_000 }))).toEqual(['amount:amount_invalid'])
  })

  test('DQ-67 an item name is collapsed, a control character refused; DQ-74 a long note; every issue of the row is listed', () => {
    expect(row({ item_name: '  Phí   quản\nlý ', amount: 1 }).line?.itemName).toEqual({
      vi: 'Phí quản lý',
    })
    expect(codes(row({ item_name: 'Phí\u0007', amount: 1 }))).toEqual([
      'item_name:item_name_invalid',
    ])
    expect(
      codes(
        row({ unit_code: 'A 1', fee_month: 'x', item_name: '', amount: 1, note: 'n'.repeat(501) }),
      ),
    ).toEqual([
      'unit_code:unit_code_invalid',
      'fee_month:fee_month_invalid',
      'item_name:item_name_invalid',
      'note:note_too_long',
    ])
  })
})
