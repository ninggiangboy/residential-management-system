/**
 * `bun run check:layout` (DOC-12 §4.5, §6.4, DR-254): the layout of a module. One use case per file with one `execute`, one
 * handler per file, repository interfaces in `domain/`, no `*Service` class, and the `<name>.module.ts` and `install.ts` of
 * every module. Run by `verify`.
 */
import { resolve } from 'node:path'
import { annotate } from './lib/ci'
import { lintLayout } from './lib/layout-lint'
import { loadTypeScript } from './lib/typescript-api'

const root = resolve(import.meta.dir, '..')
const violations = lintLayout(loadTypeScript(), root)

for (const v of violations) {
  console.log(`${v.file}:${v.line}  [${v.rule}] ${v.message}`)
  annotate('error', `check:layout ${v.rule}`, `${v.file}:${v.line} ${v.message}`)
}
console.log(
  violations.length === 0
    ? 'check:layout: no violation'
    : `check:layout: ${violations.length} violation(s)`,
)
process.exit(violations.length === 0 ? 0 : 1)
