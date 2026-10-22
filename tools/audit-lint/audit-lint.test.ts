import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { lintAudit, readCatalog } from '../../scripts/lib/audit-lint'
import { loadTypeScript } from '../../scripts/lib/typescript-api'

/** AD-06: `check:audit` over small trees, and the catalog of DOC-35 §4 as it is written. */

const ts = loadTypeScript()
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const catalog = readCatalog(
  readFileSync(new URL('../../docs/06-design/audit-privacy-and-terms.md', import.meta.url), 'utf8'),
)

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'audit-lint-'))
  dirs.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

const manifest = (...actions: string[]) =>
  `export const m = { name: 'demo', auditActions: [${actions.map((a) => `'${a}'`).join(', ')}] } as const`

describe('check:audit', () => {
  test('the catalog of DOC-35 §4 is read with its grouped verbs', () => {
    for (const action of [
      'finance.payment.void',
      'finance.statement.dismiss',
      'residency.membership.unlock',
      'identity.staff.force_lock',
      'building.terms.publish',
      'tickets.ticket.force_assign',
      'wiki.page.restore',
      'pii.read',
    ])
      expect(catalog.has(action)).toBe(true)
    expect(catalog.has('finance.payment.destroy')).toBe(false)
    expect(catalog.size).toBeGreaterThan(60)
  })

  test('an action that is declared, in the catalog and written by its module passes', () => {
    const root = tree({
      'modules/finance/src/manifest.ts': manifest('finance.payment.void'),
      'modules/finance/src/application/void.ts': `
        export const voidPayment = audited({ action: 'finance.payment.void', object: () => ({}) }, async () => ({}))
        export const post = (audit) => audit.record({ actor: 1, action: 'pii.read', object: {} })`,
    })
    const result = lintAudit(ts, root, catalog)
    expect(result.violations).toEqual([])
    expect(result.used).toBe(2)
  })

  test('AD-06 an action that the module did not declare is refused with its line', () => {
    const root = tree({
      'modules/finance/src/manifest.ts': manifest('finance.payment.void'),
      'modules/finance/src/application/x.ts': `
        export const a = audited({ action: 'finance.payment.void' }, async () => ({}))
        export const b = audited({ action: 'finance.payment.post' }, async () => ({}))`,
    })
    const [v, ...rest] = lintAudit(ts, root, catalog).violations
    expect(rest).toEqual([])
    expect(v).toMatchObject({ line: 3, file: 'modules/finance/src/application/x.ts' })
    expect(v?.message).toContain('finance.payment.post is not declared')
  })

  test('AD-06 a module writes the actions of its own objects only', () => {
    const root = tree({
      'modules/building/src/manifest.ts': manifest(),
      'modules/building/src/application/x.ts': `export const a = (audit) => audit.record({ action: 'finance.payment.void' })`,
    })
    expect(lintAudit(ts, root, catalog).violations.map((v) => v.message)).toEqual([
      expect.stringContaining('finance.payment.void is written by module building'),
    ])
  })

  test('AD-06 a declared action must be in the catalog, and an action must be a string literal', () => {
    const root = tree({
      'modules/finance/src/manifest.ts': manifest('finance.payment.destroy'),
      'modules/finance/src/application/x.ts': `
        const name = 'finance.payment.void'
        export const a = audited({ action: name }, async () => ({}))`,
    })
    expect(lintAudit(ts, root, catalog).violations.map((v) => v.message)).toEqual([
      expect.stringContaining('finance.payment.destroy is declared but is not in the catalog'),
      expect.stringContaining('must be a string literal'),
    ])
  })

  test('tests are not scanned', () => {
    const root = tree({
      'modules/finance/src/manifest.ts': manifest(),
      'modules/finance/src/x.test.ts': `audited({ action: 'finance.nothing.here' })`,
      'modules/finance/test/y.ts': `audited({ action: 'finance.nothing.here' })`,
    })
    expect(lintAudit(ts, root, catalog).violations).toEqual([])
  })
})
