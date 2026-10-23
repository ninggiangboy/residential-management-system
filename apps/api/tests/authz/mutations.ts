import {
  errorHandlerPlugin,
  requestContextPlugin,
  routePlugin,
  staffRoute,
  unitRoute,
} from '@core/http'
import { ForbiddenError, UnauthorizedError } from '@core/kernel'
import { createLogger } from '@core/telemetry'
import type { Guards, StaffRole } from '@rms/shared-types'
import type { ContainerOverrides } from '../../src/bootstrap/container'
import { createGuards } from '../../src/bootstrap/guards'
import { type Cell, runMatrix } from './matrix'
import { mountedApp } from './mounted-app'
import { type RouteRecord, readRoutes } from './route-records'
import { runStepUpPass } from './stepup'
import { IDS, type World } from './world'

/**
 * The baseline of EXP-10 (§3): the same generator run against an application with one guard deliberately defective. A matrix
 * that stays green on these would stay green on a real defect, so a mutant that survives fails the experiment (C7).
 *
 * A mutant that needs a repository without a scope predicate (M4, M5) or a handler that throws (M6) is a probe route of this file
 * built on the guards of the container: the repositories of the modules are not injectable one by one, and the point is that the
 * generator notices the answer, whoever gave it.
 */

export interface MutantResult {
  id: string
  title: string
  expectedReason: string
  caught: boolean
  detail: string
}

interface Mutant {
  id: string
  title: string
  expectedReason: string
  /** Resolves to a description of what the run caught, or `null` when the mutant survived. */
  run(world: World): Promise<string | null>
}

const ALL_STAFF: StaffRole[] = ['admin', 'manager', 'technician', 'guard']
const ADMIN_ONLY = (roles: readonly StaffRole[]) => roles.length === 1 && roles[0] === 'admin'

/** The routes a mutant run uses besides the one it touches: the five of DOC-39 §4.7, as far as they are built (E-03 and E-27 are not yet). */
const SUBSET = ['E-13', 'E-40', 'E-41']

const records = () => readRoutes(mountedApp()).records

const probe = (
  endpointId: string,
  method: string,
  path: string,
  audience: RouteRecord['audience'],
  objectParams: string[] = [],
): RouteRecord => ({
  endpointId,
  method,
  path,
  operationId: endpointId,
  audience,
  idempotent: false,
  stepUp: [],
  pathParams: objectParams,
  objectParams,
  scopeOfObject:
    audience.kind === 'staff' ? 'building' : audience.kind === 'resident' ? 'unit' : 'none',
})

const PROBES = {
  /** M4: finds a unit by id, whatever its building. */
  units: probe(
    'T-01',
    'GET',
    '/probe/staff-units/{id}',
    { kind: 'staff', roles: ['admin', 'manager'] },
    ['id'],
  ),
  /** M5: a list that drops its scope filter. */
  list: probe('T-02', 'GET', '/probe/staff-list', { kind: 'staff', roles: ['admin', 'manager'] }),
  /** M8: a unit route for `pay`. */
  pay: probe('T-03', 'GET', '/probe/me-pay', { kind: 'resident', capability: 'pay' }),
  /** M9, M10: a staff route whose handler needs nothing, so a guard that lets a caller through shows as a 2xx. */
  staff: probe('T-04', 'GET', '/probe/staff-open', { kind: 'staff', roles: ALL_STAFF }),
  /** M2: an admin-only route whose handler does not check the role again (the use cases of the real routes do, DR-254). */
  admin: probe('T-06', 'GET', '/probe/staff-admin', { kind: 'staff', roles: ['admin'] }),
  /** M11: a unit route open to every member. */
  notices: probe('T-05', 'GET', '/probe/me-notices', {
    kind: 'resident',
    capability: 'broadcast_notices',
  }),
}

const info = (r: RouteRecord) => ({ endpoint: r.endpointId, operationId: r.operationId })

/** The app of a mutant run: the real routes and the probe routes, built on the guards of the (possibly defective) container. */
function mountProbes(guards: Guards) {
  const probes = routePlugin({ prefix: '/api/v1' })
    .use(requestContextPlugin)
    .use(errorHandlerPlugin({ logger: createLogger('silent') }))
    // M4: no building predicate, so every id is found.
    .get(
      '/probe/staff-units/:id',
      ({ params }) => ({ unitId: params.id }),
      staffRoute(guards, 'probe', ['admin', 'manager'], info(PROBES.units)),
    )
    // M5: no scope filter, so the list holds the other building's ids too.
    .get(
      '/probe/staff-list',
      () => ({ items: [IDS.U1, IDS.U3, IDS.staffTargetB2] }),
      staffRoute(guards, 'probe', ['admin', 'manager'], info(PROBES.list)),
    )
    .get('/probe/me-pay', () => ({ ok: true }), unitRoute(guards, 'probe', 'pay', info(PROBES.pay)))
    .get(
      '/probe/staff-open',
      () => ({ ok: true }),
      staffRoute(guards, 'probe', ALL_STAFF, info(PROBES.staff)),
    )
    .get(
      '/probe/staff-admin',
      () => ({ ok: true }),
      staffRoute(guards, 'probe', ['admin'], info(PROBES.admin)),
    )
    .get(
      '/probe/me-notices',
      () => ({ ok: true }),
      unitRoute(guards, 'probe', 'broadcast_notices', info(PROBES.notices)),
    )
  return (app: { handle(request: Request): Promise<Response> | Response }) => ({
    handle: (request: Request) =>
      new URL(request.url).pathname.startsWith('/api/v1/probe/')
        ? probes.handle(request)
        : app.handle(request),
  })
}

async function matrixWith(
  world: World,
  routes: RouteRecord[],
  guards?: ContainerOverrides['guards'],
): Promise<Cell[]> {
  const holder: { guards?: Guards } = {}
  const { cells } = await runMatrix(world, routes, {
    overrides: {
      guards: guards
        ? (real, deps) => {
            holder.guards = guards(real, deps)
            return holder.guards
          }
        : undefined,
    },
    mount: (app, container) => mountProbes(holder.guards ?? container.guards)(app),
  })
  return cells
}

const failed = (cells: Cell[], endpointId: string, reason: string, actors: string[]) =>
  actors.every((actor) =>
    cells.some((c) => c.endpointId === endpointId && c.actor === actor && c.reason === reason),
  )

const named = (cells: Cell[], endpointId: string, reason: string) =>
  cells
    .filter((c) => c.endpointId === endpointId && c.reason === reason)
    .map((c) => `${c.actor}/${c.scope}`)
    .join(', ')

const pick = (ids: string[]) => records().filter((r) => ids.includes(r.endpointId))

/** A copy of `guards` where `staff` is replaced. */
const withStaff = (real: Guards, staff: Guards['staff']): Guards => ({ ...real, staff })
const withUnit = (real: Guards, unit: Guards['unit']): Guards => ({ ...real, unit })

const residentToken = (header: string | null) => {
  try {
    const payload = JSON.parse(
      Buffer.from((header ?? '').split('.')[1] ?? '', 'base64url').toString(),
    ) as { kind?: string }
    return payload.kind === 'resident'
  } catch {
    return false
  }
}

export const MUTANTS: Mutant[] = [
  {
    id: 'M1',
    title: "One route's audience metadata removed",
    expectedReason: 'route_without_audience',
    async run() {
      const app = mountedApp()
      const routes = (
        app.routes as unknown as Array<{
          method: string
          path: string
          hooks?: { detail?: Record<string, unknown> }
        }>
      ).map((route) =>
        route.path === '/api/v1/staff/accounts/:id' && route.method === 'GET'
          ? {
              ...route,
              hooks: {
                ...route.hooks,
                detail: { ...route.hooks?.detail, 'x-audience': undefined },
              },
            }
          : route,
      )
      const { problems } = readRoutes({ routes })
      const found = problems.find((p) => p.rule === 'route_without_audience')
      return found ? found.message : null
    },
  },
  {
    id: 'M2',
    title: 'The guard of an admin-only route widened to every staff role, the metadata unchanged',
    expectedReason: 'unexpected_2xx',
    async run(world) {
      // The use cases check the role again, so the guard alone shows only on a route whose handler does not.
      const cells = await matrixWith(world, [PROBES.admin, ...pick(SUBSET)], (real) =>
        withStaff(real, (roles) => real.staff(ADMIN_ONLY(roles) ? ALL_STAFF : roles)),
      )
      return failed(cells, 'T-06', 'unexpected_2xx', ['staff.manager', 'staff.guard'])
        ? `T-06: ${named(cells, 'T-06', 'unexpected_2xx')}`
        : null
    },
  },
  {
    id: 'M3',
    title: 'An admin route answers 403 to an Admin',
    expectedReason: 'unexpected_refusal',
    async run(world) {
      const cells = await matrixWith(world, pick(['E-47', ...SUBSET]), (real) =>
        withStaff(real, (roles) =>
          ADMIN_ONLY(roles)
            ? {
                transform: async (context) => {
                  await real.staff(roles).transform(context)
                  throw new ForbiddenError()
                },
              }
            : real.staff(roles),
        ),
      )
      return failed(cells, 'E-47', 'unexpected_refusal', ['staff.admin'])
        ? `E-47: ${named(cells, 'E-47', 'unexpected_refusal')}`
        : null
    },
  },
  {
    id: 'M4',
    title: 'A handler loads an object by id without the building predicate',
    expectedReason: 'unexpected_2xx',
    async run(world) {
      const cells = await matrixWith(world, [PROBES.units])
      return failed(cells, 'T-01', 'unexpected_2xx', ['staff.admin', 'staff.manager'])
        ? `T-01: ${named(cells, 'T-01', 'unexpected_2xx')}`
        : null
    },
  },
  {
    id: 'M5',
    title: 'A list route drops its scope filter',
    expectedReason: 'leak',
    async run(world) {
      const cells = await matrixWith(world, [PROBES.list])
      return failed(cells, 'T-02', 'leak', ['staff.admin'])
        ? `T-02: ${named(cells, 'T-02', 'leak')}`
        : null
    },
  },
  {
    id: 'M6',
    title: 'A handler throws for the Technician',
    expectedReason: 'server_error',
    async run(world) {
      const cells = await matrixWith(world, pick(['E-30', ...SUBSET]), (real) =>
        withStaff(real, (roles) => ({
          transform: async (context) => {
            await real.staff(roles).transform(context)
            if ((context as { staff?: { role?: string } }).staff?.role === 'technician')
              throw new Error('boom')
          },
        })),
      )
      return failed(cells, 'E-30', 'server_error', ['staff.technician'])
        ? `E-30: ${named(cells, 'E-30', 'server_error')}`
        : null
    },
  },
  {
    id: 'M7',
    title: 'verifyStepUp returns without checking the proof',
    expectedReason: 'unexpected_2xx (step-up cases)',
    async run(world) {
      const { failures } = await runStepUpPass(world, {
        overrides: { stepUp: { verifyStepUp: async () => undefined } },
        variants: ['E-50 gateway'],
      })
      const wrong = failures.filter((c) => ['S1', 'S2', 'S3', 'S5', 'S6', 'S7'].includes(c.id))
      return wrong.length > 0 ? `E-50 gateway: ${wrong.map((c) => c.id).join(', ')}` : null
    },
  },
  {
    id: 'M8',
    title: 'The production capability table lets a tenant without can_pay pay',
    expectedReason: 'unexpected_2xx',
    async run(world) {
      const cells = await matrixWith(world, [PROBES.pay], (real) =>
        withUnit(real, (capability) => real.unit(capability === 'pay' ? 'view_fees' : capability)),
      )
      return failed(cells, 'T-03', 'unexpected_2xx', ['res.tenant_nopay'])
        ? `T-03: ${named(cells, 'T-03', 'unexpected_2xx')}`
        : null
    },
  },
  {
    id: 'M9',
    title: 'The staff guard accepts a resident token',
    expectedReason: 'unexpected_2xx',
    async run(world) {
      const cells = await matrixWith(world, [PROBES.staff], (real) =>
        withStaff(real, (roles) => ({
          transform: async (context) => {
            try {
              await real.staff(roles).transform(context)
            } catch (error) {
              if (
                !(error instanceof UnauthorizedError) ||
                !residentToken(context.request.headers.get('authorization')?.slice(7) ?? null)
              )
                throw error
            }
          },
        })),
      )
      return failed(cells, 'T-04', 'unexpected_2xx', ['res.owner', 'res.helper'])
        ? `T-04: ${named(cells, 'T-04', 'unexpected_2xx')}`
        : null
    },
  },
  {
    id: 'M10',
    title: "A disabled staff member's token is accepted",
    expectedReason: 'unexpected_2xx',
    async run(world) {
      const cells = await matrixWith(world, [PROBES.staff], (_real, deps) =>
        createGuards({
          ...deps,
          identity: {
            getStaff: async (ids) =>
              (await deps.identity.getStaff(ids)).map((row) => ({
                ...row,
                status: 'active' as const,
              })),
          },
        }),
      )
      return failed(cells, 'T-04', 'unexpected_2xx', ['staff.disabled'])
        ? `T-04: ${named(cells, 'T-04', 'unexpected_2xx')}`
        : null
    },
  },
  {
    id: 'M11',
    title: 'A locked membership is treated as active',
    expectedReason: 'unexpected_2xx',
    async run(world) {
      const cells = await matrixWith(world, [PROBES.notices], (_real, deps) =>
        createGuards({
          ...deps,
          residency: {
            getMembership: async (...args) => {
              const row = await deps.residency.getMembership(...args)
              return row && { ...row, status: 'active' as const }
            },
          },
        }),
      )
      return failed(cells, 'T-05', 'unexpected_2xx', ['res.locked'])
        ? `T-05: ${named(cells, 'T-05', 'unexpected_2xx')}`
        : null
    },
  },
]

/** Runs the mutants (or the ones named); a mutant that is not caught is a survivor. */
export async function runMutants(world: World, ids?: readonly string[]): Promise<MutantResult[]> {
  const results: MutantResult[] = []
  for (const mutant of MUTANTS) {
    if (ids && !ids.includes(mutant.id)) continue
    const detail = await mutant.run(world)
    results.push({
      id: mutant.id,
      title: mutant.title,
      expectedReason: mutant.expectedReason,
      caught: detail !== null,
      detail: detail ?? 'the run stayed green',
    })
  }
  return results
}
