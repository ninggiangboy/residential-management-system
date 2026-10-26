import { expect, test } from 'bun:test'
import { maskEmail } from './email-draft'

test('UISM-12: the masked form keeps two letters and the domain, never the whole address', () => {
  expect(maskEmail('tran.minh@mocmien.vn')).toBe('tr***@mocmien.vn')
  expect(maskEmail('a@mocmien.vn')).toBe('a***@mocmien.vn')
  expect(maskEmail('not an email')).toBe('not an email')
})
