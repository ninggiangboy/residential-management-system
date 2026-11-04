import { describe, expect, test } from 'bun:test'
import { amountInWords } from './words'

/**
 * PD-15 of DOC-34 §7.1 (DR-295): the "Bằng chữ / In words" of the receipt total, both languages.
 */
const table: [bigint | number, string, string][] = [
  [
    2638000,
    'Hai triệu sáu trăm ba mươi tám nghìn đồng',
    'Two million six hundred thirty-eight thousand dong',
  ],
  [1005000, 'Một triệu không trăm linh năm nghìn đồng', 'One million five thousand dong'],
  [15000, 'Mười lăm nghìn đồng', 'Fifteen thousand dong'],
  [21000, 'Hai mươi mốt nghìn đồng', 'Twenty-one thousand dong'],
  [105000, 'Một trăm linh năm nghìn đồng', 'One hundred five thousand dong'],
  [
    2488000,
    'Hai triệu bốn trăm tám mươi tám nghìn đồng',
    'Two million four hundred eighty-eight thousand dong',
  ],
  [1000000000, 'Một tỷ đồng', 'One billion dong'],
  [0, 'Không đồng', 'Zero dong'],
  [1500000000000, 'Một nghìn tỷ năm trăm tỷ đồng', 'One trillion five hundred billion dong'],
]

describe('amountInWords', () => {
  test.each(table)('%p', (amount, vi, en) => {
    expect(amountInWords(amount, 'vi')).toBe(vi)
    expect(amountInWords(amount, 'en')).toBe(en)
  })

  test('reads a bigint amount', () => {
    expect(amountInWords(2638000n, 'vi')).toBe('Hai triệu sáu trăm ba mươi tám nghìn đồng')
  })

  test('reads eleven as "mười một", not "mười mốt"', () => {
    expect(amountInWords(11000, 'vi')).toBe('Mười một nghìn đồng')
    expect(amountInWords(111000, 'vi')).toBe('Một trăm mười một nghìn đồng')
    expect(amountInWords(25000, 'vi')).toBe('Hai mươi lăm nghìn đồng')
  })

  test('refuses a negative amount', () => {
    expect(() => amountInWords(-1000, 'vi')).toThrow(RangeError)
  })

  test('refuses a fraction', () => {
    expect(() => amountInWords(1.5, 'en')).toThrow(RangeError)
  })
})
