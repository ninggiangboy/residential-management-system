import { describe, expect, test } from 'bun:test'
import { passwordRules } from './password-rules'

describe('UIWO-15: the three rules of the reset form', () => {
  test('"abc12345" in both fields meets all three', () => {
    expect(passwordRules('abc12345', 'abc12345')).toEqual({ length: true, mix: true, match: true })
  })
  test.each([
    ['abcdefgh', 'abcdefgh', { length: true, mix: false, match: true }],
    ['12345678', '12345678', { length: true, mix: false, match: true }],
    ['abc1234', 'abc1234', { length: false, mix: true, match: true }],
    ['abc12345', 'abc12346', { length: true, mix: true, match: false }],
    ['', '', { length: false, mix: false, match: false }],
  ])('%s / %s', (password, confirm, expected) => {
    expect(passwordRules(password, confirm)).toEqual(expected)
  })
  test('a letter with a diacritic counts as a letter, and 129 characters are too long', () => {
    expect(passwordRules('Mậtkhẩu1', 'Mậtkhẩu1').mix).toBe(true)
    expect(passwordRules(`a1${'x'.repeat(127)}`, `a1${'x'.repeat(127)}`).length).toBe(false)
  })
})
