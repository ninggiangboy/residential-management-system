/**
 * `bun run check:test-ids` (DOC-88 §5 rule 8, DR-169): compares the IDs of every "Required tests" table with the titles of
 * the tests. The prefixes and their documents come from the index of DOC-88 §15. It prints a table per prefix, writes a
 * warning for each test whose ID no document defines, and **never fails** the build.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { annotate, markdownTable, writeSummary } from './lib/ci'

const root = resolve(import.meta.dir, '..')
const indexDoc = resolve(root, 'docs/10-testing/test-strategy.md')

/** Rows of the §15 index: the first backticked word is the prefix, the first Markdown link is its document. */
function readIndex() {
  const text = readFileSync(indexDoc, 'utf8')
  const section = text.slice(
    text.indexOf('## 15. Index of test-ID prefixes'),
    text.indexOf('## 16.'),
  )
  const rows: { prefix: string; doc?: string }[] = []
  for (const line of section.split('\n')) {
    const prefix = /^\| `([A-Z]+-)`/.exec(line)?.[1]
    if (!prefix || prefix === 'EXP-') continue
    const link = /\]\(([^)#]+\.md)/.exec(line)?.[1]
    rows.push({ prefix, doc: link ? resolve(dirname(indexDoc), link) : undefined })
  }
  return rows
}

/** IDs in the first column of the document's tables (`| AU-22 |`, `| AU-S04 |`). */
function documentedIds(doc: string, prefix: string) {
  const ids = new Set<string>()
  const re = new RegExp(`^\\| \\*{0,2}(${prefix}S?\\d+)\\b`, 'gm')
  for (const m of readFileSync(doc, 'utf8').matchAll(re)) if (m[1]) ids.add(m[1])
  return ids
}

/** IDs that start a test title: `test('AU-22 …'`, `it.each(…)('AU-22 …'`, `test.todo('LG-14 …'`. */
async function testedIds() {
  const ids = new Map<string, string>()
  const glob = new Bun.Glob('{apps,modules,packages}/**/*.{test,spec}.{ts,tsx}')
  const title = /\b(?:test|it)(?:\.\w+)*(?:\([^)]*\))?\(\s*['"`]([A-Z]+-S?\d+)\b/g
  for await (const file of glob.scan({ cwd: root })) {
    if (file.includes('node_modules')) continue
    for (const m of readFileSync(resolve(root, file), 'utf8').matchAll(title))
      if (m[1] && !ids.has(m[1])) ids.set(m[1], file)
  }
  return ids
}

const index = readIndex()
const tested = await testedIds()
const known = new Set<string>()
const rows: (string | number)[][] = []

for (const { prefix, doc } of index) {
  if (!doc || !existsSync(doc)) {
    rows.push([`\`${prefix}\``, 'not written', '', '', ''])
    continue
  }
  const ids = documentedIds(doc, prefix)
  for (const id of ids) known.add(id)
  const covered = [...ids].filter((id) => tested.has(id)).length
  rows.push([`\`${prefix}\``, ids.size, covered, ids.size - covered, doc.slice(root.length + 1)])
}

// Only IDs of an indexed prefix: a title may also start with a DR or an E-number, which is no test ID.
const prefixes = new Set(index.map((row) => row.prefix))
const unknown = [...tested].filter(
  ([id]) => prefixes.has(id.slice(0, id.indexOf('-') + 1)) && !known.has(id),
)
for (const [id, file] of unknown)
  annotate('warning', 'check:test-ids', `${file}: test ID ${id} is in no document of DOC-88 §15`)

const table = markdownTable(
  ['Prefix', 'In the document', 'With a test', 'Without a test', 'Document'],
  rows,
)
console.log(table)
console.log(`\n${tested.size} test IDs found, ${unknown.length} not defined by a document`)
writeSummary(
  `### Test IDs (warning only, DR-169)\n\n${table}\n\n${unknown.length} test IDs are in no document.\n`,
)
