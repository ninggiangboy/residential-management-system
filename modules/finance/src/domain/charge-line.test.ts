import { describe, expect, test } from 'bun:test'
import { money } from '@rms/shared-types'
import {
  chargeTotal,
  checkChargeLine,
  halfUpAmount,
  parseQuantityMilli,
  quantityText,
} from './charge-line'

const fee = (
  quantity: string | number | null,
  unitPrice: string | number | null,
  amount: string | number | null = null,
) => checkChargeLine({ itemName: 'Phí quản lý', quantity, unitPrice, amount })

const code = (result: ReturnType<typeof checkChargeLine>) =>
  result.ok ? 'ok' : result.issues.map((i) => i.code).join(',')

describe('the half-up table of DOC-21 §4.2 (DR-11, IM-55)', () => {
  test.each([
    ['1', 2_488_000, null, 'ok', 2_488_000],
    ['12.345', 15_000, 185_000, 'amount_mismatch', null],
    ['12.345', 15_000, 185_175, 'ok', 185_175],
    ['0.001', 500, 0, 'amount_invalid', null],
    ['0.001', 500, 1, 'ok', 1],
    ['0.001', 499, null, 'amount_invalid', null],
    ['3.333', 1_000, null, 'ok', 3_333],
    ['2.5', 1, null, 'ok', 3],
    ['1', 0, null, 'amount_invalid', null],
  ] as const)('%s × %d, amount %p → %s', (quantity, unitPrice, amount, expected, total) => {
    const result = fee(quantity, unitPrice, amount)
    expect(code(result)).toBe(expected)
    if (result.ok) expect(result.line.amount).toBe(money(total ?? 0))
  })

  test('the formula holds integer thousandths: (12345 × 15000 + 500) / 1000', () => {
    expect(halfUpAmount(12_345n, money(15_000))).toBe(money(185_175))
  })
})

describe('quantity (DQ-69, IM-56)', () => {
  test('a comma is the decimal mark too; four decimals and a negative are refused', () => {
    expect(parseQuantityMilli('12,345')).toBe(12_345n)
    expect(parseQuantityMilli('12.3456')).toBeNull()
    expect(parseQuantityMilli('-1')).toBeNull()
    expect(parseQuantityMilli('999999999.999')).toBe(999_999_999_999n)
    expect(parseQuantityMilli('1000000000')).toBeNull()
    expect(code(fee('12.3456', 1_000))).toBe('quantity_invalid')
  })

  test('a blank quantity is 1', () => {
    const result = fee(null, 350_000)
    expect(result.ok && result.line.quantityMilli).toBe(1000n)
    expect(quantityText(12_345n)).toBe('12.345')
    expect(quantityText(1000n)).toBe('1.000')
  })
})

describe('amounts and kinds (DQ-70…DQ-74, IM-57, IM-58)', () => {
  test('a fee row of 0 or below is refused; only the amount means quantity 1 and that unit price', () => {
    expect(code(fee(null, null, 0))).toBe('amount_invalid')
    expect(code(fee(null, null, -5))).toBe('amount_invalid')
    const only = fee(null, null, 500_000)
    expect(only.ok && [only.line.quantityMilli, only.line.unitPrice, only.line.amount]).toEqual([
      1000n,
      money(500_000),
      money(500_000),
    ])
  })

  test('an adjustment needs a note and a non-zero amount; quantity 1, unit price 0', () => {
    const base = { itemName: 'Điều chỉnh', kind: 'adjustment' }
    expect(code(checkChargeLine({ ...base, amount: -200_000 }))).toBe('adjustment_note_required')
    expect(code(checkChargeLine({ ...base, amount: 0, note: 'Giảm trừ' }))).toBe('amount_invalid')
    const ok = checkChargeLine({
      ...base,
      amount: '-35175',
      note: 'Trừ phí nước tính thừa tháng 9',
    })
    expect(ok.ok && [ok.line.amount, ok.line.quantityMilli, ok.line.unitPrice]).toEqual([
      money(-35_175),
      1000n,
      money(0),
    ])
    expect(code(checkChargeLine({ ...base, kind: 'điều chỉnh', amount: -1, note: 'x' }))).toBe('ok')
  })

  test('kind, item name, note and price limits name their column', () => {
    expect(code(checkChargeLine({ itemName: 'x', kind: 'refund', amount: 1 }))).toBe('kind_invalid')
    expect(code(checkChargeLine({ itemName: '  ', amount: 1 }))).toBe('item_name_invalid')
    expect(code(checkChargeLine({ itemName: 'x'.repeat(121), amount: 1 }))).toBe(
      'item_name_invalid',
    )
    expect(code(checkChargeLine({ itemName: 'x', amount: 1, note: 'n'.repeat(501) }))).toBe(
      'note_too_long',
    )
    expect(code(fee('1', '1.5'))).toBe('unit_price_invalid')
    expect(code(fee('1', 10_000_000_000))).toBe('unit_price_invalid')
    expect(code(fee(null, null, 100_000_000_000))).toBe('amount_invalid')
    const issue = checkChargeLine({ itemName: 'x', kind: 'refund', amount: 1 })
    expect(!issue.ok && issue.issues[0]?.column).toBe('kind')
  })
})

describe('the charge total (DQ-76)', () => {
  test('A-1508: 2,488,000 + 185,175 − 35,175 = 2,638,000', () => {
    expect(
      chargeTotal([
        { amount: money(2_488_000) },
        { amount: money(185_175) },
        { amount: money(-35_175) },
      ]),
    ).toBe(money(2_638_000))
  })
})
