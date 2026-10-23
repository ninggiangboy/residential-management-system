import { describe, expect, test } from 'bun:test'
import { STAFF_ROLES } from '@rms/shared-types'
import { Elysia } from 'elysia'
import { ACTORS, type Actor, STAFF_ROLE_OF } from './actors'
import { type Expected, expected, hasForeignCell, type Scope } from './expected'
import { MissingFixture, paramValue } from './fixtures'
import { type RouteRecord, readRoutes } from './route-records'
import type { World } from './world'

/**
 * The pure parts of the generator (no database): `expected()` on pinned rows (SC-02), a route without audience (SC-01), a path
 * parameter without a fixture (SC-13), and the completeness of the list of actors (EXP-10 §10).
 */

const route = (
  over: Partial<RouteRecord> & Pick<RouteRecord, 'endpointId' | 'audience'>,
): RouteRecord => ({
  method: 'GET',
  path: '/x',
  operationId: 'x',
  idempotent: false,
  stepUp: [],
  pathParams: [],
  objectParams: [],
  scopeOfObject: 'none',
  ...over,
})

const E03 = route({ endpointId: 'E-03', audience: { kind: 'public' } })
const E13 = route({ endpointId: 'E-13', audience: { kind: 'resident' } })
const E27 = route({
  endpointId: 'E-27',
  method: 'POST',
  audience: { kind: 'resident', capability: 'manage_members' },
  scopeOfObject: 'unit',
})
const E28 = route({
  endpointId: 'E-28',
  method: 'PATCH',
  path: '/me/members/{id}',
  audience: { kind: 'resident', capability: 'manage_members' },
  scopeOfObject: 'unit',
  pathParams: ['id'],
  objectParams: ['id'],
})
const E40 = route({
  endpointId: 'E-40',
  method: 'POST',
  audience: { kind: 'staff', roles: ['admin', 'manager'] },
  scopeOfObject: 'building',
  stepUp: ['admin_change'],
  idempotent: true,
})
const E41 = route({
  endpointId: 'E-41',
  path: '/staff/accounts/{id}',
  audience: { kind: 'staff', roles: ['admin', 'manager'] },
  scopeOfObject: 'building',
  pathParams: ['id'],
  objectParams: ['id'],
})
const E50 = route({
  endpointId: 'E-50',
  method: 'PUT',
  audience: { kind: 'staff', roles: ['admin'] },
  scopeOfObject: 'building',
  stepUp: ['gateway_config'],
})
const E21 = route({
  endpointId: 'E-21',
  method: 'DELETE',
  path: '/me/sessions/{id}',
  audience: { kind: 'resident' },
  scopeOfObject: 'account',
  pathParams: ['id'],
  objectParams: ['id'],
})
const E117 = route({
  endpointId: 'E-117',
  method: 'POST',
  audience: { kind: 'webhook', provider: 'payos' },
})

const A = 'ALLOW'
/** The table of DOC-39 §4.7, cell by cell: `[route, actor, scope, expected]`. */
const PINNED: Array<[RouteRecord, Actor, Scope, Expected]> = [
  ...(
    [
      'anon',
      'res.owner',
      'res.helper',
      'res.locked',
      'res.terms_pending',
      'staff.admin',
      'staff.manager',
      'staff.guard',
      'staff.admin_b2',
    ] as const
  ).map((actor): [RouteRecord, Actor, Scope, Expected] => [E03, actor, 'own', A]),
  [E13, 'anon', 'own', '401 unauthenticated'],
  [E13, 'tok.expired', 'own', '401 unauthenticated'],
  [E13, 'res.owner', 'own', A],
  [E13, 'res.helper', 'own', A],
  [E13, 'res.locked', 'own', A],
  [E13, 'res.terms_pending', 'own', A],
  [E13, 'staff.admin', 'own', '401 unauthenticated'],
  [E13, 'staff.guard', 'own', '401 unauthenticated'],
  [E27, 'anon', 'own', '401 unauthenticated'],
  [E27, 'res.owner', 'own', A],
  [E27, 'res.family', 'own', '403 forbidden'],
  [E27, 'res.tenant_pay', 'own', '403 forbidden'],
  [E27, 'res.helper', 'own', '403 forbidden'],
  [E27, 'res.locked', 'own', '403 membership_inactive'],
  [E27, 'res.stranger', 'own', '403 membership_inactive'],
  [E27, 'res.terms_pending', 'own', '403 terms_required'],
  [E28, 'res.owner', 'own', A],
  [E28, 'res.owner', 'foreign', '404 not_found'],
  [E28, 'res.helper', 'own', '403 forbidden'],
  [E27, 'staff.admin', 'own', '401 unauthenticated'],
  [E40, 'anon', 'own', '401 unauthenticated'],
  [E40, 'res.owner', 'own', '401 unauthenticated'],
  [E40, 'staff.admin', 'own', A],
  [E40, 'staff.manager', 'own', A],
  [E40, 'staff.technician', 'own', '403 forbidden'],
  [E40, 'staff.guard', 'own', '403 forbidden'],
  [E40, 'staff.disabled', 'own', '401 unauthenticated'],
  [E40, 'staff.admin_b2', 'own', A],
  [E41, 'anon', 'own', '401 unauthenticated'],
  [E41, 'staff.admin', 'own', A],
  [E41, 'staff.admin', 'foreign', '404 not_found'],
  [E41, 'staff.manager', 'foreign', '404 not_found'],
  [E41, 'staff.guard', 'own', '403 forbidden'],
  [E41, 'staff.admin_b2', 'own', '404 not_found'],
  [E41, 'staff.admin_b2', 'foreign', A],
  [E50, 'staff.admin', 'own', '403 step_up_required'],
  [E50, 'staff.manager', 'own', '403 forbidden'],
  [E117, 'anon', 'own', '401 invalid_signature'],
  [E117, 'staff.admin', 'own', '401 invalid_signature'],
  [E21, 'res.owner', 'own', A],
  [E21, 'res.owner', 'foreign', '404 not_found'],
]

/** Elysia types `detail` as an OpenAPI operation; the vendor extensions of DOC-50 §2 are not in that type. */
const meta = (detail: Record<string, unknown>) => detail as never

describe('expected()', () => {
  test('SC-02 pinned rows equal the table of DOC-39 §4.4 and §4.7', () => {
    expect(PINNED.length).toBeGreaterThanOrEqual(40)
    for (const [r, actor, scope, want] of PINNED)
      expect([r.endpointId, actor, scope, expected(r, actor, scope)]).toEqual([
        r.endpointId,
        actor,
        scope,
        want,
      ])
  })

  test('SC-02 the capability copy answers the 40 resident cells of DOC-27 §3.2', () => {
    const owners = [
      'res.owner',
      'res.family',
      'res.tenant_pay',
      'res.tenant_nopay',
      'res.helper',
    ] as const
    const rows: Record<string, boolean[]> = {
      broadcast_notices: [true, true, true, true, true],
      personal_notifications: [true, true, true, true, false],
      view_fees: [true, true, true, true, false],
      pay: [true, true, true, false, false],
      tickets: [true, true, true, true, false],
      vehicles: [true, true, true, true, false],
      library: [true, true, true, true, false],
      manage_members: [true, false, false, false, false],
    }
    for (const [capability, truth] of Object.entries(rows))
      owners.forEach((actor, i) => {
        const r = route({
          endpointId: `T-${capability}`,
          audience: { kind: 'resident', capability },
          scopeOfObject: 'unit',
        })
        expect([capability, actor, expected(r, actor, 'own')]).toEqual([
          capability,
          actor,
          truth[i] ? A : '403 forbidden',
        ])
      })
  })

  test('a foreign cell exists only for an actor that passes the gate of an object route or a list', () => {
    expect(hasForeignCell(E41, 'staff.guard')).toBe(false)
    expect(hasForeignCell(E41, 'staff.admin')).toBe(true)
    expect(hasForeignCell(E41, 'staff.admin_b2')).toBe(true)
    expect(hasForeignCell(E40, 'staff.admin')).toBe(false)
    expect(hasForeignCell(E27, 'res.helper')).toBe(false)
    expect(hasForeignCell(E27, 'res.owner')).toBe(false)
    expect(hasForeignCell(E28, 'res.owner')).toBe(true)
    expect(hasForeignCell(E28, 'res.helper')).toBe(false)
    expect(hasForeignCell(E03, 'anon')).toBe(false)
  })
})

describe('the generator reads routes before it sends a request', () => {
  const plugin = new Elysia({ prefix: '/api/v1' })
    .get('/open', () => 'ok', {
      detail: meta({
        'x-audience': { kind: 'public' },
        'x-endpoint-id': 'E-03',
        operationId: 'getPublicConfig',
      }),
    })
    .get('/forgotten', () => 'ok')

  test('SC-01 a route lacking audience is named and the read reports it', () => {
    const { records, problems } = readRoutes(plugin)
    expect(records.map((r) => r.endpointId)).toEqual(['E-03'])
    expect(problems).toEqual([
      expect.objectContaining({ rule: 'route_without_audience', route: 'GET /forgotten' }),
    ])
  })

  test('AG-01 a staff route that lists no role, and an endpoint id declared twice, are problems', () => {
    const twice = new Elysia({ prefix: '/api/v1' })
      .get('/a', () => 1, {
        detail: meta({
          'x-audience': { kind: 'staff', roles: [] },
          'x-endpoint-id': 'E-41',
          operationId: 'a',
        }),
      })
      .get('/b', () => 1, {
        detail: meta({
          'x-audience': { kind: 'public' },
          'x-endpoint-id': 'E-03',
          operationId: 'b',
        }),
      })
      .get('/c', () => 1, {
        detail: meta({
          'x-audience': { kind: 'public' },
          'x-endpoint-id': 'E-03',
          operationId: 'c',
        }),
      })
    expect(
      readRoutes(twice)
        .problems.map((p) => p.rule)
        .sort(),
    ).toEqual(['duplicate_endpoint_id', 'staff_route_without_roles'])
  })

  test('SC-13 a path parameter without a fixture stops the run and names it', () => {
    const lonely = route({
      endpointId: 'E-999',
      path: '/staff/gadgets/{gadgetId}',
      pathParams: ['gadgetId'],
      objectParams: ['gadgetId'],
      audience: { kind: 'staff', roles: ['admin'] },
    })
    expect(() => paramValue(lonely, 'gadgetId', 'own', 'staff.admin', {} as World)).toThrow(
      MissingFixture,
    )
    expect(() => paramValue(lonely, 'gadgetId', 'own', 'staff.admin', {} as World)).toThrow(
      '{gadgetId}',
    )
  })
})

describe('the actors', () => {
  test('there are sixteen, and every staff role has one', () => {
    expect(ACTORS).toHaveLength(16)
    for (const role of STAFF_ROLES) expect(Object.values(STAFF_ROLE_OF)).toContain(role)
  })
})
