import { describe, expect, test } from 'bun:test'
import { inboxTable, outboxTable } from '@core/messaging'
import { createRuntime, type ModuleManifest } from '@core/runtime'
import { createLogger } from '@core/telemetry'
import { pgSchema } from 'drizzle-orm/pg-core'
import { outboxSourcesOf } from './outbox-sources'

const manifest = (name: string, withOutbox: boolean): ModuleManifest => ({
  name,
  dir: `/modules/${name}`,
  migrations: `/modules/${name}/migrations`,
  schemaFile: `/modules/${name}/schema.ts`,
  outbox: withOutbox ? outboxTable(pgSchema(name)) : null,
  config: undefined,
})

describe('JB-24: the sources of the relay and of outbox:list are the same list', () => {
  test('the catalog order is kept and a module without an outbox (realtime) is left out', () => {
    const catalog = [
      manifest('identity', true),
      manifest('realtime', false),
      manifest('finance', true),
    ]
    expect(outboxSourcesOf(catalog).map((source) => source.name)).toEqual(['identity', 'finance'])
  })

  test('createRuntime reads the outbox of every installed module that has one', () => {
    const catalog = [
      manifest('identity', true),
      manifest('realtime', false),
      manifest('finance', true),
    ]
    const modules = catalog.map((entry) => ({
      name: entry.name,
      ...(entry.outbox
        ? {
            outbox: {
              name: entry.name,
              table: entry.outbox,
              inboxTable: inboxTable(pgSchema(entry.name)),
            },
          }
        : {}),
    }))
    const runtime = createRuntime({
      modules,
      manifests: catalog,
      database: {} as never,
      clock: { now: () => new Date() },
      ids: { next: () => 'id' },
      logger: createLogger('silent'),
      relay: {
        pollIntervalMs: 500,
        batchSize: 50,
        concurrency: 4,
        leaseSeconds: 60,
        backoffBaseSeconds: 5,
        backoffMaxSeconds: 900,
        deferBudgetHours: 24,
        retentionDays: 7,
        cleanupIntervalMinutes: 10,
        attempts: { default: 8, sms: 3, push: 3, intent_cancel: 8 },
      },
      jobs: {
        store: { record: async () => {}, lastSuccesses: async () => new Map() },
        timeZone: 'Asia/Ho_Chi_Minh',
        tickSeconds: 15,
      },
      dbPoolMax: 10,
      maintenance: { pollIntervalMs: 1000 },
    })
    expect(runtime.relay.sourceNames).toEqual(outboxSourcesOf(catalog).map((source) => source.name))
  })
})
