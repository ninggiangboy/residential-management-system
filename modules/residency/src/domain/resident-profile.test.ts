import { describe, expect, test } from 'bun:test'
import { ValidationError } from '@core/kernel'
import {
  assertBirthDate,
  cccdAad,
  normalizeCccd,
  ResidentProfile,
  type ResidentProfileRecord,
} from './resident-profile'

const profile = (over: Partial<ResidentProfileRecord> = {}) =>
  new ResidentProfile({
    buildingId: 'b1',
    accountId: 'a1',
    fullName: 'Nguyễn Văn An',
    email: null,
    cccdEnc: null,
    cccdLast4: null,
    dateOfBirth: null,
    note: null,
    clearedAt: null,
    version: 2,
    ...over,
  })

const TODAY = '2026-10-20'

describe('the ID number', () => {
  test('RM-38 12 digits (CCCD) and 9 (CMND) pass with the spaces removed; anything else is a format error', () => {
    expect(normalizeCccd('079 085 012 345')).toBe('079085012345')
    expect(normalizeCccd('123456789')).toBe('123456789')
    for (const bad of ['12a4', '12345678901', '1234567890123', '', '12345678'])
      expect(() => normalizeCccd(bad)).toThrow(ValidationError)
  })

  test('the AAD binds the blob to its building and account (DOC-36 §6.2)', () => {
    expect(cccdAad('b1', 'a1')).toBe('cccd|b1|a1')
  })
})

describe('the date of birth', () => {
  test('a real date from 1900-01-01 up to today', () => {
    expect(() => assertBirthDate('1985-04-03', TODAY)).not.toThrow()
    expect(() => assertBirthDate('1900-01-01', TODAY)).not.toThrow()
    expect(() => assertBirthDate(TODAY, TODAY)).not.toThrow()
    for (const bad of ['1899-12-31', '2026-10-21', '1985-02-30', '85-04-03', 'x'])
      expect(() => assertBirthDate(bad, TODAY)).toThrow(ValidationError)
  })
})

describe('ResidentProfile.edit', () => {
  test('a field that is absent is kept and null clears it; the version moves by one on the version read', () => {
    const transition = profile({ email: 'old@example.com', note: 'x' }).edit(
      { email: null, note: 'new' },
      undefined,
      TODAY,
    )
    expect(transition).toEqual({
      id: 'a1',
      expect: { version: 2 },
      set: { email: null, note: 'new', version: 3 },
    })
  })

  test('the two columns of the number change together, and clearing clears both', () => {
    const sealed = { cccdEnc: 'v1:k1:iv:ct', cccdLast4: '2345' }
    expect(profile().edit({ cccd: '079085012345' }, sealed, TODAY)?.set).toMatchObject(sealed)
    expect(
      profile({ cccdEnc: 'v1:k1:iv:ct', cccdLast4: '2345' }).edit({ cccd: null }, null, TODAY)?.set,
    ).toMatchObject({ cccdEnc: null, cccdLast4: null })
  })

  test('an edit that changes nothing is not a transition', () => {
    expect(profile().edit({ fullName: 'Nguyễn Văn An' }, undefined, TODAY)).toBeNull()
  })

  test('a name is required and an email must look like one', () => {
    expect(() => profile().edit({ fullName: '  ' }, undefined, TODAY)).toThrow(ValidationError)
    expect(() => profile().edit({ email: 'nope' }, undefined, TODAY)).toThrow(ValidationError)
  })
})
