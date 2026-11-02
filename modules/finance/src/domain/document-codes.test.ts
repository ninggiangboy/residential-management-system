import { describe, expect, test } from 'bun:test'
import { buildingToday, localDate } from '@rms/shared-types'
import {
  batchCode,
  dayPeriod,
  InvalidDocumentCodeError,
  intentCode,
  MAX_ORDER_CODE,
  monthPeriod,
  orderCodeFromContent,
  receiptNumber,
  transferContent,
} from './document-codes'

describe('the receipt, batch and intent codes (DOC-14 §10)', () => {
  test('receiptNumber is BL-YYMM-NNNN with a minimum width of 4', () => {
    expect(receiptNumber('2610', 1)).toBe('BL-2610-0001')
    expect(receiptNumber('2610', 42)).toBe('BL-2610-0042')
    expect(receiptNumber('2610', 10000)).toBe('BL-2610-10000')
  })

  test('batchCode is PH-YYMM-NN with a minimum width of 2', () => {
    expect(batchCode('2610', 7)).toBe('PH-2610-07')
    expect(batchCode('2610', 100)).toBe('PH-2610-100')
  })

  test('intentCode is TT-YYMMDD-NNNN with a minimum width of 4', () => {
    expect(intentCode('261031', 1)).toBe('TT-261031-0001')
    expect(intentCode('261031', 12345)).toBe('TT-261031-12345')
  })

  test('a period that is not YYMM or YYMMDD, or a count below 1, is refused', () => {
    for (const bad of ['', '26', '26100', '2610-', 'abcdef', '2610333'])
      expect(() => receiptNumber(bad, 1)).toThrow(InvalidDocumentCodeError)
    for (const bad of [0, -1, 1.5, Number.NaN])
      expect(() => batchCode('2610', bad)).toThrow(InvalidDocumentCodeError)
  })
})

describe('the month and day periods in building time (DOC-14 §10, DR-09)', () => {
  test('monthPeriod and dayPeriod read a LocalDate', () => {
    expect(monthPeriod(localDate('2026-10-31'))).toBe('2610')
    expect(dayPeriod(localDate('2026-10-31'))).toBe('261031')
    expect(monthPeriod(localDate('2027-01-05'))).toBe('2701')
    expect(dayPeriod(localDate('2027-01-05'))).toBe('270105')
  })

  test('the month rolls over at midnight in Asia/Ho_Chi_Minh, not at UTC midnight', () => {
    const zone = 'Asia/Ho_Chi_Minh'
    const before = buildingToday(new Date('2026-10-31T16:59:00Z'), zone)
    const after = buildingToday(new Date('2026-10-31T17:01:00Z'), zone)
    expect([monthPeriod(before), dayPeriod(before)]).toEqual(['2610', '261031'])
    expect([monthPeriod(after), dayPeriod(after)]).toEqual(['2611', '261101'])
  })
})

describe('the TT transfer content of an order code (DOC-15 §4, DR-27)', () => {
  test('every row of the DOC-15 §4 table encodes to and from its code', () => {
    const rows: ReadonlyArray<readonly [bigint, string]> = [
      [1_000_000n, 'TTYGJ0'],
      [2_610_153n, 'TT2FMZ9'],
      [MAX_ORDER_CODE, 'TTZZZZZZZ'],
    ]
    for (const [code, content] of rows) {
      expect(transferContent(code)).toBe(content)
      expect(transferContent(Number(code))).toBe(content)
      expect(orderCodeFromContent(content)).toBe(code)
    }
  })

  test('34,359,738,368 is refused: the ceiling keeps the content at 9 characters', () => {
    expect(() => transferContent(34_359_738_368n)).toThrow(InvalidDocumentCodeError)
    expect(() => transferContent(999_999n)).toThrow(InvalidDocumentCodeError)
  })

  test('a content that is not the canonical TT + Crockford base 32 is refused', () => {
    for (const bad of ['', 'TT', 'XXYGJ0', 'TTYGJ', 'ttYGJ0', 'TT0YGJ0', 'TTILOU01'])
      expect(() => orderCodeFromContent(bad)).toThrow(InvalidDocumentCodeError)
  })
})
