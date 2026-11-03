import { describe, expect, test } from 'bun:test'
import { localDate } from '@rms/shared-types'
import { RequestRuleError } from './errors'
import {
  checkManualPayment,
  MANUAL_PAYMENT_BACKDATE_DAYS,
  MANUAL_PAYMENT_MAX_CHARGES,
  type ManualPaymentInput,
  receivedAtOf,
} from './manual-payment'

type RuleDetail = { readonly path: string; readonly code: string }

const TODAY = localDate('2026-10-19')

const BASE: ManualPaymentInput = {
  unitId: 'unit-1',
  chargeIds: ['charge-a'],
  method: 'cash',
  payerName: 'Trần Minh Anh',
  receivedOn: '2026-10-19',
}

/** The first `RequestRuleError` detail of a refused body, or undefined when the body passed (DOC-42 §5.2). */
const refusal = (patch: Partial<ManualPaymentInput>, isAdmin = false) => {
  try {
    checkManualPayment({ ...BASE, ...patch }, TODAY, isAdmin)
  } catch (error) {
    if (!(error instanceof RequestRuleError)) throw error
    const details = error.details as ReadonlyArray<RuleDetail> | undefined
    return details?.[0]
  }
  return undefined
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `charge-${i}`)

describe('checkManualPayment, the request rules of DOC-22 §5.1', () => {
  test('LG-05: the receivedOn window is today − 90 days, widened for an Admin', () => {
    expect(MANUAL_PAYMENT_BACKDATE_DAYS).toBe(90)
    expect(refusal({ receivedOn: '2026-10-20' })).toMatchObject({
      path: 'receivedOn',
      code: 'received_on_future',
    })
    expect(refusal({ receivedOn: '2026-07-20' })).toMatchObject({
      path: 'receivedOn',
      code: 'received_on_too_old',
    })
    expect(refusal({ receivedOn: '2026-07-20' }, true)).toBeUndefined()
    expect(refusal({ receivedOn: '2026-07-21' })).toBeUndefined()
  })

  test('LG-08: zero ids, 51 distinct ids, and a duplicate counted once', () => {
    expect(refusal({ chargeIds: [] })).toMatchObject({
      path: 'chargeIds',
      code: 'too_few_charges',
    })
    expect(refusal({ chargeIds: ids(51) })).toMatchObject({
      path: 'chargeIds',
      code: 'too_many_charges',
    })
    const checked = checkManualPayment(
      { ...BASE, chargeIds: ['charge-a', 'charge-b', 'charge-a'] },
      TODAY,
      false,
    )
    expect(checked.chargeIds).toEqual(['charge-a', 'charge-b'])
    const duplicated = [...ids(MANUAL_PAYMENT_MAX_CHARGES), 'charge-0']
    expect(refusal({ chargeIds: duplicated })).toBeUndefined()
  })

  test('payerName is trimmed, required, and at most 120 characters', () => {
    expect(refusal({ payerName: '   ' })).toMatchObject({
      path: 'payerName',
      code: 'required',
    })
    expect(refusal({ payerName: 'x'.repeat(121) })).toMatchObject({
      path: 'payerName',
      code: 'max_length',
    })
    const trimmed = checkManualPayment({ ...BASE, payerName: '  An  ' }, TODAY, false)
    expect(trimmed.payerName).toBe('An')
  })

  test('bankReference is trimmed, blank read as null, at most 100 characters', () => {
    expect(refusal({ bankReference: 'x'.repeat(101) })).toMatchObject({
      path: 'bankReference',
      code: 'max_length',
    })
    const blank = checkManualPayment({ ...BASE, bankReference: '   ' }, TODAY, false)
    expect(blank.bankReference).toBeNull()
  })

  test('a statement line needs bank_transfer (ck_payment_statement_line)', () => {
    expect(refusal({ statementLineId: 'line-1', method: 'cash' })).toMatchObject({
      path: 'method',
      code: 'enum',
    })
    expect(refusal({ statementLineId: 'line-1', method: 'bank_transfer' })).toBeUndefined()
  })

  test('amount and note pass through; dryRun defaults to false (DOC-22 §5.1)', () => {
    const full = { ...BASE, amount: 2_838_000, note: '  ok  ', dryRun: true }
    const checked = checkManualPayment(full, TODAY, false)
    expect([checked.amount, checked.note, checked.dryRun]).toEqual([2_838_000, 'ok', true])
    const plain = checkManualPayment(BASE, TODAY, false)
    expect([plain.amount, plain.note, plain.dryRun]).toEqual([null, null, false])
  })
})

describe('receivedAtOf: now for today, else 12:00 local (DOC-22 §5.1, DR-09)', () => {
  const zone = 'Asia/Ho_Chi_Minh'
  const now = new Date('2026-10-19T03:21:44.512Z')

  test('a payment received today is stamped with the instant itself', () => {
    expect(receivedAtOf(TODAY, TODAY, now, zone)).toBe(now)
  })

  test('an earlier day is 12:00 local in the building zone', () => {
    expect(receivedAtOf(localDate('2026-10-10'), TODAY, now, zone).toISOString()).toBe(
      '2026-10-10T05:00:00.000Z',
    )
    expect(receivedAtOf(localDate('2026-10-10'), TODAY, now, 'UTC').toISOString()).toBe(
      '2026-10-10T12:00:00.000Z',
    )
  })
})
