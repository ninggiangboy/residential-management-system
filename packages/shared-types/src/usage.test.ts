import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isUsageName,
  USAGE_EXCLUDED_SCREENS,
  USAGE_NAME_MAX,
  USAGE_NAME_PATTERN,
  USAGE_SCREENS,
  USAGE_TARGETS,
} from './usage'

const docs = join(import.meta.dir, '../../../docs')
const read = (path: string) => readFileSync(join(docs, path), 'utf8')

/** The sections of DOC-56 with the "Role or member type" cell of the catalog rows (§3): `Id`, screen, role, phase, status. */
function catalog(): Array<{ id: string; role: string }> {
  const text = read('08-ux-ui/screens/README.md')
  const section = text.slice(text.indexOf('## 3. Catalog'), text.indexOf('## 4.'))
  const rows: Array<{ id: string; role: string }> = []
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim())
    const id = /^`([A-Za-z0-9-]+)`$/.exec(cells[1] ?? '')?.[1]
    if (id && cells.length >= 7) rows.push({ id, role: cells[3] ?? '' })
  }
  return rows
}

/** The targets of the table of DOC-104 §4.2.1. */
function listedTargets(): string[] {
  const text = read('06-design/usage-analytics.md')
  const section = text.slice(text.indexOf('#### 4.2.1'), text.indexOf('#### 4.2.2'))
  return section
    .split('\n')
    .map((line) => /^\| `([A-Za-z0-9-]+\.[a-z_]+)` \|/.exec(line)?.[1])
    .filter((target): target is string => Boolean(target))
}

describe('UA-15 the lists against the documents', () => {
  const sections = catalog()
  const ids = new Set(sections.map((section) => section.id))

  test('the catalog of DOC-56 was read', () => {
    expect(sections.length).toBeGreaterThan(100)
    expect(ids.has('Main')).toBe(true)
  })

  test('every screen of USAGE_SCREENS is a section of DOC-56 and none is excluded', () => {
    for (const screen of USAGE_SCREENS) expect(ids.has(screen), screen).toBe(true)
    for (const screen of USAGE_SCREENS)
      expect(USAGE_EXCLUDED_SCREENS as readonly string[], screen).not.toContain(screen)
  })

  test('USAGE_EXCLUDED_SCREENS is the signed-out sections of phase 1, Terms and Terms-Update, and Unit-Pick', () => {
    const signedOut = sections
      .filter((section) => /signed out|link holder/i.test(section.role))
      .map((section) => section.id)
    expect([...(USAGE_EXCLUDED_SCREENS as readonly string[])].sort()).toEqual(
      [...new Set([...signedOut, 'Terms', 'Terms-Update', 'Unit-Pick'])].sort(),
    )
  })

  test('USAGE_TARGETS are the rows of DOC-104 §4.2.1, and the screen of each target is in USAGE_SCREENS', () => {
    expect([...(USAGE_TARGETS as readonly string[])].sort()).toEqual(listedTargets().sort())
    for (const target of USAGE_TARGETS)
      expect(USAGE_SCREENS as readonly string[], target).toContain(target.split('.')[0] ?? '')
  })

  test('every name of the lists satisfies the grammar of a name (DOC-104 §4.3)', () => {
    for (const name of [...USAGE_SCREENS, ...USAGE_TARGETS]) {
      expect(name, name).toMatch(USAGE_NAME_PATTERN)
      expect(name.length).toBeLessThanOrEqual(USAGE_NAME_MAX)
    }
  })
})

describe('isUsageName', () => {
  test('a name is checked against the list of its event', () => {
    expect(isUsageName('screen_view', 'Main')).toBe(true)
    expect(isUsageName('screen_view', 'Account.language')).toBe(false)
    expect(isUsageName('tap', 'Account.language')).toBe(true)
    expect(isUsageName('tap', 'Main')).toBe(false)
    expect(isUsageName('app_open', 'Launch')).toBe(true)
    expect(isUsageName('app_open', 'Background')).toBe(false)
    expect(isUsageName('app_close', 'Background')).toBe(true)
    expect(isUsageName('app_close', 'Resume')).toBe(false)
  })
})
