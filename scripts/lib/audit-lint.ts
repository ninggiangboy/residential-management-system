// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: an AST walk and a line scanner: each branch is one rule of DOC-35 §3.3
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Node, Ts } from './typescript-api'

/**
 * `check:audit` (DOC-35 §3.3, AD-06): every `audited({ action })` spec and every `record({ action })` call in `modules/*` names
 * an action that its module declared in `manifest.ts` (`auditActions`), and every declared action is in the catalog of DOC-35 §4.
 * A new action therefore enters the code, the manifest and the document in one change.
 */

export interface AuditViolation {
  file: string
  line: number
  message: string
}

const ACTION = /^[a-z_]+(\.[a-z_]+)+$/

/** The actions of DOC-35 §4: every backticked `module.object.verb`, and a `.verb` that continues the previous one (`· \`.update\``). */
export function readCatalog(markdown: string): Set<string> {
  const start = markdown.search(/^## 4\. /m)
  const end = markdown.search(/^## 5\. /m)
  const section = markdown.slice(start, end === -1 ? undefined : end)
  const actions = new Set<string>()
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    let stem = ''
    for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
      if (!token) continue
      if (ACTION.test(token)) {
        actions.add(token)
        stem = token.split('.').slice(0, -1).join('.')
      } else if (/^\.[a-z_]+$/.test(token) && stem) actions.add(`${stem}${token}`)
    }
  }
  return actions
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'migrations' || name === 'test') continue
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.ts$/.test(path) && !/\.(test|spec)\.ts$/.test(path)) out.push(path)
  }
  return out
}

function visit(ts: Ts, node: Node, callback: (node: Node) => void) {
  callback(node)
  ts.forEachChild(node, (child: Node) => visit(ts, child, callback))
}

/** `auditActions: ['a.b.c', …]` of a module's `manifest.ts`. */
function declaredBy(ts: Ts, path: string): string[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const actions: string[] = []
  visit(ts, file, (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'auditActions') {
      let value = node.initializer
      if (ts.isAsExpression(value)) value = value.expression
      if (ts.isArrayLiteralExpression(value))
        for (const element of value.elements)
          if (ts.isStringLiteralLike(element)) actions.push(element.text)
    }
  })
  return actions
}

export function lintAudit(
  ts: Ts,
  root: string,
  catalog: ReadonlySet<string>,
): { declared: number; used: number; violations: AuditViolation[] } {
  const violations: AuditViolation[] = []
  const modulesDir = join(root, 'modules')
  const declared = new Map<string, Set<string>>()
  let usedCount = 0

  for (const module of readdirSync(modulesDir)) {
    const manifest = join(modulesDir, module, 'src/manifest.ts')
    try {
      statSync(manifest)
    } catch {
      continue
    }
    const actions = declaredBy(ts, manifest)
    declared.set(module, new Set(actions))
    for (const action of actions)
      if (!catalog.has(action))
        violations.push({
          file: relative(root, manifest),
          line: 1,
          message: `${action} is declared but is not in the catalog of DOC-35 §4`,
        })
  }

  for (const [module] of declared) {
    for (const path of walk(join(modulesDir, module, 'src'))) {
      // The wrapper passes `spec.action` on: it is the one place where the action is a variable by design.
      if (module === 'audit' && path.endsWith('/application/audited.ts')) continue
      const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      )
      visit(ts, file, (node) => {
        if (!ts.isCallExpression(node)) return
        const callee = node.expression
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : ''
        if (name !== 'audited' && name !== 'record') return
        const spec = node.arguments[0]
        if (!spec || !ts.isObjectLiteralExpression(spec)) return
        const property = spec.properties.find(
          (p: Node) => ts.isPropertyAssignment(p) && p.name.getText(file) === 'action',
        )
        if (!property) return
        const line = file.getLineAndCharacterOfPosition(property.getStart(file)).line + 1
        const where = relative(root, path)
        const value = property.initializer
        if (!ts.isStringLiteralLike(value)) {
          violations.push({
            file: where,
            line,
            message: 'the action must be a string literal, so that it can be checked',
          })
          return
        }
        usedCount++
        const action = value.text
        if (action === 'pii.read') return
        if (action.split('.')[0] !== module)
          violations.push({
            file: where,
            line,
            message: `${action} is written by module ${module}: the module is the writer of the object (DOC-35 §3.3)`,
          })
        else if (!declared.get(module)?.has(action))
          violations.push({
            file: where,
            line,
            message: `${action} is not declared in auditActions of modules/${module}/src/manifest.ts`,
          })
      })
    }
  }
  return {
    declared: [...declared.values()].reduce((n, set) => n + set.size, 0),
    used: usedCount,
    violations,
  }
}
