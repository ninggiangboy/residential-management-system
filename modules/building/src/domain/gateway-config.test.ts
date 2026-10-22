import { describe, expect, test } from 'bun:test'
import { maskAccountNumber, maskSecret } from './gateway-config'

describe('what the gateway view and its audit row show (DOC-36 §7.1, DOC-35 §3.4)', () => {
  test('BD-18 a secret is dots plus its last 4 characters; one shorter than 8 characters shows only dots', () => {
    expect(maskSecret('api-key-abcdef123456')).toBe('••••3456')
    expect(maskSecret('12345678')).toBe('••••5678')
    expect(maskSecret('1234567')).toBe('••••')
    expect(maskSecret('')).toBe('••••')
  })

  test('an account number keeps its first and last 4 digits; a short one only its last 4', () => {
    expect(maskAccountNumber('0011001234567')).toBe('0011…4567')
    expect(maskAccountNumber('1234567890')).toBe('1234…7890')
    expect(maskAccountNumber('123456789')).toBe('…6789')
    expect(maskAccountNumber('123456')).toBe('…3456')
  })
})
