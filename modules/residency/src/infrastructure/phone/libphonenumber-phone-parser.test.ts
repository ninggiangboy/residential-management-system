import { describe, expect, test } from 'bun:test'
import { parsePhoneNumberFromString as parseMax } from 'libphonenumber-js/max'
import { parsePhoneNumberFromString as parseMin } from 'libphonenumber-js/min'
import { LibphonenumberPhoneParser } from './libphonenumber-phone-parser'

describe('IM-14 the metadata decides (DR-114)', () => {
  test('0123456789 is valid with min and not with max; the parser uses max', () => {
    expect(parseMin('0123456789', 'VN')?.isValid()).toBe(true)
    expect(parseMax('0123456789', 'VN')?.isValid()).toBe(false)
    expect(new LibphonenumberPhoneParser().parse('0123456789')).toBeNull()
  })

  test('a landline is told apart from a mobile number', () => {
    const parser = new LibphonenumberPhoneParser()
    expect(parser.parse('0901234567')).toEqual({ e164: '+84901234567', landline: false })
    expect(parser.parse('02838251234')).toEqual({ e164: '+842838251234', landline: true })
  })
})
