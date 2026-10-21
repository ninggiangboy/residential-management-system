/**
 * `bun run --cwd apps/api config:example` writes `.env.example` at the repository root from the configuration slices
 * (DOC-41 §2 rule 1, CF-17): every key of §4 to §14 with its description and default, and no secret value. Never edited by hand.
 */
import { resolve } from 'node:path'
import { renderEnvExample } from '@core/config'
import { CONFIG_SLICES } from '../src/bootstrap/config'

const target = resolve(import.meta.dir, '../../../.env.example')
await Bun.write(
  target,
  renderEnvExample(CONFIG_SLICES, { command: 'bun run --cwd apps/api config:example' }),
)
console.log(`wrote ${target}`)
