/**
 * Dead letters (DOC-38 §2.7, RB-05):
 *   bun run --filter @app/api outbox:list
 *   bun run --filter @app/api outbox:requeue -- --id <uuid>       (or --type <event type>)
 *   bun run --filter @app/api outbox:discard -- --id <uuid>
 * The sources are the outboxes of the modules in the catalog: the same list the relay reads (JB-24).
 */
import { OutboxAdmin } from '@core/messaging'
import { createLogger } from '@core/telemetry'
import { loadAppConfig } from '../src/bootstrap/config'
import { createContainer } from '../src/bootstrap/container'
import { MODULE_CATALOG } from '../src/bootstrap/module-catalog'
import { outboxSourcesOf } from '../src/bootstrap/outbox-sources'

const say = (line: string) => process.stdout.write(`${line}\n`)
const [command, ...rest] = process.argv.slice(2)
const option = (name: string) => {
  const at = rest.indexOf(`--${name}`)
  return at >= 0 ? rest[at + 1] : undefined
}

const container = createContainer(loadAppConfig(), createLogger('warn', { service: 'outbox-cli' }))
const admin = new OutboxAdmin(container.database, outboxSourcesOf(MODULE_CATALOG))
let code = 0
try {
  if (command === 'list') {
    const dead = await admin.listDead()
    for (const row of dead)
      say(
        `${row.source}\t${row.id}\t${row.type}\tattempts=${row.attempts}\t${row.occurredAt.toISOString()}\t${row.lastError ?? ''}`,
      )
    say(`${dead.length} dead letter(s)`)
  } else if (command === 'requeue') {
    const id = option('id')
    const type = option('type')
    if (!id && !type) throw new Error('requeue needs --id <uuid> or --type <event type>')
    say(`requeued ${await admin.requeue(id ? { id } : { type: type as string })}`)
  } else if (command === 'discard') {
    const id = option('id')
    if (!id) throw new Error('discard needs --id <uuid>')
    say(`discarded ${await admin.discard(id)}`)
  } else {
    say('usage: outbox.ts list | requeue --id <uuid> | requeue --type <type> | discard --id <uuid>')
    code = 64
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  code = 1
} finally {
  await container.close()
}
process.exit(code)
