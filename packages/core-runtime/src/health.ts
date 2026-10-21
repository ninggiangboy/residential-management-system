import type { TSchema } from '@sinclair/typebox'
import { Elysia, t } from 'elysia'

export interface HealthCheck {
  /** Key in the readiness answer (`database`, `relay`). */
  name: string
  /** Resolves when the dependency answers. */
  ping(): Promise<unknown>
}

export interface HealthOptions {
  /** The database check: always there, because a process without it cannot serve (and the deploy script reads it). */
  database: Pick<HealthCheck, 'ping'>
  /** More dependencies that must answer for the process to count as ready (the relay of the worker). */
  checks?: readonly HealthCheck[]
  maintenance: { readonly active: boolean }
  /** True from the moment shutdown starts: readiness answers 503 `stopping` so the proxy drains the process first. */
  stopping: () => boolean
  /** Per-check timeout (`READINESS_DB_TIMEOUT_MS`). */
  timeoutMs: number
  /** The public path names no dependency (DR-145); the ops port lists every check. */
  exposeChecks: boolean
}

const checkSchema = t.Object({ ok: t.Boolean(), latencyMs: t.Number() })

const readiness = <S extends TSchema>(status: S) =>
  t.Object({
    status,
    maintenance: t.Boolean(),
    checks: t.Optional(t.Record(t.String(), checkSchema)),
  })

const withTimeout = <T>(promise: Promise<T>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** `GET <prefix>/ready` (DOC-51 E-02): 200 `ok`, 503 `degraded` or `stopping`; never the error shape (DOC-42 §6). */
export function readyRoute(options: HealthOptions) {
  const probe = async (check: HealthCheck) => {
    const begin = performance.now()
    const ok = await withTimeout(check.ping(), options.timeoutMs).then(
      () => true,
      () => false,
    )
    return [check.name, { ok, latencyMs: Math.round(performance.now() - begin) }] as const
  }
  return new Elysia({ name: 'health-ready' }).get(
    '/ready',
    async ({ set }) => {
      set.headers['cache-control'] = 'no-store'
      const results = await Promise.all(
        [{ name: 'database', ping: () => options.database.ping() }, ...(options.checks ?? [])].map(
          probe,
        ),
      )
      const stopping = options.stopping()
      const healthy = results.every(([, result]) => result.ok)
      const status = stopping
        ? ('stopping' as const)
        : healthy
          ? ('ok' as const)
          : ('degraded' as const)
      if (status !== 'ok') set.status = 503
      return {
        status,
        maintenance: options.maintenance.active,
        ...(options.exposeChecks ? { checks: Object.fromEntries(results) } : {}),
      }
    },
    {
      detail: {
        summary: 'Readiness',
        description:
          'The process can do its work: the database answers within the timeout. 200 stays during maintenance (`maintenance: true`); 503 `degraded` or `stopping` otherwise.',
      },
      response: {
        200: readiness(t.Literal('ok')),
        503: readiness(t.Union([t.Literal('degraded'), t.Literal('stopping')])),
      },
    },
  )
}

/** `GET /health/live` (DOC-51 E-01): the process is up and its event loop answers. Served on the ops port only. */
export const liveRoute = () =>
  new Elysia({ name: 'health-live' }).get(
    '/live',
    ({ set }) => {
      set.headers['cache-control'] = 'no-store'
      return { status: 'ok' as const }
    },
    {
      detail: { summary: 'Liveness', description: 'The process is alive. Checks no dependency.' },
      response: { 200: t.Object({ status: t.Literal('ok') }) },
    },
  )
