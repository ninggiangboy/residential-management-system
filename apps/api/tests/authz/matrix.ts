import { createHash } from 'node:crypto'
import { cloneDatabase } from '@rms/test-support'
import type { ContainerOverrides } from '../../src/bootstrap/container'
import { ACTORS, type Actor } from './actors'
import {
  codeOf,
  type Expected,
  expected,
  hasForeignCell,
  isAllow,
  type Scope,
  statusOf,
} from './expected'
import { foreignIds, MissingFixture, requestOf } from './fixtures'
import type { RouteRecord } from './route-records'
import { appOver, type World } from './world'

/** The reasons a cell fails the run (EXP-10 §6). */
type Reason = 'unexpected_2xx' | 'unexpected_refusal' | 'wrong_refusal' | 'server_error' | 'leak'

export interface Cell {
  endpointId: string
  method: string
  path: string
  actor: Actor
  scope: Scope
  expected: Expected
  status: number
  code: string | null
  ok: boolean
  reason?: Reason
  detail?: string
}

/** DOC-39 §4.4: `ALLOW` is a 2xx, or a business answer of the use case on a minimal valid request. */
const BUSINESS = new Set([400, 409, 412, 422, 428])

const allowedStatus = (status: number, route: RouteRecord) =>
  (status >= 200 && status < 300) ||
  BUSINESS.has(status) ||
  // A route that takes a credential other than a token (`refresh_token`) answers 401 when the credential is missing.
  (route.audience.kind === 'public' && route.audience.credential !== undefined && status === 401)

async function codeIn(res: Response): Promise<{ code: string | null; text: string }> {
  const text = await res.text()
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string } }
    return { code: parsed.error?.code ?? null, text }
  } catch {
    return { code: null, text }
  }
}

interface Handler {
  handle(request: Request): Promise<Response> | Response
}

/** One cell: send the request and judge the answer against `expected`. */
async function runCell(
  app: Handler,
  route: RouteRecord,
  actor: Actor,
  scope: Scope,
  world: World,
  want: Expected = expected(route, actor, scope),
): Promise<Cell> {
  const res = await app.handle(requestOf(route, actor, scope, world))
  const { code, text } = await codeIn(res)
  const cell: Cell = {
    endpointId: route.endpointId,
    method: route.method,
    path: route.path,
    actor,
    scope,
    expected: want,
    status: res.status,
    code,
    ok: true,
  }
  const fail = (reason: Reason, detail?: string) =>
    Object.assign(cell, { ok: false, reason, detail })
  if (res.status >= 500) return fail('server_error', text.slice(0, 300))
  if (isAllow(want)) {
    if (!allowedStatus(res.status, route))
      return fail('unexpected_refusal', `${res.status} ${code ?? ''}`)
    if (route.method === 'GET' && res.status >= 200 && res.status < 300) {
      const leaked = foreignIds(actor, world).find((id) => text.includes(id))
      if (leaked) return fail('leak', `the body holds ${leaked}`)
    }
    return cell
  }
  if (res.status >= 200 && res.status < 400) return fail('unexpected_2xx', `${res.status}`)
  if (res.status !== statusOf(want) || code !== codeOf(want))
    return fail('wrong_refusal', `got ${res.status} ${code ?? ''}`)
  return cell
}

/** The cells of a route in the order of EXP-10 §5 step 4: the refusals first, then the `ALLOW` cells. */
function cellsOf(route: RouteRecord): Array<{ actor: Actor; scope: Scope }> {
  const cells: Array<{ actor: Actor; scope: Scope }> = ACTORS.map((actor) => ({
    actor,
    scope: 'own' as const,
  }))
  for (const actor of ACTORS)
    if (hasForeignCell(route, actor)) cells.push({ actor, scope: 'foreign' })
  const refusal = (c: { actor: Actor; scope: Scope }) => !isAllow(expected(route, c.actor, c.scope))
  return [...cells.filter(refusal), ...cells.filter((c) => !refusal(c))]
}

export interface RunOptions {
  /** The seam of DR-99: the mutants of EXP-10 §3 replace one guard or repository here. */
  overrides?: ContainerOverrides
  /** Wraps the app of one route's clone: a mutant that changes a guard sits here. */
  mount?: (
    app: ReturnType<typeof appOver>['app'],
    container: ReturnType<typeof appOver>['container'],
  ) => Handler
}

/** Runs every route against a clone of the world made for it, so a route that changes data never changes what the next one sees. */
export async function runMatrix(
  world: World,
  routes: readonly RouteRecord[],
  options: RunOptions = {},
): Promise<{ cells: Cell[]; missingFixtures: string[] }> {
  const cells: Cell[] = []
  const missingFixtures: string[] = []
  for (const route of routes) {
    // The fixtures are checked before the first request of the route (EXP-10 §5 step 1).
    try {
      for (const { actor, scope } of cellsOf(route)) requestOf(route, actor, scope, world)
    } catch (error) {
      if (!(error instanceof MissingFixture)) throw error
      missingFixtures.push(error.message)
      continue
    }
    const clone = await cloneDatabase(world.db)
    const { app, container } = appOver(clone.url, options.overrides)
    const target = options.mount ? options.mount(app, container) : app
    try {
      for (const { actor, scope } of cellsOf(route))
        cells.push(await runCell(target, route, actor, scope, world))
    } finally {
      await container.close()
      await clone.drop()
    }
  }
  return { cells, missingFixtures }
}

export interface Metrics {
  routes: number
  cellsOwn: number
  cellsForeign: number
  unexpected2xx: number
  unexpectedRefusals: number
  wrongRefusals: number
  serverErrors: number
  leaks: number
  missingFixtures: number
  matrixSha256: string
}

const count = (cells: readonly Cell[], reason: Reason) =>
  cells.filter((c) => c.reason === reason).length

export function metricsOf(
  cells: readonly Cell[],
  routes: number,
  missingFixtures: string[],
): Metrics {
  // The hash covers what a run decides, never a timestamp or an id of a row it created (EXP-10 H8).
  const stable = cells.map(({ endpointId, actor, scope, expected: e, status, code }) => [
    endpointId,
    actor,
    scope,
    e,
    status,
    code,
  ])
  return {
    routes,
    cellsOwn: cells.filter((c) => c.scope === 'own').length,
    cellsForeign: cells.filter((c) => c.scope === 'foreign').length,
    unexpected2xx: count(cells, 'unexpected_2xx'),
    unexpectedRefusals: count(cells, 'unexpected_refusal'),
    wrongRefusals: count(cells, 'wrong_refusal'),
    serverErrors: count(cells, 'server_error'),
    leaks: count(cells, 'leak'),
    missingFixtures: missingFixtures.length,
    matrixSha256: createHash('sha256').update(JSON.stringify(stable)).digest('hex'),
  }
}
