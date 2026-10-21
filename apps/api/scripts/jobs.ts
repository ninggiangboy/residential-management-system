/**
 * `bun run --filter @app/api jobs:run -- --name <job>`: runs one job once, under the same lock, and writes its `job_run` row
 * with `details.manual = true` (DOC-38 §7). It is how an operator repeats a failed clock job (RB-05).
 */
import { createLogger } from '@core/telemetry'
import { loadAppConfig } from '../src/bootstrap/config'
import { createContainer } from '../src/bootstrap/container'

const say = (line: string) => process.stdout.write(`${line}\n`)
const at = process.argv.indexOf('--name')
const name = at >= 0 ? process.argv[at + 1] : undefined

const container = createContainer(loadAppConfig(), createLogger('warn', { service: 'jobs-cli' }))
let code = 0
try {
  if (!name) {
    say(
      `usage: jobs.ts --name <job>   (installed: ${container.runtime.jobs.names.join(', ') || 'none'})`,
    )
    code = 64
  } else {
    const event = await container.runtime.jobs.runNow(name)
    say(
      `${event.name}: ${event.status} in ${event.durationMs} ms, did ${event.did}${event.recorded ? ', job_run written' : ''}`,
    )
    code = event.status === 'failed' ? 1 : 0
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  code = 1
} finally {
  await container.close()
}
process.exit(code)
