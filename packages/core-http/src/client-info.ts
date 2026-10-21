import { BlockList, isIP } from 'node:net'

interface IpResolver {
  requestIP(request: Request): { address: string } | null
}

export interface ClientIpOptions {
  /** The entry of `X-Forwarded-For` counted from the right (1 = the right-most). */
  trustedProxyHops: number
  /** Peers whose forwarding headers are believed (CIDR ranges, DOC-41 `TRUSTED_PROXY_CIDRS`). */
  trustedProxyCidrs: readonly string[]
  /** Called when the answer is the address of a proxy itself: a deployment that reaches this branch is misconfigured. */
  onFallback?: (fields: { peer: string; forwardedFor: string }) => void
}

const strip = (address: string) => address.replace(/^::ffff:/i, '')

function cidrList(cidrs: readonly string[]): BlockList {
  const list = new BlockList()
  for (const cidr of cidrs) {
    const [address, prefix] = cidr.split('/')
    if (!address || prefix === undefined) continue
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4'
    list.addSubnet(address, Number(prefix), family)
  }
  return list
}

/**
 * The one function every IP bucket, audit row and log line uses (DOC-39 §5.3, DR-152): the peer unless it is a trusted
 * proxy; then `CF-Connecting-IP`, then the `X-Forwarded-For` entry `trustedProxyHops` from the right, then the peer.
 */
export function createClientIp(options: ClientIpOptions) {
  const trusted = cidrList(options.trustedProxyCidrs)
  const isTrusted = (address: string) => {
    const family = isIP(address)
    return family !== 0 && trusted.check(address, family === 6 ? 'ipv6' : 'ipv4')
  }

  return (request: Request, server: IpResolver | null): string => {
    const peer = strip(server?.requestIP(request)?.address ?? '')
    if (!peer) return 'unknown'
    if (!isTrusted(peer)) return peer

    const cloudflare = request.headers.get('cf-connecting-ip')?.trim()
    if (cloudflare && isIP(cloudflare) !== 0) return cloudflare

    const forwardedFor = request.headers.get('x-forwarded-for') ?? ''
    const entries = forwardedFor
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
    const entry = entries[entries.length - options.trustedProxyHops]
    if (entry && isIP(entry) !== 0) {
      if (isTrusted(entry)) options.onFallback?.({ peer, forwardedFor })
      return entry
    }
    return peer
  }
}

/** The key of an IP bucket: an IPv6 address is reduced to its `/64` (one person can use millions of them). */
export function bucketIp(address: string): string {
  if (isIP(address) !== 6) return address
  const groups = expandIpv6(address)
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`
}

function expandIpv6(address: string): number[] {
  const [head = '', tail = ''] = address.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = address.includes('::') ? 8 - left.length - right.length : 0
  return [...left, ...Array<string>(missing).fill('0'), ...right].map((g) =>
    Number.parseInt(g || '0', 16),
  )
}

export function userAgent(request: Request): string | null {
  return request.headers.get('user-agent')?.slice(0, 255) ?? null
}
