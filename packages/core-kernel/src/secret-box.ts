/**
 * AES-256-GCM envelope for the secrets kept in the database (DOC-36 §6, DR-33, DR-65, DR-126). One format for every use:
 * `v1:<keyId>:<iv>:<ciphertext+tag>`, each part base64url, a 12-byte random IV and a 128-bit tag. WebCrypto is a global of
 * Bun, so the file has no dependency.
 *
 * The additional authenticated data is not in the blob: the caller recomputes it from the place the blob lives, so a blob
 * copied to another row, or swapped between two accounts, fails to open.
 */

/** keyId → 32 bytes; ids match `^k[0-9]+$`. */
export type KeyRing = Readonly<Record<string, Uint8Array<ArrayBuffer>>>

export class SecretOpenError extends Error {
  constructor(reason: string) {
    super(`cannot open the secret: ${reason}`)
    this.name = 'SecretOpenError'
  }
}

const KEY_ID = /^k[0-9]+$/
const KEY_BYTES = 32
const IV_BYTES = 12

/** The blob a `seal` makes: the `CHECK` of `building.gateway_config.secrets_enc` pins the same shape (DOC-17 §1.3). */
export const SECRET_BLOB = /^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/

export interface SecretBox {
  /** Seals with the newest key. */
  seal(aad: string, plaintext: string): Promise<string>
  /** Opens with the key the blob names; throws `SecretOpenError` for an unknown key, a bad format or a failed tag. */
  open(aad: string, blob: string): Promise<string>
  keyIdOf(blob: string): string
}

/** The highest number wins (`k10` > `k9`), not the first in the file. Throws for an empty ring or a malformed id. */
export function newestKeyId(ring: KeyRing): string {
  const ids = Object.keys(ring)
  if (ids.length === 0 || !ids.every((id) => KEY_ID.test(id))) throw new Error('invalid key ring')
  const newest = ids.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).at(-1)
  if (newest === undefined) throw new Error('invalid key ring')
  return newest
}

function assertRing(ring: KeyRing): void {
  newestKeyId(ring)
  for (const [id, key] of Object.entries(ring))
    if (key.byteLength !== KEY_BYTES) throw new Error(`key ${id} is not ${KEY_BYTES} bytes`)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url')

const importKey = (raw: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt') =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage])

/** `iv` is a parameter only so a test can pin the vector of DOC-36 §6.2; production always draws a fresh one. */
export async function seal(
  ring: KeyRing,
  aad: string,
  plaintext: string,
  iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(IV_BYTES)),
): Promise<string> {
  const keyId = newestKeyId(ring)
  const key = await importKey(ring[keyId] as Uint8Array<ArrayBuffer>, 'encrypt')
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 },
      key,
      encoder.encode(plaintext),
    ),
  )
  return `v1:${keyId}:${b64(iv)}:${b64(ciphertext)}`
}

export function keyIdOf(blob: string): string {
  const [version, keyId, iv, ciphertext, ...rest] = blob.split(':')
  if (version !== 'v1' || !keyId || !iv || !ciphertext || rest.length > 0)
    throw new SecretOpenError('not a v1 blob')
  return keyId
}

export async function open(ring: KeyRing, aad: string, blob: string): Promise<string> {
  const [, , iv, ciphertext] = blob.split(':')
  const keyId = keyIdOf(blob)
  const raw = ring[keyId]
  if (!raw) throw new SecretOpenError(`key ${keyId} is not in the ring`)
  try {
    const key = await importKey(raw, 'decrypt')
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: Buffer.from(iv as string, 'base64url'),
        additionalData: encoder.encode(aad),
        tagLength: 128,
      },
      key,
      Buffer.from(ciphertext as string, 'base64url'),
    )
    return decoder.decode(plain)
  } catch {
    // The tag did not verify: a wrong key, a wrong AAD or a damaged blob. WebCrypto says nothing more, and neither do we.
    throw new SecretOpenError('the tag does not verify')
  }
}

/** The ring is read from the environment by the composition root (`SETTINGS_ENCRYPTION_KEYS`, `PII_ENCRYPTION_KEYS`). */
export function createSecretBox(ring: KeyRing): SecretBox {
  assertRing(ring)
  return {
    seal: (aad, plaintext) => seal(ring, aad, plaintext),
    open: (aad, blob) => open(ring, aad, blob),
    keyIdOf,
  }
}

/** A ring from the JSON of `SETTINGS_ENCRYPTION_KEYS`: `{"k1": "<base64 of 32 bytes>"}`. */
export function keyRingFromBase64(ring: Readonly<Record<string, string>>): KeyRing {
  const decoded = Object.fromEntries(
    Object.entries(ring).map(([id, value]) => [id, new Uint8Array(Buffer.from(value, 'base64'))]),
  )
  assertRing(decoded)
  return decoded
}
