import { describe, expect, test } from 'bun:test'
import {
  createSecretBox,
  keyRingFromBase64,
  newestKeyId,
  open,
  SECRET_BLOB,
  SecretOpenError,
  seal,
} from './secret-box'

/** The test vector of DOC-36 §6.2, run on Bun 1.4.3 when the document was written. */
const ring = { k1: new Uint8Array(32).fill(1), k2: new Uint8Array(32).fill(2) }
const iv = new Uint8Array(12).fill(7)
const aad = 'gateway_config|018f0000-0000-7000-8000-0000000000a1'
const plaintext =
  '{"clientId":"demo-client","apiKey":"demo-api-key","checksumKey":"demo-checksum-key"}'
const vector =
  'v1:k2:BwcHBwcHBwcHBwcH:-nG-fAwhipB-QPsrdllv5VkkLDRXsSzy86nHwM5okkzm8gGMrFjIVOspdSoryRg6koGxezCN0JSB9Qfr5bNKDgORccUla_0s_I_OkgexH-LqjpyVqFOeOiIIJCGdnpMN7UQU7w'

describe('SecretBox (DOC-36 §6)', () => {
  test('BD-14 seal with the ring, IV and AAD of the vector gives the blob of §6.2, and it opens', async () => {
    const blob = await seal(ring, aad, plaintext, iv)
    expect(blob).toBe(vector)
    expect(SECRET_BLOB.test(blob)).toBe(true)
    expect(await open(ring, aad, vector)).toBe(plaintext)
  })

  test('BD-15 open with another AAD, or with a blob moved to another row id, fails', async () => {
    await expect(open(ring, 'gateway_config|another-row', vector)).rejects.toBeInstanceOf(
      SecretOpenError,
    )
    const moved = aad.replace('0000000000a1', '0000000000a2')
    await expect(open(ring, moved, vector)).rejects.toBeInstanceOf(SecretOpenError)
    const tampered = `${vector.slice(0, -2)}AA`
    await expect(open(ring, aad, tampered)).rejects.toBeInstanceOf(SecretOpenError)
  })

  test('BD-16 the newest key is the highest number: k10 over k9; a malformed id and an empty ring are errors', () => {
    const key = new Uint8Array(32)
    expect(newestKeyId({ k9: key, k10: key })).toBe('k10')
    expect(newestKeyId({ k10: key, k2: key, k1: key })).toBe('k10')
    expect(() => newestKeyId({ kA: key })).toThrow('invalid key ring')
    expect(() => newestKeyId({})).toThrow('invalid key ring')
  })

  test('BD-17 open with a ring that lacks the key the blob names throws SecretOpenError', async () => {
    const onlyK1 = { k1: ring.k1 }
    await expect(open(onlyK1, aad, vector)).rejects.toBeInstanceOf(SecretOpenError)
    await expect(open(ring, aad, 'v2:k1:aa:bb')).rejects.toBeInstanceOf(SecretOpenError)
    await expect(open(ring, aad, 'plain text')).rejects.toBeInstanceOf(SecretOpenError)
  })

  test('a box seals with the newest key and opens a blob of an older one', async () => {
    const old = createSecretBox({ k1: ring.k1 })
    const blob = await old.seal(aad, 'secret')
    expect(old.keyIdOf(blob)).toBe('k1')

    const rotated = createSecretBox(ring)
    expect(await rotated.open(aad, blob)).toBe('secret')
    expect(rotated.keyIdOf(await rotated.seal(aad, 'secret'))).toBe('k2')
  })

  test('two seals of one plaintext differ (a fresh IV each time)', async () => {
    const box = createSecretBox(ring)
    expect(await box.seal(aad, 'x')).not.toBe(await box.seal(aad, 'x'))
  })

  test('a ring needs 32-byte keys', () => {
    expect(() => createSecretBox({ k1: new Uint8Array(16) })).toThrow('k1 is not 32 bytes')
    expect(keyRingFromBase64({ k1: Buffer.alloc(32, 3).toString('base64') }).k1).toHaveLength(32)
    expect(() => keyRingFromBase64({ k1: Buffer.alloc(31).toString('base64') })).toThrow()
  })
})
