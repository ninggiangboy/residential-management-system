import { describe, expect, test } from 'bun:test'
import {
  blankLine,
  bodyOfLines,
  issuesOf,
  type LineDraft,
  lineAmountOf,
  parseQuantityMilli,
  parseWholeMoney,
} from './line-model'

const fee = (patch: Partial<LineDraft>): LineDraft => ({ ...blankLine(), nameVi: 'Phí', ...patch })

describe('the line editor model (DOC-66 W-Fee-Batch, DOC-21 §3.2)', () => {
  test('a quantity takes a comma or a dot and at most three decimals (DQ-69)', () => {
    expect(parseQuantityMilli('12,345')).toBe(12_345n)
    expect(parseQuantityMilli('1.5')).toBe(1_500n)
    expect(parseQuantityMilli('7')).toBe(7_000n)
    expect(parseQuantityMilli('1.2345')).toBeNull()
    expect(parseQuantityMilli('-1')).toBeNull()
    expect(parseQuantityMilli('abc')).toBeNull()
  })

  test('a price is a whole non-negative number of dong (DQ-70)', () => {
    expect(parseWholeMoney('15000')).toBe(15_000)
    expect(parseWholeMoney('150.5')).toBeNull()
    expect(parseWholeMoney('-5')).toBeNull()
  })

  test('the amount of a fee line is rounded half up, an adjustment keeps its sign (DR-11, DQ-71)', () => {
    expect(lineAmountOf(fee({ quantity: '12,345', unitPrice: '15000' }))).toBe(185_175)
    expect(lineAmountOf(fee({ quantity: '0.001', unitPrice: '1500' }))).toBe(2)
    expect(lineAmountOf(fee({ quantity: '', unitPrice: '1000' }))).toBeNull()
    expect(lineAmountOf(fee({ kind: 'adjustment', amount: '-35175' }))).toBe(-35_175)
  })

  test('the body sends the typed amount too, so the API can catch a mismatch', () => {
    const [body] = bodyOfLines([fee({ nameEn: ' Fee ', quantity: '2', unitPrice: '1000' })])
    expect(body).toMatchObject({
      kind: 'fee',
      itemName: { vi: 'Phí', en: 'Fee' },
      quantity: '2',
      unitPrice: 1000,
      amount: 2000,
      note: null,
    })
  })

  test('the per-field issues of a validation_failed answer are keyed by line and field', () => {
    const issues = issuesOf([
      { path: 'lines[1].itemName.vi', code: 'item_name_required' },
      { path: 'lines[0].unitPrice', code: 'unit_price_not_whole' },
      { path: 'other', code: 'ignored' },
    ])
    expect(issues.get('1.nameVi')).toBe('item_name_required')
    expect(issues.get('0.unitPrice')).toBe('unit_price_not_whole')
    expect(issues.size).toBe(2)
  })
})
