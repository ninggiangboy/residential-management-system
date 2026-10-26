/**
 * A UUIDv4 for `X-Request-Id` and `Idempotency-Key` (DOC-55 §4.2, §4.3). Hermes may not offer `crypto.randomUUID`, so the
 * generator falls back to `getRandomValues` and then to `Math.random`: neither id is a secret, an idempotency key is scoped to
 * the account (DOC-50 §8).
 */
export function randomId(): string {
  const c = (globalThis as { crypto?: Partial<Crypto> }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}
