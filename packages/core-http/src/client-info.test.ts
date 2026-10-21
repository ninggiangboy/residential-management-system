import { describe, expect, test } from 'bun:test'
import { bucketIp, createClientIp } from './client-info'

const request = (headers: Record<string, string> = {}) =>
  new Request('http://localhost/x', { headers })
const server = (address: string) => ({ requestIP: () => ({ address }) })

describe('clientIp (DOC-39 §5.3, SC-17)', () => {
  const warnings: unknown[] = []
  const clientIp = createClientIp({
    trustedProxyHops: 1,
    trustedProxyCidrs: ['172.18.0.0/16'],
    onFallback: (fields) => warnings.push(fields),
  })

  test('a trusted peer with CF-Connecting-IP gives that address', () => {
    const ip = clientIp(
      request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' }),
      server('172.18.0.5'),
    )
    expect(ip).toBe('203.0.113.7')
  })

  test('without it the right-most X-Forwarded-For entry is used, and a proxy address is logged as a fallback', () => {
    warnings.length = 0
    const ip = clientIp(
      request({ 'x-forwarded-for': '198.51.100.9, 172.18.0.2' }),
      server('172.18.0.5'),
    )
    expect(ip).toBe('172.18.0.2')
    expect(warnings).toHaveLength(1)
  })

  test('an untrusted peer is the answer and no header is read', () => {
    const ip = clientIp(request({ 'cf-connecting-ip': '203.0.113.7' }), server('198.51.100.50'))
    expect(ip).toBe('198.51.100.50')
  })

  test('an invalid CF-Connecting-IP falls through to X-Forwarded-For', () => {
    const ip = clientIp(
      request({ 'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.9' }),
      server('172.18.0.5'),
    )
    expect(ip).toBe('198.51.100.9')
  })

  test('an IPv6 client keeps its full address and its bucket key is the /64', () => {
    const address = '2001:db8:1:2:aaaa:bbbb:cccc:dddd'
    expect(clientIp(request({ 'cf-connecting-ip': address }), server('172.18.0.5'))).toBe(address)
    expect(bucketIp(address)).toBe('2001:db8:1:2::/64')
    expect(bucketIp('203.0.113.7')).toBe('203.0.113.7')
    expect(bucketIp('2001:db8::1')).toBe('2001:db8:0:0::/64')
  })

  test('no peer and an empty trusted list give the peer or unknown', () => {
    const direct = createClientIp({ trustedProxyHops: 0, trustedProxyCidrs: [] })
    expect(direct(request({ 'x-forwarded-for': '1.2.3.4' }), server('10.0.0.9'))).toBe('10.0.0.9')
    expect(direct(request(), null)).toBe('unknown')
  })
})
