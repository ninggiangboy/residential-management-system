import { describe, expect, test } from 'bun:test'
import { LibphonenumberPhones } from './libphonenumber-phones'

const phones = new LibphonenumberPhones()

describe('LibphonenumberPhones (DR-36, DR-114)', () => {
  test.each([
    ['0901234567', '+84901234567'],
    ['+84 901 234 567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['+1 650 253 0000', '+16502530000'],
  ])('%s is stored as %s', (input, stored) => {
    expect(phones.toE164(input)).toBe(stored)
  })

  test.each(['0123456789', '12345', 'abc', '', '+84 90'])('%p is not a valid number', (input) => {
    expect(phones.toE164(input)).toBeNull()
  })
})
