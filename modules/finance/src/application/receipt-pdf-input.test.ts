import { describe, expect, test } from 'bun:test'
import type { ReceiptPdfRow } from '../domain/receipt-pdf-repository'
import type { ReceiptSnapshot } from '../domain/receipt-snapshot'
import { receiptPdfKey, toReceiptInput } from './receipt-pdf-input'

/**
 * The pure mapper of DOC-34 §8.2, §7 (DR-17, DR-295): the snapshot to `ReceiptInput`, the `issued` and `void` cuts,
 * an adjustment line and a missing logo.
 */

const snapshot: ReceiptSnapshot = {
  company: {
    name: { vi: 'Công ty Quản lý An Phú', en: 'An Phu Property Management Co.' },
    address: '12 Nguyễn Văn Linh, Quận 7',
    hotline: '028 3775 1234',
    logoKey: '0192f3c4-9d02-7000-8000-00000000f0a1',
  },
  building: { name: { vi: 'Chung cư Sunrise', en: 'Sunrise Residences' } },
  unitCode: 'A-1508',
  payer: { name: 'Trần Minh Anh', memberType: 'owner' },
  batch: {
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
    feeMonth: '2026-10-01',
  },
  lines: [
    {
      kind: 'fee',
      name: { vi: 'Phí quản lý', en: 'Management fee' },
      quantity: '1',
      unitPrice: 2_488_000,
      amount: 2_488_000,
      note: null,
    },
    {
      kind: 'adjustment',
      name: { vi: 'Điều chỉnh', en: 'Adjustment' },
      quantity: '1',
      unitPrice: -35_175,
      amount: -35_175,
      note: 'Bù trừ tháng 9',
    },
  ],
  amount: 2_452_825,
  method: 'cash',
  reference: 'BB-2026-10-0007',
  paidAt: '2026-10-09T02:12:00.000Z',
  issuedAt: '2026-10-09T02:12:05.000Z',
}

const ISSUED: ReceiptPdfRow = {
  id: '0192f3c4-0000-7000-8000-0000000000c3',
  number: 'BL-2610-0153',
  status: 'issued',
  snapshot,
  pdfFile: null,
  issuedAt: new Date('2026-10-09T02:12:05.000Z'),
  voidedAt: null,
  voidReason: null,
}

const LOGO = new Uint8Array([1, 2, 3])

describe('toReceiptInput / receiptPdfKey (DOC-34 §8.2, DR-295)', () => {
  test('an issued receipt maps the snapshot, the logo and no void block', () => {
    const input = toReceiptInput(ISSUED, 'both', LOGO)
    expect(input.kind).toBe('receipt')
    expect(input.language).toBe('both')
    expect(input.number).toBe('BL-2610-0153')
    expect(input.issuedAt).toBe('2026-10-09T02:12:05.000Z')
    expect(input.paidAt).toBe('2026-10-09T02:12:00.000Z')
    expect(input.unit.code).toBe('A-1508')
    expect(input.method).toBe('cash')
    expect(input.amount).toBe(2_452_825)
    expect(input.logo).toBe(LOGO)
    expect(input.void).toBeNull()
    expect(input.company.name.vi).toBe('Công ty Quản lý An Phú')
    expect(input.items).toEqual([
      {
        position: 1,
        itemName: { vi: 'Phí quản lý', en: 'Management fee' },
        quantity: '1',
        unitPrice: 2_488_000,
        amount: 2_488_000,
        kind: 'normal',
        note: null,
      },
      {
        position: 2,
        itemName: { vi: 'Điều chỉnh', en: 'Adjustment' },
        quantity: '1',
        unitPrice: -35_175,
        amount: -35_175,
        kind: 'adjustment',
        note: 'Bù trừ tháng 9',
      },
    ])
  })

  test('a void receipt carries the void block with the day in the building zone', () => {
    const input = toReceiptInput(
      {
        ...ISSUED,
        status: 'void',
        pdfFile: ISSUED.id,
        voidedAt: new Date('2026-10-12T03:00:00.000Z'),
        voidReason: 'Ghi nhầm',
      },
      'vi',
      null,
    )
    expect(String(input.void?.voidedOn)).toBe('2026-10-12')
    expect(input.void?.reason).toBe('Ghi nhầm')
    expect(input.logo).toBeNull()
  })

  test('the pdf keys are the two logical keys of §8.2', () => {
    expect(receiptPdfKey('0192f3c4-0000-7000-8000-0000000000c3', 'issued')).toBe(
      'receipt/0192f3c4-0000-7000-8000-0000000000c3/issued.pdf',
    )
    expect(receiptPdfKey('0192f3c4-0000-7000-8000-0000000000c3', 'void')).toBe(
      'receipt/0192f3c4-0000-7000-8000-0000000000c3/void.pdf',
    )
  })
})
