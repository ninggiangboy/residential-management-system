/**
 * Content rules for the first 4,096 bytes of an object (DOC-37 §7). A magic check is a filter: it proves the file begins like
 * its type, not that the rest is sound or safe. There is no malware scan in phase 1.
 */
export const HEAD_BYTES = 4096

export type ContentVerdict = 'ok' | 'wrong_type' | 'bad_content'

const startsWith = (head: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, i) => head[offset + i] === byte)
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

const JPEG = [0xff, 0xd8, 0xff]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]

const SIGNATURES: Readonly<Record<string, (head: Uint8Array) => boolean>> = {
  'image/jpeg': (h) => startsWith(h, JPEG),
  'image/png': (h) => startsWith(h, PNG),
  'image/webp': (h) => startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8),
  'video/mp4': (h) => startsWith(h, ascii('ftyp'), 4),
  'video/quicktime': (h) => startsWith(h, ascii('ftyp'), 4),
  'application/pdf': (h) => startsWith(h, ascii('%PDF-')),
  // The inner type of an Office file is not checked here: a ZIP local header is enough for a filter.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (h) =>
    startsWith(h, ZIP_LOCAL_HEADER),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (h) =>
    startsWith(h, ZIP_LOCAL_HEADER),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': (h) =>
    startsWith(h, ZIP_LOCAL_HEADER),
}

/** UTF-8, a BOM allowed, no NUL byte. The last sequence of a 4 KB cut may be incomplete; that is not an error. */
function isCsvText(head: Uint8Array): boolean {
  if (head.includes(0)) return false
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let trim = 0; trim <= 3; trim++) {
    try {
      decoder.decode(head.subarray(0, head.length - trim))
      return true
    } catch {
      // the cut may fall inside a multi-byte character: try with up to three bytes less
    }
  }
  return false
}

/**
 * `ok`, `wrong_type` (the bytes do not begin like the type the client registered) or `bad_content` (a CSV that is not text).
 * A type the system generates (ZIP, exports) is not verified: the system wrote it (DOC-37 §7).
 */
export function checkContent(mime: string, head: Uint8Array): ContentVerdict {
  if (mime === 'text/csv') return isCsvText(head) ? 'ok' : 'bad_content'
  const signature = SIGNATURES[mime]
  if (!signature) return 'wrong_type'
  return signature(head) ? 'ok' : 'wrong_type'
}
