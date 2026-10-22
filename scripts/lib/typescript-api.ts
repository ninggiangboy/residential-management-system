import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

/**
 * The TypeScript compiler API, for the scripts that read the AST (`check:scope`, `check:audit`). TypeScript 7 has no JavaScript
 * API yet, so these scripts use the TypeScript 6 that `tools/depcruise` carries for dependency-cruiser (DOC-11 §2 row 5,
 * DOC-12 §7.3, chosen and pinned in P1-07). Its types are not available to the TypeScript 7 of the product, so the nodes are
 * `any` here and nowhere else.
 */

const root = resolve(import.meta.dir, '../..')
const toolDir = resolve(root, 'tools/depcruise')
const entry = resolve(toolDir, 'node_modules/typescript/lib/typescript.js')

// biome-ignore lint/suspicious/noExplicitAny: the TypeScript 6 API is loaded at run time and has no types in this workspace
export type Ts = any
// biome-ignore lint/suspicious/noExplicitAny: a node of the TypeScript 6 API
export type Node = any

export function loadTypeScript(): Ts {
  if (!existsSync(entry)) {
    const install = Bun.spawnSync(['bun', 'install', '--frozen-lockfile'], {
      cwd: toolDir,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if (install.exitCode !== 0) throw new Error('cannot install tools/depcruise (TypeScript 6)')
  }
  return createRequire(import.meta.url)(entry)
}
