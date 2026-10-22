// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: an AST walk: each branch is one rule of DOC-12 §4.5
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Node, Ts } from './typescript-api'

/**
 * `check:layout` (DOC-12 §4.5, §6.4, DR-254): the shape of a module that the import rules cannot see. It reads the AST of the
 * sources of `modules/*` with the TypeScript 6 API (`typescript-api.ts`).
 *
 *   use-case-shape       A file of `application/use-cases/` has not exactly one exported class with exactly one public
 *                        method, `execute`, and a file name that is the kebab case of the class.
 *   handler-shape        A file of `application/handlers/` has not exactly one exported class that implements
 *                        `IntegrationEventHandler`.
 *   repository-location  An interface named `*Repository` is declared outside `domain/`.
 *   no-service-class     A class named `*Service` or `*Manager` in `application/`.
 *   execute-location     A class in `application/` outside `use-cases/` has a method named `execute`.
 *   query-placement      A read is a use case: a file of `application/use-cases/` named `get-`, `list-`, `view-`, `find-`,
 *                        `search-` or `count-`, or a file of `application/queries/` that is not `<name>-queries.ts`, or a file
 *                        of `application/api/` that is not `<name>-api-impl.ts`. Reads go in a query service
 *                        (`<Name>Queries`, several methods); only commands are use cases.
 *   module-files         A module has no `<name>.module.ts` or no `install.ts`.
 *   role-gate            `execute` of a use case, or a public method of a query service, takes a `StaffContext` first and
 *                        never calls `requireRole` (DOC-12 §5.3, §14 item 3). A method open to every role says so with
 *                        `requireRole(staff, STAFF_ROLES)`.
 */

export interface LayoutViolation {
  file: string
  line: number
  rule:
    | 'use-case-shape'
    | 'handler-shape'
    | 'repository-location'
    | 'no-service-class'
    | 'execute-location'
    | 'query-placement'
    | 'module-files'
    | 'role-gate'
  message: string
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'migrations') continue
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.ts$/.test(path) && !/\.(test|spec)\.ts$/.test(path)) out.push(path)
  }
  return out
}

const QUERY_PREFIX = /^(get|list|view|find|search|count)-/

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

function visit(ts: Ts, node: Node, callback: (node: Node) => void) {
  callback(node)
  ts.forEachChild(node, (child: Node) => visit(ts, child, callback))
}

function classesOf(ts: Ts, file: Node): Node[] {
  const classes: Node[] = []
  visit(ts, file, (node) => {
    if (ts.isClassDeclaration(node) && node.name) classes.push(node)
  })
  return classes
}

const isExported = (ts: Ts, node: Node) =>
  (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0

/** Public instance methods by name: no `private`, `protected`, `static` or `#name`. */
function publicMethods(ts: Ts, cls: Node): string[] {
  const out: string[] = []
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue
    const flags = ts.getCombinedModifierFlags(member)
    const hidden = ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static
    if ((flags & hidden) === 0) out.push(member.name.text)
  }
  return out
}

const hasMethod = (ts: Ts, cls: Node, name: string) =>
  cls.members.some(
    (m: Node) => ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.name.text === name,
  )

const implementsInterface = (ts: Ts, cls: Node, name: string) =>
  (cls.heritageClauses ?? []).some(
    (clause: Node) =>
      clause.token === ts.SyntaxKind.ImplementsKeyword &&
      clause.types.some((t: Node) => t.expression.getText().split('.').at(-1) === name),
  )

/** The method takes a `StaffContext` as its first parameter. */
const takesStaff = (method: Node) => {
  const type = method.parameters[0]?.type
  return type !== undefined && type.getText() === 'StaffContext'
}

const callsRequireRole = (ts: Ts, method: Node) => {
  let found = false
  if (method.body)
    visit(ts, method.body, (node) => {
      if (ts.isCallExpression(node) && node.expression.getText() === 'requireRole') found = true
    })
  return found
}

export function lintLayout(ts: Ts, root: string): LayoutViolation[] {
  const violations: LayoutViolation[] = []
  const modulesDir = join(root, 'modules')
  if (!existsSync(modulesDir)) return violations

  for (const name of readdirSync(modulesDir)) {
    const src = join(modulesDir, name, 'src')
    if (!existsSync(src)) continue
    const rel = (path: string) => relative(root, path)
    for (const required of [`${name}.module.ts`, 'install.ts']) {
      if (!existsSync(join(src, required)))
        violations.push({
          file: rel(join(src, required)),
          line: 1,
          rule: 'module-files',
          message: `the module ${name} has no ${required} (DOC-12 §4.5 rule 7)`,
        })
    }

    for (const path of walk(src)) {
      const inside = relative(src, path)
      const text = readFileSync(path, 'utf8')
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
      const line = (node: Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
      const add = (node: Node, rule: LayoutViolation['rule'], message: string) =>
        violations.push({ file: rel(path), line: line(node), rule, message })
      const classes = classesOf(ts, file)

      if (inside.startsWith('application/use-cases/')) {
        const exported = classes.filter((c) => isExported(ts, c))
        const cls = exported[0]
        if (!cls || exported.length !== 1 || classes.length !== 1) {
          violations.push({
            file: rel(path),
            line: 1,
            rule: 'use-case-shape',
            message:
              'a use-case file exports exactly one class and declares no other (DOC-12 §4.5 rule 1)',
          })
        } else {
          const methods = publicMethods(ts, cls)
          if (methods.length !== 1 || methods[0] !== 'execute')
            add(
              cls,
              'use-case-shape',
              `${cls.name.text} must have exactly one public method, execute; it has [${methods.join(', ')}]`,
            )
          const base = inside.split('/').at(-1)?.replace(/\.ts$/, '')
          if (base !== kebab(cls.name.text))
            add(cls, 'use-case-shape', `the file name must be ${kebab(cls.name.text)}.ts`)
        }
      }

      // `null`: every public method (a query service); a list: those methods only (`execute` of a use case); `[]`: none.
      const gated = inside.startsWith('application/use-cases/')
        ? ['execute']
        : /^application\/queries\/[^/]+-queries\.ts$/.test(inside)
          ? null
          : []
      for (const cls of classes) {
        for (const member of cls.members) {
          if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue
          const hidden =
            ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static
          if ((ts.getCombinedModifierFlags(member) & hidden) !== 0) continue
          if (gated !== null && !gated.includes(member.name.text)) continue
          if (takesStaff(member) && !callsRequireRole(ts, member))
            add(
              member,
              'role-gate',
              `${cls.name.text}.${member.name.text} takes a StaffContext and never calls requireRole (DOC-12 §14 item 3)`,
            )
        }
      }

      if (inside.startsWith('application/use-cases/')) {
        const base = inside.split('/').at(-1) ?? ''
        if (QUERY_PREFIX.test(base))
          violations.push({
            file: rel(path),
            line: 1,
            rule: 'query-placement',
            message: `${base} reads and changes nothing: put it as a method of a query service in application/queries/<name>-queries.ts (DOC-12 §4.5 rule 3)`,
          })
      }

      if (inside.startsWith('application/queries/') && !/-queries\.ts$/.test(inside))
        violations.push({
          file: rel(path),
          line: 1,
          rule: 'query-placement',
          message: 'application/queries/ holds <name>-queries.ts only (DOC-12 §4.5 rule 3)',
        })

      if (inside.startsWith('application/api/') && !/-api-impl(\.test)?\.ts$/.test(inside))
        violations.push({
          file: rel(path),
          line: 1,
          rule: 'query-placement',
          message: 'application/api/ holds <name>-api-impl.ts only (DOC-12 §4.5 rule 3)',
        })

      if (inside.startsWith('application/handlers/')) {
        const exported = classes.filter((c) => isExported(ts, c))
        const cls = exported[0]
        if (!cls || exported.length !== 1 || classes.length !== 1)
          violations.push({
            file: rel(path),
            line: 1,
            rule: 'handler-shape',
            message:
              'a handler file exports exactly one class and declares no other (DOC-12 §4.5 rule 2)',
          })
        else if (!implementsInterface(ts, cls, 'IntegrationEventHandler'))
          add(cls, 'handler-shape', `${cls.name.text} must implement IntegrationEventHandler`)
      }

      if (inside.startsWith('application/')) {
        for (const cls of classes) {
          if (/(Service|Manager)$/.test(cls.name.text))
            add(
              cls,
              'no-service-class',
              `${cls.name.text}: name a class for its role; one operation is one use case (DOC-12 §3 habit 5)`,
            )
          if (!inside.startsWith('application/use-cases/') && hasMethod(ts, cls, 'execute'))
            add(
              cls,
              'execute-location',
              `${cls.name.text} has execute but is not in application/use-cases/ (DOC-12 §4.5 rule 4)`,
            )
        }
      }

      if (!inside.startsWith('domain/')) {
        visit(ts, file, (node) => {
          if (ts.isInterfaceDeclaration(node) && /Repository$/.test(node.name.text))
            add(
              node,
              'repository-location',
              `${node.name.text} belongs in domain/<aggregate>-repository.ts (DOC-12 §4.5 rule 5)`,
            )
        })
      }
    }
  }
  return violations
}
