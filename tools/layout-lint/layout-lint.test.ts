import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { lintLayout } from '../../scripts/lib/layout-lint'
import { loadTypeScript } from '../../scripts/lib/typescript-api'

/**
 * Negative fixtures for `check:layout` (DOC-12 §6.4, DR-254): one tree that passes and one tree per rule that fails, each as
 * source text written to a temporary directory. The lint must name the rule.
 */

const ts = loadTypeScript()
const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** A module `demo` with its two wiring files and the given extra files. */
function tree(files: Record<string, string>, wiring = true): string {
  const root = mkdtempSync(join(tmpdir(), 'layout-lint-'))
  dirs.push(root)
  const all: Record<string, string> = wiring
    ? { 'demo.module.ts': 'export {}', 'install.ts': 'export {}', ...files }
    : files
  for (const [path, text] of Object.entries(all)) {
    const full = join(root, 'modules/demo/src', path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return root
}

const rules = (root: string) => lintLayout(ts, root).map((v) => v.rule)

const USE_CASE = `export class RegisterFile { async execute(): Promise<void> {} private helper() {} }`

describe('the layout lint (DOC-12 §4.5)', () => {
  test('a module in the layout passes', () => {
    const root = tree({
      'application/use-cases/register-file.ts': USE_CASE,
      'application/handlers/delete-object.ts': `
        export class DeleteObject implements IntegrationEventHandler { handle() {} }`,
      'application/ports.ts': 'export interface ObjectStore {}',
      'domain/file-repository.ts': 'export interface FileRepository {}',
    })
    expect(lintLayout(ts, root)).toEqual([])
  })

  test('use-case-shape: two classes in a file', () => {
    const root = tree({
      'application/use-cases/register-file.ts': `${USE_CASE}\nexport class Other { execute() {} }`,
    })
    expect(rules(root)).toContain('use-case-shape')
  })

  test('use-case-shape: a second public method', () => {
    const root = tree({
      'application/use-cases/register-file.ts': `export class RegisterFile { execute() {} verify() {} }`,
    })
    expect(rules(root)).toContain('use-case-shape')
  })

  test('use-case-shape: no execute', () => {
    const root = tree({
      'application/use-cases/register-file.ts': `export class RegisterFile { run() {} }`,
    })
    expect(rules(root)).toContain('use-case-shape')
  })

  test('use-case-shape: the file name is not the kebab case of the class', () => {
    const root = tree({ 'application/use-cases/files.ts': USE_CASE })
    expect(rules(root)).toContain('use-case-shape')
  })

  test('handler-shape: a class that does not implement IntegrationEventHandler', () => {
    const root = tree({
      'application/handlers/delete-object.ts': `export class DeleteObject { handle() {} }`,
    })
    expect(rules(root)).toContain('handler-shape')
  })

  test('handler-shape: two handlers in a file', () => {
    const root = tree({
      'application/handlers/both.ts': `
        export class A implements IntegrationEventHandler {}
        export class B implements IntegrationEventHandler {}`,
    })
    expect(rules(root)).toContain('handler-shape')
  })

  test('repository-location: an interface *Repository outside domain/', () => {
    const root = tree({ 'application/ports.ts': 'export interface FileRepository {}' })
    expect(rules(root)).toEqual(['repository-location'])
  })

  test('no-service-class: a *Service class in application/', () => {
    const root = tree({
      'application/files-service.ts': 'export class FilesService { register() {} }',
    })
    expect(rules(root)).toEqual(['no-service-class'])
  })

  test('execute-location: execute outside use-cases/', () => {
    const root = tree({ 'application/loader.ts': 'export class FileLoader { execute() {} }' })
    expect(rules(root)).toEqual(['execute-location'])
  })

  test('module-files: no module file and no install', () => {
    const root = tree({ 'index.ts': 'export {}' }, false)
    expect(lintLayout(ts, root).map((v) => v.message)).toEqual([
      expect.stringContaining('demo.module.ts'),
      expect.stringContaining('install.ts'),
    ])
  })
})
