import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERROR_CODES, RULE_CODES } from '@rms/shared-types'
import { CATALOGS, SHARED_FAMILIES } from './catalog'

const keys = Object.keys(CATALOGS.en)
const entries = (prefix: string) =>
  (['vi', 'en'] as const).flatMap((lang) =>
    Object.entries(CATALOGS[lang])
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, text]) => ({ lang, key, text })),
  )

/** The codes of DOC-42 §5, parsed from the document as UICP-03 asks: the first cell of each table row of §5.1–§5.7. */
function documentedCodes(): string[] {
  const doc = readFileSync(
    join(import.meta.dir, '../../../docs/06-design/error-handling.md'),
    'utf8',
  )
  const section = doc.slice(doc.indexOf('## 5. The catalog'), doc.indexOf('## 6. '))
  return section
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .flatMap((line) => [...(line.split('|')[1] ?? '').matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!))
}

test('UICP-03: every code of DOC-42 §5 has error.<code>, and no error key lacks a code', () => {
  const codes = documentedCodes()
  expect(codes).toHaveLength(102)
  expect([...codes].sort()).toEqual([...ERROR_CODES, ...RULE_CODES].sort())
  const errorKeys = keys.filter((k) => k.startsWith('error.')).map((k) => k.slice('error.'.length))
  expect(errorKeys.sort()).toEqual([...codes].sort())
})

test('UICP-06: the shared catalog holds only the six shared families, each key once', () => {
  const families = new Set<string>(SHARED_FAMILIES)
  expect(keys.filter((k) => !families.has(k.split('.')[0]!))).toEqual([])
  expect(new Set(keys).size).toBe(keys.length)
})

test('UICP-09: residents read "Yêu cầu", staff read "Phiếu" (DR-197)', () => {
  const resident = entries('status.ticket-resident.').filter((e) => e.text.includes('Phiếu'))
  const staff = entries('status.ticket.').filter((e) => e.text.includes('Yêu cầu'))
  expect([...resident, ...staff]).toEqual([])
})

test('UICP-10: staff sign-in errors give no attempt counter (DR-128, DR-206)', () => {
  const texts = [...entries('error.invalid_credentials'), ...entries('error.account_locked')]
  const offending = texts.filter(
    (e) => /lần thử|tries left/i.test(e.text) || /\d/.test(e.text.replace(/\{[^}]*\}/g, '')),
  )
  expect(offending).toEqual([])
})

describe('UICP-13: error messages are short plain sentences', () => {
  const errors = entries('error.')
  test.each(errors)('$lang $key', ({ text }) => {
    expect(text.length).toBeLessThanOrEqual(140)
    expect(text.replace(/\{[^}]*\}/g, '')).not.toMatch(/[a-z]+_[a-z_]+/)
    expect(text).not.toMatch(/\bHTTP\b|\bAPI\b|\btoken\b|\bnull\b/)
    expect(text).toMatch(/[.)]$/)
  })
})
