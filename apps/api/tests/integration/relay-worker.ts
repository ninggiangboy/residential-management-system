/**
 * A worker process for the crash test (JB-15): a relay whose second handler sleeps long enough for the test to kill the
 * process with SIGKILL in the middle of a batch. Started with the environment of the test.
 */
import { Database } from '@core/db'
import { InProcessMessageBus, OutboxRelay } from '@core/messaging'
import { createLogger } from '@core/telemetry'
import { effectHandler, probeInbox, probeOutbox } from './probe'

const database = new Database({
  url: process.env.DATABASE_URL as string,
  poolMax: 10,
  prepare: false,
})
const bus = new InProcessMessageBus(createLogger('silent'))
bus.subscribe(effectHandler(database, 'a', { relay: 'doomed' }))
bus.subscribe(effectHandler(database, 'b', { relay: 'doomed', delayMs: 60_000 }))
bus.subscribe(effectHandler(database, 'c', { relay: 'doomed' }))
const relay = new OutboxRelay(
  database,
  [{ name: 'probe', table: probeOutbox, inboxTable: probeInbox }],
  bus,
  createLogger('silent'),
  { pollIntervalMs: 50, batchSize: 50, concurrency: 4, leaseSeconds: 2 },
)
relay.start()
process.stdout.write('started\n')
