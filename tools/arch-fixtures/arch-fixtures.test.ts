import { afterAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * One directory per case under `cases/`, named `<config>__<rule>` (the rule that must fail) or
 * `<config>__ok` (a clean tree that must pass). The tree is copied to a temp directory so the
 * `^modules/`, `^packages/` and `^apps/` patterns of the configurations match, then cruised.
 * A rule that silently stops matching turns its case green-to-red here (DOC-12 §6.2).
 */
const root = resolve(import.meta.dir, '../..')
const casesDir = join(import.meta.dir, 'cases')
const scratch: string[] = []

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function cruise(config: string, caseName: string) {
  const dir = mkdtempSync(join(tmpdir(), 'arch-fixture-'))
  scratch.push(dir)
  cpSync(join(casesDir, caseName), dir, { recursive: true })
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))
  writeFileSync(join(dir, 'tsconfig.json'), '{ "compilerOptions": { "module": "esnext", "moduleResolution": "bundler" } }')
  const result = Bun.spawnSync(
    [join(root, 'tools/depcruise/node_modules/.bin/depcruise'), config, '--config', join(root, `.dependency-cruiser.${config}.cjs`)],
    { cwd: dir },
  )
  return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() }
}

describe('dependency-cruiser fixtures', () => {
  for (const name of readdirSync(casesDir).sort()) {
    const [config, rule] = name.split('__') as [string, string]
    test(`${config}: ${rule === 'ok' ? 'a clean tree passes' : `${rule} fails`}`, () => {
      const { code, output } = cruise(config, name)
      if (rule === 'ok') {
        expect(output).toContain('no dependency violations found')
        expect(code).toBe(0)
      } else {
        expect(output).toContain(rule)
        expect(code).not.toBe(0)
      }
    })
  }
})
