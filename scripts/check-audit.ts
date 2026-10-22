/**
 * `bun run check:audit` (DOC-35 §3.3, AD-06): the audit actions that the code writes are declared by their module and listed in
 * the catalog of DOC-35 §4. Run by `verify`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lintAudit, readCatalog } from './lib/audit-lint'
import { annotate } from './lib/ci'
import { loadTypeScript } from './lib/typescript-api'

const root = resolve(import.meta.dir, '..')
const catalog = readCatalog(
  readFileSync(resolve(root, 'docs/06-design/audit-privacy-and-terms.md'), 'utf8'),
)
const { declared, used, violations } = lintAudit(loadTypeScript(), root, catalog)

console.log(
  `catalog: ${catalog.size} actions; declared by modules: ${declared}; written in code: ${used}`,
)
for (const v of violations) {
  console.log(`${v.file}:${v.line}  ${v.message}`)
  annotate('error', 'check:audit', `${v.file}:${v.line} ${v.message}`)
}
console.log(
  violations.length === 0
    ? 'check:audit: no violation'
    : `check:audit: ${violations.length} violation(s)`,
)
process.exit(violations.length === 0 ? 0 : 1)
