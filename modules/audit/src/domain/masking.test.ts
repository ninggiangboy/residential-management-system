import { describe, expect, test } from 'bun:test'
import { MASKED } from '../contracts'
import { UnmaskedAuditFieldError } from './errors'
import { applyMasks, assertMasked, maskEmail, maskPhone } from './masking'

describe('masking (DOC-35 §3.4)', () => {
  test('AD-09 a deny-listed field with a plain value is refused; with the mask the row holds [masked]', () => {
    for (const field of [
      'secrets',
      'cccd',
      'dateOfBirth',
      'fullName',
      'note',
      'receivingAccount.apiKey',
    ]) {
      const plain = [{ field, before: 'old value', after: 'new value' }]
      expect(() => assertMasked(plain)).toThrow(UnmaskedAuditFieldError)
      expect(() => assertMasked([{ field, before: MASKED, after: MASKED }])).not.toThrow()
      // the first state of an object has no "before"
      expect(() => assertMasked([{ field, before: null, after: MASKED }])).not.toThrow()
    }
  })

  test('AD-09 a declared mask turns a plain value into [masked] before the check', () => {
    const changes = applyMasks([{ field: 'cccd', before: '079123456789', after: '079123456780' }], {
      cccd: 'personal',
    })
    expect(changes).toEqual([{ field: 'cccd', before: MASKED, after: MASKED }])
    expect(() => assertMasked(changes)).not.toThrow()
  })

  test('AD-09 a field that is not personal keeps its value', () => {
    const changes = [{ field: 'status', before: 'posted', after: 'void' }]
    expect(applyMasks(changes, { cccd: 'personal' })).toEqual(changes)
    expect(() => assertMasked(changes)).not.toThrow()
  })

  test('AD-10 a phone change is recorded as +84•••••567 → +84•••••999', () => {
    const [change] = applyMasks(
      [{ field: 'phone', before: '+84901234567', after: '+84907654999' }],
      {
        phone: 'phone',
      },
    )
    expect(change).toEqual({ field: 'phone', before: '+84•••••567', after: '+84•••••999' })
    expect(() => assertMasked([{ field: 'phone', before: '+84901234567', after: null }])).toThrow(
      UnmaskedAuditFieldError,
    )
  })

  test('AD-10 the country code is kept whatever its length, and the mask has a fixed length', () => {
    expect(maskPhone('+12025550101')).toBe('+1•••••101')
    expect(maskPhone('+442071838750')).toBe('+44•••••750')
    expect(maskPhone('+8869123456789')).toBe('+886•••••789')
    expect(maskPhone('028 3822 0000')).toBe('•••••000')
  })

  test('an email keeps its first character and its domain', () => {
    expect(maskEmail('le.nguyen@example.com')).toBe('l•••@example.com')
    expect(maskEmail('not an email')).toBe(MASKED)
    expect(() =>
      assertMasked([
        { field: 'email', before: 'le.nguyen@example.com', after: 'l•••@example.com' },
      ]),
    ).toThrow(UnmaskedAuditFieldError)
    expect(() =>
      assertMasked([{ field: 'email', before: 'l•••@example.com', after: null }]),
    ).not.toThrow()
  })
})
