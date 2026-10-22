import { describe, expect, test } from 'bun:test'
import { RuleViolationError } from '@core/kernel'
import {
  assertActionShape,
  checkedReason,
  clip,
  MAX_ENTRY_BYTES,
  MAX_STRING_LENGTH,
  preparePayload,
} from './entry'
import { AuditEntryTooLargeError, MalformedAuditActionError } from './errors'

describe('the limits of an entry (DOC-35 §3.4, §3.5)', () => {
  test('AD-11 a string value of 600 characters is stored cut at 500 characters with …', () => {
    const [change] = preparePayload([
      { field: 'status', before: 'x'.repeat(600), after: 'short' },
    ]).changes
    expect(change?.before).toHaveLength(MAX_STRING_LENGTH)
    expect(String(change?.before).endsWith('…')).toBe(true)
    expect(change?.after).toBe('short')
    expect(clip('x'.repeat(500))).toHaveLength(500)
  })

  test('AD-11 details are cut the same way, at any depth', () => {
    const { details } = preparePayload([], {
      note: 'y'.repeat(700),
      nested: { list: ['z'.repeat(700)] },
    })
    expect(String(details.note)).toHaveLength(MAX_STRING_LENGTH)
    expect(JSON.stringify(details)).not.toContain('z'.repeat(501))
  })

  test('AD-12 an entry larger than 32,768 bytes is refused', () => {
    const changes = Array.from({ length: 80 }, (_, i) => ({
      field: `field${i}`,
      before: 'b'.repeat(400),
      after: 'a'.repeat(400),
    }))
    expect(() => preparePayload(changes)).toThrow(AuditEntryTooLargeError)
    expect(MAX_ENTRY_BYTES).toBe(32_768)
    expect(() => preparePayload(changes.slice(0, 10))).not.toThrow()
  })

  test('AD-08 a reason of 4 characters on finance.payment.void is refused with reason_too_short', () => {
    for (const reason of [undefined, '', '  ab ', 'four']) {
      const attempt = () => checkedReason('finance.payment.void', reason)
      expect(attempt).toThrow(RuleViolationError)
      try {
        attempt()
      } catch (error) {
        expect((error as RuleViolationError).details).toEqual([
          expect.objectContaining({ code: 'reason_too_short', path: 'reason' }),
        ])
      }
    }
    expect(checkedReason('finance.payment.void', '  wrong unit  ')).toBe('wrong unit')
  })

  test('an action that needs no reason takes none, or a trimmed one cut at 500 characters', () => {
    expect(checkedReason('building.settings.update', undefined)).toBeUndefined()
    expect(checkedReason('building.settings.update', '   ')).toBeUndefined()
    expect(checkedReason('building.settings.update', 'because')).toBe('because')
    expect(checkedReason('building.settings.update', 'r'.repeat(900))).toHaveLength(500)
  })

  test('the action grammar is <module>.<object>.<verb> or pii.read', () => {
    for (const ok of ['finance.charge.void', 'pii.read', 'finance.money_log.review'])
      expect(() => assertActionShape(ok)).not.toThrow()
    for (const bad of [
      'Finance.charge.void',
      'finance',
      'finance.charge.',
      'finance-charge.void',
      'a.b.1',
    ])
      expect(() => assertActionShape(bad)).toThrow(MalformedAuditActionError)
  })
})
