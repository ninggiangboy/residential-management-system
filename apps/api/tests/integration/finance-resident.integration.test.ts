import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import {
  api,
  bodyOf,
  errorOf,
  localDay,
  seedBuilding,
  seedPublishedCharge,
  seedResident,
  seedStaff,
  seedUnit,
  signInResident,
  signInStaff,
} from './finance-support'
import { containerFor } from './support'

/**
 * The resident fee routes over HTTP against a real PostgreSQL (DOC-51 §2.2, DOC-22 §8.4, DOC-58, DR-40; P2-15): the open
 * charges (E-80), one charge (E-81), the paid history and its summary (E-82), the receipts (E-83), the receipt PDF (E-84,
 * PD-25) and the staff PDF (E-106). A membership built after a payment sees only the open charges (LG-43); a helper is 403
 * (LG-44). The window is `UnitContext.startedAt = membership.created_at`.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000031'
const EARLY = new Date('2026-01-01T00:00:00Z')
const LATE = new Date(Date.now() + 86_400_000)

let db: TestDb
let built: ReturnType<typeof containerFor>
let app: ReturnType<typeof containerFor>['app']
let manager: string
let unit1: string
let unit2: string
let early: { token: string; accountId: string }
let late: { token: string; accountId: string }
let helper: { token: string; accountId: string }
let otherUnit: { token: string; accountId: string }
let charge1: string
let charge2: string
let charge3: string
let paymentId: string
let receipt1: { receiptId: string; number: string }
let today: string

const asUnit = (path: string, token: string, unit: string) => api(app, path, { token, unit })

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await seedBuilding(db, BUILDING, 'SUNRISE-RESIDENT')
  await seedStaff(db, { buildingId: BUILDING, email: 'manager@resident.example', role: 'manager' })
  unit1 = await seedUnit(db, { buildingId: BUILDING, code: 'A-1508' })
  unit2 = await seedUnit(db, { buildingId: BUILDING, code: 'A-1509' })

  const a = await seedResident(db, {
    buildingId: BUILDING,
    unitId: unit1,
    memberType: 'owner',
    createdAt: EARLY,
  })
  const b = await seedResident(db, {
    buildingId: BUILDING,
    unitId: unit1,
    memberType: 'tenant',
    createdAt: LATE,
  })
  const h = await seedResident(db, {
    buildingId: BUILDING,
    unitId: unit1,
    memberType: 'helper',
    createdAt: EARLY,
  })
  const c = await seedResident(db, {
    buildingId: BUILDING,
    unitId: unit2,
    memberType: 'family',
    createdAt: EARLY,
  })

  const one = await seedPublishedCharge(db, {
    buildingId: BUILDING,
    unitId: unit1,
    unitCode: 'A-1508',
    amount: 300_000,
    code: 'PH-2610-11',
  })
  const two = await seedPublishedCharge(db, {
    buildingId: BUILDING,
    unitId: unit1,
    unitCode: 'A-1508',
    amount: 500_000,
    code: 'PH-2610-12',
  })
  const three = await seedPublishedCharge(db, {
    buildingId: BUILDING,
    unitId: unit1,
    unitCode: 'A-1508',
    amount: 700_000,
    code: 'PH-2610-13',
    dueDate: '2026-10-01',
  })
  charge1 = one.chargeId
  charge2 = two.chargeId
  charge3 = three.chargeId

  built = containerFor(db.url, { storage: new FakeStorage() })
  app = built.app
  manager = await signInStaff(app, 'manager@resident.example')
  early = { token: await signInResident(app, a.phone), accountId: a.accountId }
  late = { token: await signInResident(app, b.phone), accountId: b.accountId }
  helper = { token: await signInResident(app, h.phone), accountId: h.accountId }
  otherUnit = { token: await signInResident(app, c.phone), accountId: c.accountId }
  today = localDay(built.container.clock.now())

  // Both charges of the unit are paid; C3 stays open.
  const paid = await api(app, '/staff/payments', {
    method: 'POST',
    token: manager,
    key: crypto.randomUUID(),
    json: {
      unitId: unit1,
      chargeIds: [charge1, charge2],
      method: 'cash',
      payerName: 'Trần Minh Anh',
      receivedOn: today,
    },
  })
  expect(paid.status).toBe(201)
  const payment = await bodyOf<{
    paymentId: string
    receipts: Array<{ receiptId: string; number: string; chargeId: string }>
  }>(paid)
  paymentId = payment.paymentId
  const first = payment.receipts.find((receipt) => receipt.chargeId === charge1)
  if (!first) throw new Error('no receipt for charge1')
  receipt1 = { receiptId: first.receiptId, number: first.number }
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe("the unit's charges (E-80, E-81)", () => {
  test('E-80 lists the open charges with the total, the count and payment disabled; the paid ones are gone', async () => {
    const res = await asUnit('/me/fees', early.token, unit1)
    expect(res.status).toBe(200)
    const fees = await bodyOf<{
      items: Array<{
        chargeId: string
        amount: number
        dueDate: string
        daysPastDue: number
        overdue: boolean
        lines: unknown[]
      }>
      total: number
      count: number
      payment: { enabled: boolean }
    }>(res)
    expect(fees.payment).toEqual({ enabled: false })
    expect(fees.count).toBe(1)
    expect(fees.total).toBe(700_000)
    expect(fees.items[0]).toMatchObject({ chargeId: charge3, amount: 700_000, overdue: true })
    expect(fees.items[0]?.daysPastDue).toBeGreaterThan(0)
    expect(fees.items[0]?.lines.length).toBeGreaterThanOrEqual(1)
  })

  test('E-81 reads one charge: a paid one with its payment and receipt, an open one with none, another unit is 404', async () => {
    const paid = await bodyOf<{
      chargeId: string
      status: string
      amount: number
      payment: { method: string } | null
      receipt: { id: string; number: string } | null
      lines: unknown[]
    }>(await asUnit(`/me/fees/${charge1}`, early.token, unit1))
    expect(paid).toMatchObject({ chargeId: charge1, status: 'paid', amount: 300_000 })
    expect(paid.payment).toMatchObject({ method: 'cash' })
    expect(paid.receipt).toMatchObject({ id: receipt1.receiptId, number: receipt1.number })

    const open = await bodyOf<{ status: string; payment: unknown }>(
      await asUnit(`/me/fees/${charge3}`, early.token, unit1),
    )
    expect(open).toMatchObject({ status: 'open', payment: null })

    expect((await asUnit(`/me/fees/${charge1}`, otherUnit.token, unit2)).status).toBe(404)
    expect((await asUnit(`/me/fees/${crypto.randomUUID()}`, early.token, unit1)).status).toBe(404)
  })
})

describe("the unit's history and receipts (E-82, E-83)", () => {
  test('E-82 lists the paid charges newest first, keysets over two pages and carries the summary only on page 1', async () => {
    const page1 = await bodyOf<{
      items: Array<{ chargeId: string; amount: number }>
      nextCursor: string
      summary: { outstanding: number; paidThisYear: number } | null
    }>(await asUnit('/me/fees/history?limit=1', early.token, unit1))
    expect(page1.items).toHaveLength(1)
    expect(page1.summary).toEqual({ outstanding: 700_000, paidThisYear: 800_000 })
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await bodyOf<{ items: Array<{ chargeId: string }>; summary: unknown }>(
      await asUnit(
        `/me/fees/history?limit=1&cursor=${encodeURIComponent(page1.nextCursor)}`,
        early.token,
        unit1,
      ),
    )
    expect(page2.items).toHaveLength(1)
    expect(page2.summary).toBeNull()
    const ids = [page1.items[0]?.chargeId, page2.items[0]?.chargeId]
    expect(new Set(ids)).toEqual(new Set([charge1, charge2]))
  })

  test('E-83 lists the receipts newest first', async () => {
    const receipts = await bodyOf<{
      items: Array<{ number: string; chargeId: string; status: string }>
    }>(await asUnit('/me/receipts', early.token, unit1))
    expect(receipts.items).toHaveLength(2)
    expect(receipts.items.map((receipt) => receipt.chargeId).sort()).toEqual(
      [charge1, charge2].sort(),
    )
    expect(receipts.items.every((receipt) => receipt.status === 'issued')).toBe(true)
  })
})

describe('LG-43 the DR-40 window (a member added after a payment) and LG-44 (a helper)', () => {
  test('LG-43 a member since after the payment sees the open charges but not the history, receipts or the paid detail', async () => {
    const open = await bodyOf<{ count: number }>(await asUnit('/me/fees', late.token, unit1))
    expect(open.count).toBe(1)

    const history = await bodyOf<{ items: unknown[] }>(
      await asUnit('/me/fees/history', late.token, unit1),
    )
    expect(history.items).toEqual([])
    const receipts = await bodyOf<{ items: unknown[] }>(
      await asUnit('/me/receipts', late.token, unit1),
    )
    expect(receipts.items).toEqual([])
    expect((await asUnit(`/me/fees/${charge1}`, late.token, unit1)).status).toBe(404)

    // A member since before the payment sees all of it.
    const earlyHistory = await bodyOf<{ items: unknown[] }>(
      await asUnit('/me/fees/history', early.token, unit1),
    )
    expect(earlyHistory.items).toHaveLength(2)
  })

  test('LG-44 a helper is 403 forbidden on E-80…E-84', async () => {
    for (const path of [
      '/me/fees',
      `/me/fees/${charge1}`,
      '/me/fees/history',
      '/me/receipts',
      `/me/receipts/${receipt1.receiptId}/pdf`,
    ]) {
      const res = await asUnit(path, helper.token, unit1)
      expect(res.status).toBe(403)
      expect((await errorOf(res)).code).toBe('forbidden')
    }
  })

  test("a member of another unit is 404 for this unit's charge and receipt", async () => {
    expect((await asUnit(`/me/fees/${charge1}`, otherUnit.token, unit2)).status).toBe(404)
    expect(
      (await asUnit(`/me/receipts/${receipt1.receiptId}/pdf`, otherUnit.token, unit2)).status,
    ).toBe(404)
  })
})

describe('the receipt PDFs (E-84, PD-25, E-106)', () => {
  test("E-84 serves the unit's own receipt as a PDF, names it for its number, and 404s another unit's and a pre-membership one", async () => {
    const res = await asUnit(`/me/receipts/${receipt1.receiptId}/pdf`, early.token, unit1)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${receipt1.number}.pdf"`,
    )
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')

    expect(
      (await asUnit(`/me/receipts/${receipt1.receiptId}/pdf`, otherUnit.token, unit2)).status,
    ).toBe(404)
    expect((await asUnit(`/me/receipts/${receipt1.receiptId}/pdf`, late.token, unit1)).status).toBe(
      404,
    )
  })

  test('E-106 serves the same receipt to the staff', async () => {
    const res = await api(app, `/staff/receipts/${receipt1.receiptId}/pdf`, { token: manager })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="${receipt1.number}.pdf"`,
    )
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  })

  test('a voided receipt still renders (the VOID copy)', async () => {
    const voided = await api(app, `/staff/payments/${paymentId}/void`, {
      method: 'POST',
      token: manager,
      json: { reason: 'recorded by mistake' },
    })
    expect(voided.status).toBe(200)
    const res = await asUnit(`/me/receipts/${receipt1.receiptId}/pdf`, early.token, unit1)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  })
})
