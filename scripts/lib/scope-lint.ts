// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: an AST walk: each branch is one rule of DOC-12 §7.3
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Node, Ts } from './typescript-api'

/**
 * The building-scope lint (DOC-12 §7.3, DR-12): every query on a table that has a `building_id` carries the scope. It reads the
 * AST of the sources of `modules/*` with the TypeScript 6 API (`typescript-api.ts`).
 *
 *   predicate       A Drizzle query (`from`, `update`, `delete`, `insert`) or a raw `sql` template on a scoped table has no
 *                   `inBuilding(table, scope)` or `building_id` / `buildingId` in its `where` (an `insert`: in its values).
 *   scope-argument  A public method of a repository that touches a scoped table does not take `scope` first.
 *   registry        A table of a `schema.ts` with no `building_id` that is not on the allow-list of DOC-14 §5.3.
 *
 * A line `// scope-ok: <reason>` on the line of the query or the two before it exempts that query or method, and the reason is
 * the review: the one use is a lookup by primary key whose caller has authorised the row already (`FilesApi.signedUrl`).
 */

export interface Violation {
  file: string
  line: number
  rule: 'predicate' | 'scope-argument' | 'registry'
  message: string
}

export interface ScopedTable {
  /** The exported constant of the schema file, as the repositories use it. */
  variable: string
  /** `schema.table`, as raw SQL spells it. */
  qualified: string
}

/** Tables with no `building_id` by design (DOC-14 §5.3): the scope root, infrastructure, the outbox and inbox of every module. */
const ALLOWED_UNSCOPED: ReadonlyArray<RegExp> = [
  /^building\.building$/,
  /^building\.job_run$/,
  /^[a-z]+\.(outbox_messages|inbox)$/,
  /^identity\.(rate_bucket|otp_challenge|refresh_family|refresh_token|resident_account|password_token|staff_account)$/,
]

const EXEMPT = /scope-ok:/

function walk(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'migrations') continue
    if (statSync(path).isDirectory()) walk(path, accept, out)
    else if (accept(path)) out.push(path)
  }
  return out
}

const isSource = (path: string) => /\.ts$/.test(path) && !/\.(test|spec)\.ts$/.test(path)

function parse(ts: Ts, path: string): Node {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
}

function visit(ts: Ts, node: Node, callback: (node: Node) => void) {
  callback(node)
  ts.forEachChild(node, (child: Node) => visit(ts, child, callback))
}

const lineOf = (file: Node, node: Node) =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

/** True when one of the line of the node and the two before it carries `scope-ok:`. */
function exempt(file: Node, line: number): boolean {
  const lines = file.text.split('\n')
  return [line - 3, line - 2, line - 1].some((index) => EXEMPT.test(lines[index] ?? ''))
}

/** The tables of the schemas: which are scoped, and the registry violations. */
export function readSchemas(ts: Ts, root: string) {
  const scoped: ScopedTable[] = []
  const violations: Violation[] = []
  const files = walk(join(root, 'modules'), (p) =>
    p.endsWith('/infrastructure/persistence/schema.ts'),
  )
  for (const path of files) {
    const file = parse(ts, path)
    const schemas = new Map<string, string>()
    visit(ts, file, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const call = node.initializer
        if (ts.isIdentifier(call.expression) && call.expression.text === 'pgSchema') {
          const name = call.arguments[0]
          if (name && ts.isStringLiteral(name)) schemas.set(node.name.text, name.text)
        }
      }
    })
    visit(ts, file, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !node.initializer ||
        !ts.isCallExpression(node.initializer)
      )
        return
      const call = node.initializer
      const callee = call.expression
      if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'table') return
      if (!ts.isIdentifier(callee.expression)) return
      const schema = schemas.get(callee.expression.text)
      const [nameArg, columnsArg] = call.arguments
      if (!schema || !nameArg || !ts.isStringLiteral(nameArg) || !columnsArg) return
      const qualified = `${schema}.${nameArg.text}`
      const hasBuildingId =
        ts.isObjectLiteralExpression(columnsArg) &&
        columnsArg.properties.some((p: Node) => p.name && p.name.text === 'buildingId')
      if (hasBuildingId) scoped.push({ variable: node.name.text, qualified })
      else if (!ALLOWED_UNSCOPED.some((pattern) => pattern.test(qualified)))
        violations.push({
          file: relative(root, path),
          line: lineOf(file, node),
          rule: 'registry',
          message: `${qualified} has no building_id and is not on the allow-list of DOC-14 §5.3`,
        })
    })
  }
  return { scoped, violations }
}

/** The whole chain `db.select().from(t).where(...).limit(1)` that a call sits in, innermost to outermost. */
function chainOf(ts: Ts, node: Node): Node[] {
  const chain = [node]
  let current = node
  while (current.parent) {
    const parent = current.parent
    const continues =
      (ts.isPropertyAccessExpression(parent) && parent.expression === current) ||
      (ts.isCallExpression(parent) && parent.expression === current) ||
      (ts.isAwaitExpression(parent) && parent.expression === current)
    if (!continues) break
    chain.push(parent)
    current = parent
  }
  return chain
}

export function lintSources(ts: Ts, root: string, scoped: readonly ScopedTable[]): Violation[] {
  const violations: Violation[] = []
  const variables = new Set(scoped.map((t) => t.variable))
  const qualifiedNames = scoped.map((t) => t.qualified.replace('.', '\\.'))
  const rawPattern =
    qualifiedNames.length > 0 ? new RegExp(`\\b(${qualifiedNames.join('|')})\\b`) : null

  const files = walk(
    join(root, 'modules'),
    (p) => isSource(p) && p.includes('/src/') && !p.endsWith('/persistence/schema.ts'),
  )
  for (const path of files) {
    const file = parse(ts, path)
    const report = (node: Node, rule: Violation['rule'], message: string) => {
      const line = lineOf(file, node)
      if (!exempt(file, line)) violations.push({ file: relative(root, path), line, rule, message })
    }

    visit(ts, file, (node) => {
      // Drizzle: .from(t) .update(t) .delete(t) .insert(t)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const verb = node.expression.name.text
        const table = node.arguments[0]
        if (
          ['from', 'update', 'delete', 'insert'].includes(verb) &&
          table &&
          ts.isIdentifier(table) &&
          variables.has(table.text)
        ) {
          const chain = chainOf(ts, node)
          const calls = chain.filter(
            (n: Node) => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression),
          )
          const named = (name: string) => calls.filter((c: Node) => c.expression.name.text === name)
          if (verb === 'insert') {
            const values = named('values').concat(named('select'))
            if (!values.some((c: Node) => /buildingId|building_id/.test(c.getText(file))))
              report(
                node,
                'predicate',
                `insert into ${table.text} does not set buildingId from the scope`,
              )
          } else {
            const wheres = named('where')
            if (
              !wheres.some((c: Node) => /inBuilding\(|buildingId|building_id/.test(c.getText(file)))
            )
              report(
                node,
                'predicate',
                wheres.length === 0
                  ? `${verb}(${table.text}) has no .where(inBuilding(${table.text}, scope), …)`
                  : `the .where of ${verb}(${table.text}) has no inBuilding(${table.text}, scope) or buildingId`,
              )
          }
        }
      }
      // raw SQL: sql`... building.file_object ...` must name building_id
      if (
        rawPattern &&
        ts.isTaggedTemplateExpression(node) &&
        ts.isIdentifier(node.tag) &&
        node.tag.text === 'sql'
      ) {
        const text = node.template.getText(file)
        if (rawPattern.test(text) && !/building_id/.test(text))
          report(
            node,
            'predicate',
            'a raw SQL statement on a scoped table has no building_id predicate',
          )
      }
      // repository methods: scope first
      if (ts.isClassDeclaration(node) && node.name && /Repository$/.test(node.name.text)) {
        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member) || !member.body) continue
          const isPublic = !(member.modifiers ?? []).some((m: Node) =>
            [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword].includes(m.kind),
          )
          if (!isPublic) continue
          const body = member.body.getText(file)
          const touches =
            [...variables].some((v) => new RegExp(`\\b${v}\\b`).test(body)) ||
            (rawPattern?.test(body) ?? false)
          const first = member.parameters[0]
          if (touches && !(first && ts.isIdentifier(first.name) && first.name.text === 'scope'))
            report(
              member,
              'scope-argument',
              `${node.name.text}.${member.name.getText(file)} touches a scoped table and does not take scope first`,
            )
        }
      }
    })
  }
  return violations
}

export function lintScope(
  ts: Ts,
  root: string,
): { scoped: ScopedTable[]; violations: Violation[] } {
  const { scoped, violations: registry } = readSchemas(ts, root)
  return { scoped, violations: [...registry, ...lintSources(ts, root, scoped)] }
}
