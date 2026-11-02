import { describe, expect, test } from 'bun:test'
import { money } from '@rms/shared-types'
import { buildReceiptSnapshot, type ReceiptContext } from './receipt-snapshot'

const CONTEXT: ReceiptContext = {
  timeZone: 'Asia/Ho_Chi_Minh',
  company: {
    name: { vi: 'Công ty Quản lý An Phú', en: 'An Phu Property Management Co.' },
    address: '12 Nguyễn Văn Linh, Quận 7',
    hotline: '028 3775 1234',
    logoKey: null,
  },
  building: { name: { vi: 'Chung cư Sunrise', en: 'Sunrise Residences' } },
  payer: { name: 'Trần Minh Anh', memberType: 'owner' },
}

const LINES = [
  {
    kind: 'fee' as const,
    name: { vi: 'Phí quản lý' },
    quantity: '1',
    unitPrice: 2_488_000,
    amount: 2_488_000,
    note: null,
  },
  {
    kind: 'fee' as const,
    name: { vi: 'Phí nước' },
    quantity: '12.345',
    unitPrice: 15_000,
    amount: 185_175,
    note: null,
  },
  {
    kind: 'adjustment' as const,
    name: { vi: 'Điều chỉnh' },
    quantity: '1',
    unitPrice: 0,
    amount: -35_175,
    note: 'Trừ phí nước tính thừa tháng 9',
  },
]

describe('buildReceiptSnapshot (DOC-15 §7.3, DOC-22 §7)', () => {
  test('freezes the shape of DOC-15 §7.3 from the charge, its lines and the payment', () => {
    const snapshot = buildReceiptSnapshot(
      CONTEXT,
      {
        chargeId: 'charge-1',
        unitId: 'unit-1',
        unitCode: 'A-1508',
        amount: money(2_638_000),
        batch: { code: 'PH-2610-01', name: { vi: 'Phí tháng 10/2026' }, feeMonth: '2026-10-01' },
        lines: LINES,
      },
      {
        source: 'online',
        receivedAt: new Date('2026-10-09T02:12:41Z'),
        gatewayReference: 'FT2628273914',
        bankReference: null,
      },
      new Date('2026-10-09T02:12:42Z'),
    )
    expect(snapshot).toEqual({
      company: CONTEXT.company,
      building: CONTEXT.building,
      unitCode: 'A-1508',
      payer: CONTEXT.payer,
      batch: { code: 'PH-2610-01', name: { vi: 'Phí tháng 10/2026' }, feeMonth: '2026-10-01' },
      lines: LINES,
      amount: 2_638_000,
      method: 'online',
      reference: 'FT2628273914',
      paidAt: '2026-10-09T02:12:41.000Z',
      issuedAt: '2026-10-09T02:12:42.000Z',
    })
    expect(snapshot.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(snapshot.amount)
  })

  test('prints the bank reference of a manual receipt, or null when there is none', () => {
    const charge = {
      chargeId: 'charge-1',
      unitId: 'unit-1',
      unitCode: 'A-1508',
      amount: money(350_000),
      batch: { code: 'PH-2610-01', name: { vi: 'Phí' }, feeMonth: '2026-10-01' },
      lines: [],
    }
    const withReference = buildReceiptSnapshot(
      CONTEXT,
      charge,
      {
        source: 'bank_transfer',
        receivedAt: new Date('2026-10-19T00:00:00Z'),
        gatewayReference: null,
        bankReference: 'FT01',
      },
      new Date('2026-10-19T00:00:01Z'),
    )
    expect(withReference.method).toBe('bank_transfer')
    expect(withReference.reference).toBe('FT01')
    const without = buildReceiptSnapshot(
      CONTEXT,
      charge,
      {
        source: 'cash',
        receivedAt: new Date('2026-10-19T00:00:00Z'),
        gatewayReference: null,
        bankReference: null,
      },
      new Date('2026-10-19T00:00:01Z'),
    )
    expect(without.reference).toBeNull()
  })
})
