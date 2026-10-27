/**
 * `bun run seed:demo` (DOC-69 §9, DOC-36 §9.1): creates the demo building `DEMO-A` when the database has none, then runs the reset
 * of every module (`resetDemo` then `seedDemo`) in one transaction. Safe to run again: the second run deletes what the first
 * created and seeds it with the same ids. It touches the demo building only; every module asserts `building.is_demo` first.
 */
import { createLogger } from '@core/telemetry'
import { loadAppConfig } from '../src/bootstrap/config'
import { createContainer } from '../src/bootstrap/container'
import { DEMO_BUILDING_ID } from '../src/demo/plan'

const say = (line: string) => process.stdout.write(`${line}\n`)

const config = loadAppConfig()
const container = createContainer(config, createLogger('warn', { service: 'seed-demo' }))
let code = 0
try {
  const { demo } = container.building
  const created = await container.database.run(() =>
    demo.ensureBuilding.execute(container.demoPlan.building),
  )
  const result = await demo.reset.run(DEMO_BUILDING_ID)
  say(
    `demo seeded${created ? ' (building created)' : ''}: ${result.created['residency.unit'] ?? 0} units, ` +
      `${result.created['identity.resident_account'] ?? 0} residents, ` +
      `${result.created['identity.staff_account'] ?? 0} staff in ${result.durationMs} ms (${config.core.APP_ENV})`,
  )
} catch (error) {
  process.stderr.write(
    `seed:demo failed: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  code = 1
} finally {
  await container.close()
}
process.exit(code)
