import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const root = resolve(import.meta.dir, '../..')
export const envFile = resolve(root, '.env.local')
export const composeFile = resolve(root, 'docker/compose.local.yml')

/** KEY=value lines of a dotenv file, in order; comments and blank lines are dropped. */
export function readEnvFile(path: string): Map<string, string> {
  const values = new Map<string, string>()
  if (!existsSync(path)) return values
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) values.set(match[1], match[2])
  }
  return values
}
