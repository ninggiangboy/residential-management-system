import { describe, expect, test } from 'bun:test'
import { type DomainEvent, type IdGenerator, InvariantError } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import { FakeClock } from '@core/testing'
import { type BuildingScope, type ChargeStatus, type Money, money } from '@rms/shared-types'
import type {
  ChargeState,
  LedgerRepository,
  NewAllocation,
  NewPayment,
  NewReceipt,
} from '../../domain/ledger-repository'
import type { ReceiptCounter } from '../../domain/receipt-counter'
import type { ReceiptCharge, ReceiptContext } from '../../domain/receipt-snapshot'
import { type AllocatedPayment, ChargeAllocator } from './charge-allocator'

const SCOPE: BuildingScope = { buildingId: crypto.randomUUID() as BuildingScope['buildingId'] }
const CONTEXT: ReceiptContext = {
  timeZone: 'Asia/Ho_Chi_Minh',
  company: {
    name: { vi: 'Công ty', en: 'Company' },
    address: '12 Nguyễn Văn Linh',
    hotline: '028 3775 1234',
    logoKey: null,
  },
  building: { name: { vi: 'Chung cư', en: 'Building' } },
  payer: { name: 'Trần Minh Anh', memberType: null },
}
const PAYMENT: AllocatedPayment = {
  paymentId: 'payment-1',
  source: 'cash',
  receivedAt: new Date('2026-10-19T03:00:00Z'),
  gatewayReference: null,
  bankReference: null,
}

class SeqIds implements IdGenerator {
  private n = 0
  next(): string {
    return `00000000-0000-7000-8000-${String(++this.n).padStart(12, '0')}`
  }
}

interface FakeCharge {
  status: ChargeStatus
  amount: Money
  unitId: string
  unitCode: string
}

class FakeLedger implements LedgerRepository {
  readonly log: string[] = []
  readonly charges = new Map<string, FakeCharge>()
  readonly allocations: NewAllocation[] = []
  readonly receipts: NewReceipt[] = []

  open(chargeId: string, amount: number): void {
    this.charges.set(chargeId, {
      status: 'open',
      amount: money(amount),
      unitId: crypto.randomUUID(),
      unitCode: `A-${chargeId}`,
    })
  }

  async payOpenCharge(_scope: BuildingScope, chargeId: string, expected: Money): Promise<boolean> {
    this.log.push(`pay:${chargeId}`)
    const charge = this.charges.get(chargeId)
    if (charge?.status !== 'open' || charge.amount !== expected) return false
    charge.status = 'paid'
    return true
  }

  async readChargeState(_scope: BuildingScope, chargeId: string): Promise<ChargeState | null> {
    const charge = this.charges.get(chargeId)
    return charge ? { chargeId, status: charge.status, amount: charge.amount } : null
  }

  async readChargeForReceipt(
    _scope: BuildingScope,
    chargeId: string,
  ): Promise<ReceiptCharge | null> {
    const charge = this.charges.get(chargeId)
    if (!charge) return null
    return {
      chargeId,
      unitId: charge.unitId,
      unitCode: charge.unitCode,
      amount: charge.amount,
      batch: { code: 'PH-2610-01', name: { vi: 'Phí' }, feeMonth: '2026-10-01' },
      lines: [
        {
          kind: 'fee',
          name: { vi: 'Phí quản lý' },
          quantity: '1',
          unitPrice: Number(charge.amount),
          amount: Number(charge.amount),
          note: null,
        },
      ],
    }
  }

  async insertAllocation(_scope: BuildingScope, allocation: NewAllocation): Promise<void> {
    this.log.push(`allocation:${allocation.chargeId}`)
    this.allocations.push(allocation)
  }

  async insertReceipt(_scope: BuildingScope, receipt: NewReceipt): Promise<void> {
    this.log.push(`receipt:${receipt.number}`)
    this.receipts.push(receipt)
  }

  async insertPayment(_scope: BuildingScope, _payment: NewPayment): Promise<void> {
    throw new Error('the allocator never inserts a payment')
  }
}

class FakeCounter implements ReceiptCounter {
  private last = 0
  constructor(readonly log: string[]) {}
  async next(_scope: BuildingScope, _series: 'receipt', period: string): Promise<number> {
    this.log.push(`counter:${period}`)
    return ++this.last
  }
}

class FakeOutbox implements OutboxWriter {
  readonly events: DomainEvent[] = []
  async add(events: DomainEvent[]): Promise<void> {
    this.events.push(...events)
  }
}

function makeAllocator(at: Date): {
  allocator: ChargeAllocator
  ledger: FakeLedger
  counter: FakeCounter
  outbox: FakeOutbox
} {
  const ledger = new FakeLedger()
  const counter = new FakeCounter(ledger.log)
  const outbox = new FakeOutbox()
  return {
    allocator: new ChargeAllocator(ledger, counter, outbox, new FakeClock(at), new SeqIds()),
    ledger,
    counter,
    outbox,
  }
}

describe('ChargeAllocator (DOC-22 §4, ADR-0006)', () => {
  test('sorts the charges by id ascending, whatever order the caller passed', async () => {
    const { allocator, ledger } = makeAllocator(new Date('2026-10-19T03:00:00Z'))
    ledger.open('charge-a', 100_000)
    ledger.open('charge-b', 200_000)
    const result = await allocator.allocate(
      SCOPE,
      PAYMENT,
      [
        { chargeId: 'charge-b', expectedAmount: money(200_000) },
        { chargeId: 'charge-a', expectedAmount: money(100_000) },
      ],
      CONTEXT,
    )
    expect(result.ok).toBe(true)
    expect(ledger.log.filter((entry) => entry.startsWith('pay:'))).toEqual([
      'pay:charge-a',
      'pay:charge-b',
    ])
  })

  test('rejects a duplicate charge id as a programming error', async () => {
    const { allocator, ledger } = makeAllocator(new Date('2026-10-19T03:00:00Z'))
    ledger.open('charge-a', 100_000)
    await expect(
      allocator.allocate(
        SCOPE,
        PAYMENT,
        [
          { chargeId: 'charge-a', expectedAmount: money(100_000) },
          { chargeId: 'charge-a', expectedAmount: money(100_000) },
        ],
        CONTEXT,
      ),
    ).rejects.toThrow(InvariantError)
  })

  test('stops at the first charge that gives 0 rows and reports it', async () => {
    const { allocator, ledger } = makeAllocator(new Date('2026-10-19T03:00:00Z'))
    ledger.open('charge-a', 100_000)
    ledger.charges.set('charge-b', {
      status: 'paid',
      amount: money(200_000),
      unitId: 'unit-b',
      unitCode: 'B',
    })
    ledger.open('charge-c', 300_000)
    const result = await allocator.allocate(
      SCOPE,
      PAYMENT,
      [
        { chargeId: 'charge-a', expectedAmount: money(100_000) },
        { chargeId: 'charge-b', expectedAmount: money(200_000) },
        { chargeId: 'charge-c', expectedAmount: money(300_000) },
      ],
      CONTEXT,
    )
    expect(result).toEqual({ ok: false, failed: { chargeId: 'charge-b', reason: 'not_open' } })
    expect(ledger.allocations).toHaveLength(1)
    expect(ledger.log).not.toContain('pay:charge-c')
  })

  test('maps an open charge at another amount to amount_changed and a paid or void one to not_open', async () => {
    const { allocator, ledger } = makeAllocator(new Date('2026-10-19T03:00:00Z'))
    ledger.open('charge-open', 100_000)
    ledger.charges.set('charge-void', {
      status: 'void',
      amount: money(100_000),
      unitId: 'unit-v',
      unitCode: 'V',
    })
    const changed = await allocator.allocate(
      SCOPE,
      PAYMENT,
      [{ chargeId: 'charge-open', expectedAmount: money(999) }],
      CONTEXT,
    )
    expect(changed).toEqual({
      ok: false,
      failed: { chargeId: 'charge-open', reason: 'amount_changed' },
    })
    const missing = await allocator.allocate(
      SCOPE,
      PAYMENT,
      [{ chargeId: 'charge-void', expectedAmount: money(100_000) }],
      CONTEXT,
    )
    expect(missing).toEqual({
      ok: false,
      failed: { chargeId: 'charge-void', reason: 'not_open' },
    })
  })

  test('takes the receipt number after the charge update and before the receipt insert', async () => {
    const { allocator, ledger } = makeAllocator(new Date('2026-10-19T03:00:00Z'))
    ledger.open('charge-a', 100_000)
    await allocator.allocate(
      SCOPE,
      PAYMENT,
      [{ chargeId: 'charge-a', expectedAmount: money(100_000) }],
      CONTEXT,
    )
    const pay = ledger.log.indexOf('pay:charge-a')
    const counter = ledger.log.findIndex((entry) => entry.startsWith('counter:'))
    const receipt = ledger.log.findIndex((entry) => entry.startsWith('receipt:'))
    expect(pay).toBeLessThan(counter)
    expect(counter).toBeLessThan(receipt)
  })

  test('reads the receipt period in building time: 23:59 local stays in the month, 00:01 local rolls over', async () => {
    const before = makeAllocator(new Date('2026-10-31T16:59:00Z'))
    before.ledger.open('charge-a', 100_000)
    await before.allocator.allocate(
      SCOPE,
      PAYMENT,
      [{ chargeId: 'charge-a', expectedAmount: money(100_000) }],
      CONTEXT,
    )
    expect(before.counter.log).toContain('counter:2610')
    expect(before.ledger.receipts[0]?.number).toBe('BL-2610-0001')

    const after = makeAllocator(new Date('2026-10-31T17:01:00Z'))
    after.ledger.open('charge-a', 100_000)
    await after.allocator.allocate(
      SCOPE,
      PAYMENT,
      [{ chargeId: 'charge-a', expectedAmount: money(100_000) }],
      CONTEXT,
    )
    expect(after.counter.log).toContain('counter:2611')
    expect(after.ledger.receipts[0]?.number).toBe('BL-2611-0001')
  })
})
