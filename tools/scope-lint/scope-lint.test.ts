import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { lintScope } from '../../scripts/lib/scope-lint'
import { loadTypeScript } from '../../scripts/lib/typescript-api'

/**
 * Negative fixtures for `check:scope` (DOC-12 §7.3): one tree that passes and one tree per rule that fails, each as source
 * text written to a temporary directory. The lint must name the rule and the line.
 */

const ts = loadTypeScript()
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

const SCHEMA = `
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core'
const demo = pgSchema('demo')
export const charge = demo.table('charge', { id: uuid('id'), buildingId: uuid('building_id'), name: text('name') })
export const setting = demo.table('setting', { id: uuid('id'), buildingId: uuid('building_id') })
export const outboxMessages = demo.table('outbox_messages', { id: uuid('id') })
`

/** A module `demo` with the schema above and the given repository source. */
function tree(repository: string, schema = SCHEMA): string {
  const root = mkdtempSync(join(tmpdir(), 'scope-lint-'))
  dirs.push(root)
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  write('modules/demo/src/infrastructure/persistence/schema.ts', schema)
  write('modules/demo/src/infrastructure/persistence/charge-repository.ts', repository)
  return root
}

const lint = (repository: string, schema?: string) =>
  lintScope(ts, tree(repository, schema)).violations

const GOOD = `
import { inBuilding } from '@core/db'
import { and, eq, sql } from 'drizzle-orm'
import { charge } from './schema'
export class ChargeRepository {
  constructor(private db: any) {}
  find(scope: any, id: string) {
    return this.db.executor.select().from(charge).where(and(inBuilding(charge, scope), eq(charge.id, id)))
  }
  rename(scope: any, id: string, name: string) {
    return this.db.executor.update(charge).set({ name }).where(and(inBuilding(charge, scope), eq(charge.id, id))).returning()
  }
  remove(scope: any, id: string) {
    return this.db.executor.delete(charge).where(and(eq(charge.buildingId, scope.buildingId), eq(charge.id, id)))
  }
  add(scope: any, id: string) {
    return this.db.executor.insert(charge).values({ id, buildingId: scope.buildingId })
  }
  raw(scope: any) {
    return this.db.executor.execute(sql\`SELECT id FROM demo.charge WHERE building_id = \${scope.buildingId}\`)
  }
  private helper() {
    return this.db.executor.select().from(charge).where(inBuilding(charge, { buildingId: 'x' }))
  }
}
`

describe('check:scope', () => {
  test('a repository that scopes every query passes, and the scoped tables are read from the schema', () => {
    const root = tree(GOOD)
    const { scoped, violations } = lintScope(ts, root)
    expect(violations).toEqual([])
    expect(scoped.map((t) => t.qualified).sort()).toEqual(['demo.charge', 'demo.setting'])
  })

  test('predicate: a query with no where is refused, with its line', () => {
    const [v, ...rest] = lint(`
import { charge } from './schema'
export class ChargeRepository {
  list(scope: any) {
    return this.db.executor.select().from(charge)
  }
}`)
    expect(rest).toEqual([])
    expect(v).toMatchObject({ rule: 'predicate', line: 5 })
    expect(v?.file).toBe('modules/demo/src/infrastructure/persistence/charge-repository.ts')
  })

  test('predicate: a where with no scope is refused for select, update and delete', () => {
    const violations = lint(`
import { eq } from 'drizzle-orm'
import { charge } from './schema'
export class ChargeRepository {
  a(scope: any, id: string) { return this.db.executor.select().from(charge).where(eq(charge.id, id)) }
  b(scope: any, id: string) { return this.db.executor.update(charge).set({}).where(eq(charge.id, id)) }
  c(scope: any, id: string) { return this.db.executor.delete(charge).where(eq(charge.id, id)) }
}`)
    expect(violations.map((v) => [v.rule, v.line])).toEqual([
      ['predicate', 5],
      ['predicate', 6],
      ['predicate', 7],
    ])
  })

  test('predicate: an insert that does not set buildingId is refused', () => {
    const violations = lint(`
import { charge } from './schema'
export class ChargeRepository {
  add(scope: any, id: string) { return this.db.executor.insert(charge).values({ id }) }
}`)
    expect(violations.map((v) => v.rule)).toEqual(['predicate'])
  })

  test('predicate: a raw SQL statement on a scoped table without building_id is refused', () => {
    const violations = lint(`
import { sql } from 'drizzle-orm'
export class ChargeRepository {
  raw(scope: any) { return this.db.executor.execute(sql\`DELETE FROM demo.charge WHERE id = \${scope.id}\`) }
  ok(scope: any) { return this.db.executor.execute(sql\`SELECT 1 FROM demo.outbox_messages\`) }
}`)
    expect(violations.map((v) => [v.rule, v.line])).toEqual([['predicate', 4]])
  })

  test('scope-argument: a public method that touches a scoped table must take scope first; a private one need not', () => {
    const violations = lint(`
import { inBuilding } from '@core/db'
import { charge } from './schema'
export class ChargeRepository {
  byId(id: string, scope: any) { return this.db.executor.select().from(charge).where(inBuilding(charge, scope)) }
  private byIdPrivate(id: string, scope: any) { return this.db.executor.select().from(charge).where(inBuilding(charge, scope)) }
  untouched(id: string) { return id }
}`)
    expect(violations.map((v) => [v.rule, v.line])).toEqual([['scope-argument', 5]])
  })

  test('registry: a table with no building_id must be on the allow-list', () => {
    const violations = lint(
      GOOD,
      `${SCHEMA}\nexport const note = demo.table('note', { id: uuid('id'), body: text('body') })\n`,
    )
    expect(violations.map((v) => [v.rule, v.message])).toEqual([
      ['registry', 'demo.note has no building_id and is not on the allow-list of DOC-14 §5.3'],
    ])
  })

  test('scope-ok: a reviewed exception on the lines before the query or the method is accepted', () => {
    const violations = lint(`
import { eq } from 'drizzle-orm'
import { charge } from './schema'
export class ChargeRepository {
  // scope-ok: the caller authorised the row
  byId(id: string) {
    // scope-ok: lookup by primary key
    return this.db.executor.select().from(charge).where(eq(charge.id, id))
  }
}`)
    expect(violations).toEqual([])
  })
})
