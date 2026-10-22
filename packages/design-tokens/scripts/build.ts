import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OUTPUTS } from '../src/generate'

/**
 * `bun run tokens:build` writes `generated/` from `tokens.json` (DOC-54 §2.1); `--check` only reports the files that
 * differ, and exits 1 when one does. The outputs are committed so that the apps need no build step (DOC-55 §2.3).
 */
const dir = join(import.meta.dir, '..', 'generated')
const check = process.argv.includes('--check')
const stale: string[] = []

mkdirSync(dir, { recursive: true })
for (const [file, render] of Object.entries(OUTPUTS)) {
  const path = join(dir, file)
  const content = render()
  let current: string | undefined
  try {
    current = readFileSync(path, 'utf8')
  } catch {}
  if (current === content) continue
  stale.push(file)
  if (!check) writeFileSync(path, content)
}

if (check && stale.length > 0) {
  console.error(`generated/ is out of date (${stale.join(', ')}): run bun run tokens:build`)
  process.exit(1)
}
console.log(stale.length > 0 ? `wrote ${stale.join(', ')}` : 'generated/ is current')
