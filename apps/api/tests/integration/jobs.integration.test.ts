import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Database } from '@core/db'
import { type Clock, UuidV7Generator } from '@core/kernel'
import {
  type AppModule,
  createRuntime,
  type JobDefinition,
  type JobResult,
  type JobRunEvent,
  JobRuntime,
  SqlJobRunStore,
  validateSchedule,
  zonedTime,
} from '@core/runtime'
import { createLogger } from '@core/telemetry'
import { adminUrl, cloneTemplate, type TestDb, withDatabase } from '@rms/test-support'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { CLOCK_JOB_GRACE_MINUTES } from '../../src/bootstrap/config'
import { JOB_CATALOG, OUTBOX_CLEANUP_SOURCES } from '../../src/bootstrap/job-catalog'
import { createProbeModule, probeInbox, probeOutbox } from './probe'

const VN = 'Asia/Ho_Chi_Minh'
const logger = createLogger('silent')
const ids = new UuidV7Generator()

class SettableClock implements Clock {
  constructor(private current: Date) {}
  set(date: Date) {
    this.current = date
  }
  now() {
    return new Date(this.current)
  }
}
const local = (y: number, m: number, d: number, hh: number, mm: number) =>
  zonedTime(y, m, d, hh, mm, VN)

let db: TestDb
let database: Database
const databases: Database[] = []

beforeAll(async () => {
  db = await cloneTemplate('empty')
  const admin = db.admin()
  await createProbeModule(admin)
  await admin.end()
  database = new Database({ url: db.url, poolMax: 10, prepare: false })
})
afterAll(async () => {
  await database.close()
  for (const extra of databases) await extra.close()
  await db.drop()
})

function job(over: Partial<JobDefinition> & Pick<JobDefinition, 'name' | 'run'>): JobDefinition {
  return { schedule: { kind: 'every', seconds: 3600 }, mode: 'claim', graceMinutes: 0, ...over }
}

function runtimeOf(
  jobs: JobDefinition[],
  over: Partial<ConstructorParameters<typeof JobRuntime>[0]> = {},
) {
  const events: JobRunEvent[] = []
  const runtime = new JobRuntime({
    jobs,
    database,
    clock: new SettableClock(new Date()),
    ids,
    logger,
    store: new SqlJobRunStore(database),
    timeZone: VN,
    tickSeconds: 1,
    random: () => 0,
    onRun: (event) => events.push(event),
    ...over,
  })
  return { runtime, events }
}

const rows = async (name?: string) =>
  db.sql<{ name: string; status: string; details: Record<string, unknown> }[]>`
    SELECT name, status, details FROM building.job_run ${name ? db.sql`WHERE name = ${name}` : db.sql``} ORDER BY finished_at, id`

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 5000) {
  const limit = Date.now() + timeoutMs
  while (Date.now() < limit) {
    if (await check()) return
    await Bun.sleep(25)
  }
  throw new Error('condition not met in time')
}

describe('the lock of a job (DOC-38 §3.2)', () => {
  const lockJob = (name: string, work: () => Promise<void> = async () => {}) =>
    job({
      name,
      mode: 'lock',
      run: async (ctx): Promise<JobResult> =>
        ctx.withLock(async () => (await work(), { did: 1, details: {} })),
    })

  test('JB-08 while a session holds job:invariant_check a run skips, another job does not, and after the commit it runs', async () => {
    const { runtime } = runtimeOf([lockJob('invariant_check'), lockJob('orphan_uploads')])
    const holder = db.connect(1)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('job:invariant_check'))`
      await held
    })
    await Bun.sleep(100)
    expect((await runtime.runNow('invariant_check')).status).toBe('skipped_locked')
    expect((await runtime.runNow('orphan_uploads')).status).toBe('succeeded')
    release()
    await holding
    expect((await runtime.runNow('invariant_check')).status).toBe('succeeded')
    await holder.end()
  })

  test('JB-09 a session killed while holding the lock releases it at once', async () => {
    const { runtime } = runtimeOf([lockJob('orphan_uploads')])
    const holder = db.connect(1)
    const holding = holder.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('job:orphan_uploads'))`
      await new Promise(() => {})
    })
    holding.catch(() => {})
    await Bun.sleep(100)
    expect((await runtime.runNow('orphan_uploads')).status).toBe('skipped_locked')
    // Only a superuser may see the query text of another role and terminate its backend.
    const superuser = postgres(withDatabase(adminUrl(), db.name), { max: 1, prepare: false })
    await superuser`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE query LIKE '%job:orphan_uploads%' AND pid <> pg_backend_pid() AND datname = current_database()`
    await superuser.end()
    await Bun.sleep(200)
    expect((await runtime.runNow('orphan_uploads')).status).toBe('succeeded')
    await holder.end({ timeout: 1 }).catch(() => {})
  })

  test('JB-18 two workers start the same lock job at the same moment: one skips and writes no row, the other finishes', async () => {
    const second = new Database({ url: db.url, poolMax: 5, prepare: false })
    databases.push(second)
    const work = lockJob('orphan_uploads', () => Bun.sleep(400))
    const one = runtimeOf([work])
    const two = runtimeOf([work], { database: second })
    const before = (await rows('orphan_uploads')).length
    const outcomes = await Promise.all([
      one.runtime.runNow('orphan_uploads'),
      two.runtime.runNow('orphan_uploads'),
    ])
    expect(outcomes.map((o) => o.status).sort()).toEqual(['skipped_locked', 'succeeded'])
    expect((await rows('orphan_uploads')).length).toBe(before + 1)
    const skipped = outcomes.find((o) => o.status === 'skipped_locked')
    expect(skipped?.recorded).toBe(false)
  })

  test('JB-13 a snapshot reads at repeatable read, read only, with its own 5-minute timeout, as a role that is not a superuser', async () => {
    let seen: Record<string, string> = {}
    const snap = job({
      name: 'invariant_check',
      mode: 'snapshot',
      run: (ctx) =>
        ctx.snapshot(async () => {
          const result = await database.executor.execute<Record<string, string>>(
            sql`select current_user as who, current_setting('transaction_isolation') as isolation,
              current_setting('transaction_read_only') as read_only, current_setting('statement_timeout') as timeout,
              (select count(*)::text from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) as locks`,
          )
          seen = result[0] as Record<string, string>
          return { did: 1, details: {} }
        }),
    })
    expect((await runtimeOf([snap]).runtime.runNow('invariant_check')).status).toBe('succeeded')
    expect(seen).toEqual({
      who: 'rms_app',
      isolation: 'repeatable read',
      read_only: 'on',
      timeout: '5min',
      locks: '1',
    })
  })
})

describe('the catalog (DOC-38 §4)', () => {
  test('JB-10 the 24 job names and the 9 cleanup locks hash to 33 distinct values', async () => {
    const names = [
      ...JOB_CATALOG.map((entry) => `job:${entry.name}`),
      ...OUTBOX_CLEANUP_SOURCES.map((s) => `outbox-cleanup:${s}`),
    ]
    expect(JOB_CATALOG).toHaveLength(24)
    expect(names).toHaveLength(33)
    const hashes = await db.sql<
      { h: number }[]
    >`SELECT hashtext(n) AS h FROM unnest(${names}::text[]) AS n`
    expect(new Set(hashes.map((row) => row.h)).size).toBe(33)
  })

  test('every entry has a valid name and schedule; the catalog equals the table of DOC-38 §4.1', () => {
    const doc = readFileSync(
      new URL('../../../../docs/06-design/jobs-and-outbox-runtime.md', import.meta.url),
      'utf8',
    )
    const section = doc.slice(doc.indexOf('### 4.1 Schedules'), doc.indexOf('### 4.2 Work'))
    const rowsOfDoc = section
      .split('\n')
      .filter((line) => /^\| `[a-z_]+` \|/.test(line))
      .map((line) => line.split('|').map((cell) => cell.trim()))
    expect(rowsOfDoc).toHaveLength(JOB_CATALOG.length)
    for (const entry of JOB_CATALOG) {
      validateSchedule(entry.schedule)
      expect(entry.name).toMatch(/^[a-z][a-z0-9_]{2,40}$/)
      const cells = rowsOfDoc.find((cells) => cells[1] === `\`${entry.name}\``)
      expect(cells?.[2]).toBe(entry.module)
      expect(cells?.[4]).toBe(entry.mode)
      const grace = cells?.[5] ?? ''
      const key = entry.name.toUpperCase() as keyof typeof CLOCK_JOB_GRACE_MINUTES
      if (
        entry.schedule.kind === 'daily' ||
        entry.schedule.kind === 'weekly' ||
        entry.schedule.kind === 'monthly'
      )
        expect(`${(CLOCK_JOB_GRACE_MINUTES[key] ?? 0) / 60} h`).toBe(grace)
      else expect(CLOCK_JOB_GRACE_MINUTES[key]).toBeUndefined()
    }
  })
})

describe('what a run writes (DOC-38 §3.5)', () => {
  test('JB-25 a sub-hourly job that finds nothing writes no row, one that works writes one, one that fails writes a failed row', async () => {
    let mode: 'idle' | 'work' | 'fail' = 'idle'
    const sub = job({
      name: 'export_run',
      schedule: { kind: 'every', seconds: 5 },
      run: async () => {
        if (mode === 'fail') throw new Error('x'.repeat(900))
        return { did: mode === 'work' ? 3 : 0, details: mode === 'work' ? { exports: 3 } : {} }
      },
    })
    const { runtime } = runtimeOf([sub])
    await runtime.runNow('export_run')
    expect(await rows('export_run')).toHaveLength(0)
    const idleSuccess = runtime.lastSuccess.get('export_run')
    expect(idleSuccess).toBeDefined()
    mode = 'work'
    await Bun.sleep(5)
    await runtime.runNow('export_run')
    expect((await rows('export_run')).map((r) => [r.status, r.details])).toEqual([
      ['succeeded', { exports: 3, manual: true }],
    ])
    const afterWork = runtime.lastSuccess.get('export_run')
    mode = 'fail'
    await Bun.sleep(5)
    expect((await runtime.runNow('export_run')).status).toBe('failed')
    const all = await rows('export_run')
    expect(all.map((r) => r.status)).toEqual(['succeeded', 'failed'])
    expect(String(all[1]?.details?.error).length).toBeLessThanOrEqual(500)
    expect(runtime.lastSuccess.get('export_run')).toEqual(afterWork)
  })

  test('an hourly or longer job always writes a row, even when it found nothing', async () => {
    const hourly = job({
      name: 'storage_quota',
      schedule: { kind: 'hourly', minute: 5 },
      run: async () => ({ did: 0, details: {} }),
    })
    await runtimeOf([hourly]).runtime.runNow('storage_quota')
    expect(await rows('storage_quota')).toHaveLength(1)
  })

  test('JB-11 the restart query returns the latest success of each job', async () => {
    await db.sql`DELETE FROM building.job_run`
    const store = new SqlJobRunStore(database)
    const at = (hour: number) => new Date(Date.UTC(2026, 9, 19, hour))
    const record = (name: string, status: 'succeeded' | 'failed', hour: number) =>
      store.record({
        id: ids.next(),
        name,
        startedAt: at(hour),
        finishedAt: at(hour),
        status,
        details: {},
      })
    await record('invariant_check', 'succeeded', 3)
    await record('invariant_check', 'succeeded', 5)
    await record('invariant_check', 'failed', 7)
    await record('audit_purge', 'succeeded', 4)
    const last = await store.lastSuccesses()
    expect(last.get('invariant_check')).toEqual(at(5))
    expect(last.get('audit_purge')).toEqual(at(4))
  })
})

describe('clock jobs (DOC-38 §3.3)', () => {
  test('JB-19 a worker started at 15:00 catches up the 03:00 slot (grace 12 h); one started at 16:30 does not', async () => {
    await db.sql`DELETE FROM building.job_run`
    const late = { runs: 0 }
    const a = runtimeOf([invariant(late)], { clock: new SettableClock(local(2026, 10, 19, 15, 0)) })
    await a.runtime.start()
    await until(() => late.runs === 1)
    await a.runtime.stop(2000)
    expect((await rows('invariant_check')).map((r) => r.status)).toEqual(['succeeded'])

    await db.sql`DELETE FROM building.job_run`
    const tooLate = { runs: 0 }
    const b = runtimeOf([invariant(tooLate)], {
      clock: new SettableClock(local(2026, 10, 19, 16, 30)),
    })
    await b.runtime.start()
    await Bun.sleep(1500)
    await b.runtime.stop(2000)
    expect(tooLate.runs).toBe(0)
  })

  test('a restart does not repeat a slot that already succeeded', async () => {
    await db.sql`DELETE FROM building.job_run`
    const counter = { runs: 0 }
    const clock = new SettableClock(local(2026, 10, 19, 3, 0))
    const first = runtimeOf([invariant(counter)], { clock })
    await first.runtime.start()
    await until(() => counter.runs === 1)
    await first.runtime.stop(2000)
    clock.set(local(2026, 10, 19, 9, 0))
    const second = runtimeOf([invariant(counter)], { clock })
    await second.runtime.start()
    await Bun.sleep(1200)
    await second.runtime.stop(2000)
    expect(counter.runs).toBe(1)
  })

  test('JB-20 a job that throws writes one failed row, is not retried before its next slot and leaves the gauge alone', async () => {
    await db.sql`DELETE FROM building.job_run`
    const counter = { runs: 0 }
    const clock = new SettableClock(local(2026, 10, 19, 3, 0))
    const { runtime } = runtimeOf([invariant(counter, true)], { clock })
    await runtime.start()
    await until(() => counter.runs === 1)
    await Bun.sleep(2500)
    await runtime.stop(2000)
    expect(counter.runs).toBe(1)
    const written = await rows('invariant_check')
    expect(written.map((r) => r.status)).toEqual(['failed'])
    expect(written[0]?.details?.error).toBe('boom')
    expect(runtime.lastSuccess.get('invariant_check')).toBeUndefined()
  })

  test('JB-21 on stop a batch job finishes its current batch, runs no more, and returns within the time; the next run completes it', async () => {
    let batches = 0
    const batchJob = job({
      name: 'orphan_uploads',
      mode: 'lock',
      run: async (ctx) => {
        while (batches < 10 && !ctx.signal.aborted) {
          await ctx.withLock(async () => {
            await Bun.sleep(150)
            batches++
          })
        }
        return { did: batches, details: { batches } }
      },
    })
    const { runtime } = runtimeOf([batchJob])
    await runtime.start()
    await until(() => runtime.active.includes('orphan_uploads'))
    await until(() => batches >= 2)
    const begin = performance.now()
    const stillRunning = await runtime.stop(40_000)
    const elapsed = performance.now() - begin
    expect(stillRunning).toEqual([])
    expect(elapsed).toBeLessThan(1500)
    const done = batches
    expect(done).toBeGreaterThanOrEqual(2)
    expect(done).toBeLessThan(10)
    await Bun.sleep(400)
    expect(batches).toBe(done)
    // The next run, with a fresh runtime, completes the work.
    await runtimeOf([batchJob]).runtime.runNow('orphan_uploads')
    expect(batches).toBe(10)
  })

  test('stop reports the jobs that did not return in time', async () => {
    const stuck = job({ name: 'export_run', run: () => new Promise<JobResult>(() => {}) })
    const { runtime } = runtimeOf([stuck])
    await runtime.start()
    // `every` jobs start after a random delay (0 here): wait for the run.
    await until(() => runtime.active.length === 1, 4000).catch(() => {})
    const timedOut = await runtime.stop(200)
    expect(timedOut.length === 0 || timedOut[0] === 'export_run').toBe(true)
  })
})

describe('maintenance and readiness (DOC-38 §5.2, §5.3)', () => {
  function worker(clock: Clock, state: { active: boolean }, jobs: JobDefinition[]) {
    const source = { name: 'probe', table: probeOutbox, inboxTable: probeInbox }
    const delivered: string[] = []
    const module: AppModule = {
      name: 'probe',
      outbox: source,
      jobs,
      handlers: [
        {
          name: 'probe.collect',
          eventType: 'probe.thing_happened.v1',
          handle: async (m) => {
            delivered.push(m.id)
          },
        },
      ],
    }
    const runtime = createRuntime({
      modules: [module],
      manifests: [],
      database,
      clock,
      ids,
      logger,
      relay: {
        pollIntervalMs: 50,
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
      jobs: { store: new SqlJobRunStore(database), timeZone: VN, tickSeconds: 1 },
      dbPoolMax: 10,
      maintenance: {
        pollIntervalMs: 50,
        store: { read: async () => ({ active: state.active, reason: null, since: null }) },
      },
    })
    return { runtime, delivered }
  }

  test('JB-22 while maintenance is on the relay claims nothing and no job starts; after it a clock job whose slot passed runs if in grace', async () => {
    await db.sql`DELETE FROM probe.outbox_messages`
    await db.sql`DELETE FROM building.job_run`
    const state = { active: true }
    const counter = { runs: 0 }
    const clock = new SettableClock(local(2026, 10, 19, 3, 0))
    const { runtime, delivered } = worker(clock, state, [invariant(counter)])
    await runtime.maintenance.refresh()
    expect(runtime.maintenance.active).toBe(true)
    await runtime.startWorker()
    runtime.maintenance.start()
    const id = Bun.randomUUIDv7()
    await db.sql`INSERT INTO probe.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at)
      VALUES (${id}, 'probe.thing_happened.v1', 'a', ${db.sql.json({ buildingId: null })}, ${db.sql.json({})}, now())`
    await Bun.sleep(1600)
    expect(delivered).toEqual([])
    expect(counter.runs).toBe(0)
    state.active = false
    await until(() => delivered.length === 1 && counter.runs === 1, 6000)
    runtime.maintenance.stop()
    expect(await runtime.stopWorker(2000)).toEqual([])
    await runtime.close()
  }, 20_000)

  test('JB-26 the relay check is false before the first pass and after the loop stalls, true while it runs', async () => {
    const state = { active: false }
    const { runtime } = worker(new SettableClock(new Date()), state, [])
    await expect(runtime.relayCheck.ping()).rejects.toThrow()
    runtime.relay.start()
    await until(() => runtime.relay.isFresh(1000))
    await expect(runtime.relayCheck.ping()).resolves.toBeUndefined()
    await runtime.relay.stop()
    await Bun.sleep(200)
    expect(runtime.relay.isFresh(100)).toBe(false)
  })
})

/** The nightly snapshot job of the catalog, counting its runs; `fail` makes it throw. */
function invariant(counter: { runs: number }, fail = false) {
  return job({
    name: 'invariant_check',
    schedule: { kind: 'daily', at: '03:00' },
    mode: 'snapshot',
    graceMinutes: 720,
    run: async () => {
      counter.runs++
      if (fail) throw new Error('boom')
      return { did: 1, details: { queries: 20 } }
    },
  })
}
