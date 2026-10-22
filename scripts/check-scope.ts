/**
 * `bun run check:scope` (DOC-12 §7.3, DR-12): the building-scope lint. A query on a table that has a `building_id` must carry
 * the scope, a repository method must take it first, and a table without it must be on the allow-list. Run by `verify`.
 */
import { resolve } from 'node:path'
import { annotate } from './lib/ci'
import { lintScope } from './lib/scope-lint'
import { loadTypeScript } from './lib/typescript-api'

const root = resolve(import.meta.dir, '..')
const { scoped, violations } = lintScope(loadTypeScript(), root)

console.log(
  `scoped tables (${scoped.length}): ${scoped.map((t) => t.qualified).join(', ') || 'none'}`,
)
for (const v of violations) {
  console.log(`${v.file}:${v.line}  [${v.rule}] ${v.message}`)
  annotate('error', `check:scope ${v.rule}`, `${v.file}:${v.line} ${v.message}`)
}
console.log(
  violations.length === 0
    ? 'check:scope: no violation'
    : `check:scope: ${violations.length} violation(s)`,
)
process.exit(violations.length === 0 ? 0 : 1)
