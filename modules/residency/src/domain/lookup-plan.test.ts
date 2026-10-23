import { describe, expect, test } from 'bun:test'
import { foldText, planLookup } from './lookup-plan'

/** The strategies of DOC-27 §11.1 and the thresholds of FR-18.5 (RM-33, RM-34). */
describe('planLookup', () => {
  test('a name runs from 3 folded characters and is found without diacritics', () => {
    expect(planLookup('nguyen').name).toBe('nguyen')
    expect(planLookup('Nguyễn Văn   An').q).toBe('Nguyễn Văn An')
    expect(planLookup('ng').name).toBeNull()
    expect(foldText('Đặng Văn Hùng')).toBe('dang van hung')
  })

  test('a phone runs from 4 digits after the leading 0 and ignores spaces, +, dots and dashes', () => {
    expect(planLookup('4567').phoneSuffix).toBe('4567')
    expect(planLookup('456').phoneSuffix).toBeNull()
    expect(planLookup('0901234567').phoneSuffix).toBe('901234567')
    expect(planLookup('+84 901.234-567').phoneSuffix).toBe('84901234567')
    expect(planLookup('0456').phoneSuffix).toBeNull()
    expect(planLookup('1234567890123456').phoneSuffix).toBeNull()
  })

  test('digits and separators never run the name strategy; letters never run the phone one', () => {
    expect(planLookup('0901234567').name).toBeNull()
    expect(planLookup('+84 901').name).toBeNull()
    expect(planLookup('an 4567').phoneSuffix).toBeNull()
  })

  test('a unit code runs from 2 characters, and "A-15" is also a name fragment', () => {
    expect(planLookup('A').unitCode).toBeNull()
    expect(planLookup('A-15')).toMatchObject({ unitCode: 'A-15', name: 'A-15', phoneSuffix: null })
  })
})
