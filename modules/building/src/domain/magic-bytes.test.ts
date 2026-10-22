import { describe, expect, test } from 'bun:test'
import { checkContent } from './magic-bytes'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => new TextEncoder().encode(text)
const padded = (head: Uint8Array, length = 64) => {
  const out = new Uint8Array(length)
  out.set(head)
  return out
}

describe('content rules (DOC-37 §7)', () => {
  test('FS-05 each type is recognised by its first bytes and by nothing else', () => {
    const samples: Array<[string, Uint8Array]> = [
      ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46)],
      ['image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d)],
      ['image/webp', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)],
      ['video/mp4', bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32)],
      ['video/quicktime', bytes(0, 0, 0, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20)],
      ['application/pdf', ascii('%PDF-1.7')],
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0),
      ],
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes(0x50, 0x4b, 0x03, 0x04),
      ],
      [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        bytes(0x50, 0x4b, 0x03, 0x04),
      ],
    ]
    for (const [mime, head] of samples) {
      expect(checkContent(mime, padded(head))).toBe('ok')
      for (const [other, otherHead] of samples)
        if (otherHead[0] !== head[0] && !(other.includes('openxml') && mime.includes('openxml')))
          expect(checkContent(mime, padded(otherHead))).toBe('wrong_type')
    }
  })

  test('FS-05 a .jpg that starts like a PNG, a text file and an empty head are wrong_type', () => {
    expect(checkContent('image/jpeg', padded(bytes(0x89, 0x50, 0x4e, 0x47)))).toBe('wrong_type')
    expect(checkContent('image/jpeg', ascii('just some text'))).toBe('wrong_type')
    expect(checkContent('image/png', new Uint8Array())).toBe('wrong_type')
    // RIFF without WEBP is a WAV or an AVI
    expect(
      checkContent('image/webp', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)),
    ).toBe('wrong_type')
  })

  test('FS-18 a CSV is UTF-8 without NUL; a BOM is allowed; a cut inside a multi-byte character is not an error', () => {
    expect(checkContent('text/csv', ascii('a,b\n1,2\n'))).toBe('ok')
    expect(
      checkContent('text/csv', new Uint8Array([0xef, 0xbb, 0xbf, ...ascii('Ngày,Nội dung\n')])),
    ).toBe('ok')
    expect(checkContent('text/csv', ascii('a,b\u0000\n'))).toBe('bad_content')
    expect(checkContent('text/csv', bytes(0xff, 0xfe, 0x61, 0x00))).toBe('bad_content')
    const cut = ascii('Nguyễn').slice(0, -1) // ends inside "ễ"
    expect(checkContent('text/csv', cut)).toBe('ok')
  })

  test('a type the system does not store has no rule', () => {
    expect(checkContent('application/zip', bytes(0x50, 0x4b, 0x03, 0x04))).toBe('wrong_type')
    expect(checkContent('image/gif', ascii('GIF89a'))).toBe('wrong_type')
  })
})
