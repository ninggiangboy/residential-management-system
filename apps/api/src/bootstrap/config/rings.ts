import { createPrivateKey } from 'node:crypto'
import { z } from 'zod'

/** DOC-41 §6 key rings: a JSON object `kid → value`. A ring is refused when it is empty, a value is malformed or a kid repeats. */

const RING_RULE = { rule: 4 } as const

/** Index just past the string that opens at `start` (a `"`), honouring `\\` escapes. */
function endOfString(text: string, start: number): number {
  let end = start + 1
  while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
  return end + 1
}

/** True when the string that ends at `end` is followed by `:` (a key, not a value). */
const isKey = (text: string, end: number) => /^\s*:/.test(text.slice(end))

/** The keys of the top-level object in the order written, repeats included (`JSON.parse` would silently drop them). */
function topLevelKeys(text: string): string[] | undefined {
  const keys: string[] = []
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      const end = endOfString(text, i)
      if (depth === 1 && isKey(text, end)) keys.push(JSON.parse(text.slice(i, end)) as string)
      i = end - 1
    } else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') depth--
  }
  return depth === 0 ? keys : undefined
}

const isBase64Of = (value: unknown, bytes: number) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
  Buffer.from(value, 'base64').length === bytes

const isEs256Pem = (value: unknown) => {
  if (typeof value !== 'string') return false
  try {
    const key = createPrivateKey(value)
    return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
  } catch {
    return false
  }
}

/** `{"k1": "<value>"}`; `valid` says what a value must be and `describe` names it in the message. */
function ring(valid: (value: unknown) => boolean, describe: string) {
  return z.string().transform((text, ctx): Record<string, string> => {
    const issue = (message: string) => {
      ctx.addIssue({ code: 'custom', message, params: RING_RULE })
      return z.NEVER
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return issue('must be one JSON object on one line')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
      return issue('must be a JSON object of kid to key')
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (entries.length === 0) return issue('must hold at least one key')
    const written = topLevelKeys(text) ?? []
    if (new Set(written).size !== written.length) return issue('a kid is repeated')
    if (!entries.every(([kid, value]) => kid !== '' && valid(value)))
      return issue(`every value must be ${describe}`)
    return parsed as Record<string, string>
  })
}

export const keyRing32 = () => ring((v) => isBase64Of(v, 32), 'base64 of exactly 32 bytes')
export const jwtRing = () => ring(isEs256Pem, 'an ES256 (P-256) private key in PEM')

/** The HMAC key of OTP and step-up codes: base64 of at least 32 bytes. */
export const hmacKey = () =>
  z
    .string()
    .refine((v) => /^[A-Za-z0-9+/]+={0,2}$/.test(v) && Buffer.from(v, 'base64').length >= 32, {
      message: 'must be base64 of at least 32 bytes',
      params: RING_RULE,
    })
