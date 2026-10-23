import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ACTORS, isResident, isStaff } from './actors'
import { type Cell, metricsOf, runMatrix } from './matrix'
import { mountedApp } from './mounted-app'
import { writeArtifacts } from './report'
import {
  catalogParity,
  compareWithCatalog,
  type RouteRecord,
  readCatalog,
  readRoutes,
} from './route-records'
import { buildWorld, type World } from './world'

/**
 * EXP-10, first version (DOC-99, P1-15): every mounted route called as every actor on every scope, 0 unexpected 2xx, 0 unexpected
 * refusals, 0 5xx, 0 leaks. `AUTHZ_ROUTES=E-27,E-40` runs a subset. The artifacts are written to `tests/authz/out/`.
 */

const only = process.env.AUTHZ_ROUTES?.split(',').map((id) => id.trim())
const { records: mounted, problems } = readRoutes(mountedApp())
const routes: RouteRecord[] = only ? mounted.filter((r) => only.includes(r.endpointId)) : mounted
const catalog = readCatalog()

let world: World
let cells: Cell[] = []
let missingFixtures: string[] = []

beforeAll(async () => {
  world = await buildWorld()
  ;({ cells, missingFixtures } = await runMatrix(world, routes))
  writeArtifacts(routes, cells)
}, 300_000)
afterAll(async () => {
  await world?.db.drop()
})

const failures = (reason: Cell['reason']) =>
  cells
    .filter((c) => c.reason === reason)
    .map((c) => `${c.endpointId} ${c.actor}/${c.scope}: ${c.detail ?? c.status}`)

describe('the routes', () => {
  test('AG-01 every mounted route declares its audience and an endpoint id; ids are unique and the staff routes list roles', () => {
    expect(problems.map((p) => p.message)).toEqual([])
  })

  test('AG-02 the metadata of every route equals its row of DOC-51 §2, and no mounted route is missing from the catalog', () => {
    expect(compareWithCatalog(mounted, catalog).map((p) => p.message)).toEqual([])
    expect(catalogParity(mounted, catalog).extra).toEqual([])
  })
})

describe('the matrix on the implemented endpoints', () => {
  test('SC-03 0 unexpected 2xx, 0 unexpected refusals, 0 wrong refusals, 0 5xx, 0 leaks, 0 missing fixtures', () => {
    expect(missingFixtures).toEqual([])
    const metrics = metricsOf(cells, routes.length, missingFixtures)
    expect({
      unexpected2xx: failures('unexpected_2xx'),
      unexpectedRefusals: failures('unexpected_refusal'),
      wrongRefusals: failures('wrong_refusal'),
      serverErrors: failures('server_error'),
      leaks: failures('leak'),
    }).toEqual({
      unexpected2xx: [],
      unexpectedRefusals: [],
      wrongRefusals: [],
      serverErrors: [],
      leaks: [],
    })
    expect(metrics.cellsOwn).toBe(routes.length * ACTORS.length)
  })

  test('SC-06 a permitted actor on foreign objects of every object route is 404 not_found, never 200 or 403', () => {
    const foreign = cells.filter((c) => c.scope === 'foreign' && c.expected === '404 not_found')
    if (!only) expect(foreign.length).toBeGreaterThan(40)
    for (const cell of foreign)
      expect([cell.endpointId, cell.actor, cell.status, cell.code]).toEqual([
        cell.endpointId,
        cell.actor,
        404,
        'not_found',
      ])
  })

  test('SC-07 the list routes as staff.admin_b2 answer 200 and the body holds none of the ids of B1', () => {
    const lists = routes.filter(
      (r) =>
        r.method === 'GET' &&
        r.audience.kind === 'staff' &&
        r.objectParams.length === 0 &&
        r.audience.roles.includes('admin'),
    )
    for (const route of lists) {
      const own = cells.find(
        (c) =>
          c.endpointId === route.endpointId && c.actor === 'staff.admin_b2' && c.scope === 'own',
      )
      expect([route.endpointId, own?.status]).toEqual([route.endpointId, 200])
      expect(own?.ok).toBe(true)
    }
  })

  test('SC-08 a step-up route, as staff.admin without stepUp and as staff.manager', () => {
    const gateway = routes.find((r) => r.endpointId === 'E-50')
    if (!gateway) return
    const answer = (actor: string) =>
      cells.find((c) => c.endpointId === 'E-50' && c.actor === actor && c.scope === 'own')
    expect([answer('staff.admin')?.status, answer('staff.admin')?.code]).toEqual([
      403,
      'step_up_required',
    ])
    expect([answer('staff.manager')?.status, answer('staff.manager')?.code]).toEqual([
      403,
      'forbidden',
    ])
  })

  test('SC-09 every staff route with each resident token and every resident route with each staff token is refused', () => {
    // A token of the wrong kind is 401 `unauthenticated`, not 403: the guards check `kind` first (RM-03, AU-41).
    for (const cell of cells) {
      const route = routes.find((r) => r.endpointId === cell.endpointId)
      if (!route || cell.scope !== 'own') continue
      const wrongKind =
        (route.audience.kind === 'staff' && isResident(cell.actor)) ||
        (route.audience.kind === 'resident' && isStaff(cell.actor))
      if (wrongKind)
        expect([cell.endpointId, cell.actor, cell.status, cell.code]).toEqual([
          cell.endpointId,
          cell.actor,
          401,
          'unauthenticated',
        ])
    }
  })

  test('C6 every unexpected cell is named in authz-matrix.md; the file is written', async () => {
    const text = await Bun.file(new URL('./out/authz-matrix.md', import.meta.url)).text()
    expect(text).toContain('# Authorization matrix')
    for (const cell of cells.filter((c) => !c.ok)) expect(text).toContain(`${cell.endpointId}`)
  })
})
