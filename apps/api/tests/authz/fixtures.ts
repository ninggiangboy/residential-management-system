import { type Actor, isResident } from './actors'
import type { Scope } from './expected'
import type { RouteRecord } from './route-records'
import { IDS, type World } from './world'

/**
 * The map `parameter → fixture id` per scope and the minimal bodies of DOC-39 §4.5. A parameter or a body missing here stops
 * the run before a request is sent (`missing_fixture`): a 404 for the wrong reason would pass for a refusal.
 */

export class MissingFixture extends Error {}

const missing = (what: string): never => {
  throw new MissingFixture(what)
}

/** The staff actors that belong to B2: their objects are B2's, and B1's are foreign to them. */
const inB2 = (actor: Actor) => actor === 'staff.admin_b2'

/** The finance objects of the building a cell names: `own` objects are B1's and `foreign` ones B2's, for every actor. */
const financeOf = (scope: Scope, world: World) =>
  scope === 'own' ? world.finance.b1 : world.finance.b2

/** The batch routes whose object is a published batch (recall, close, reissue, the PDF job); the others take the draft. */
const PUBLISHED_BATCH_ROUTES = new Set(['E-96', 'E-97', 'E-98', 'E-99', 'E-177'])

/** The charge routes whose object is an open charge (void, the charge PDF); the others (replace, remove) take the draft one. */
const OPEN_CHARGE_ROUTES = new Set(['E-100', 'E-176'])

/** The routes that delete their object: the Manager's cell runs after the Admin's, so it gets a draft of its own. */
const spareFor = (endpoint: string, actor: Actor) =>
  (endpoint === 'E-171' || endpoint === 'E-172') && actor === 'staff.manager'

/**
 * The value of a path parameter. `own` objects are B1's (and U1's), `foreign` ones B2's (U3's); a session or an upload belongs to
 * a person, so its `own` value is the actor's and its `foreign` value is another person's.
 */
export function paramValue(
  route: RouteRecord,
  name: string,
  scope: Scope,
  actor: Actor,
  world: World,
): string {
  const own = scope === 'own'
  const e = route.endpointId
  switch (`${e}:${name}`) {
    case 'E-71:kind':
      return 'unit_owner'
    case 'E-109:kind':
      return 'gateway_event'
    case 'T-01:id': // the probe route of mutant M4 names a unit
      return own ? IDS.U1 : IDS.U3
    case 'E-21:id': {
      const other = actor === 'res.owner' ? 'res.family' : 'res.owner'
      // An actor without a session (anon, a staff token) is refused before the object is read: any session id will do.
      return (
        (own ? world.sessions[actor] : world.sessions[other]) ??
        world.sessions['res.owner'] ??
        missing(`${e} session`)
      )
    }
    case 'E-23:id': // a device token that is nobody's: the answer is 204 for any id, so own and foreign are the same call
    case 'E-35:id':
      return '018f0000-0000-7000-8000-0000000000d1'
    case 'E-178:id': {
      const other = actor === 'res.owner' ? 'res.family' : 'res.owner'
      // An actor refused at a gate never reaches the entry: any entry will do.
      return (
        (own ? world.inbox[actor] : world.inbox[other]) ??
        world.inbox['res.owner'] ??
        missing(`${e} inbox entry`)
      )
    }
    case 'E-179:id': {
      if (own)
        return (
          (inB2(actor) ? world.inbox['staff.admin'] : world.inbox[actor]) ??
          world.inbox['staff.admin'] ??
          missing(`${e} inbox entry`)
        )
      return world.inbox['staff.admin_b2'] ?? missing(`${e} inbox entry of B2`)
    }
    case 'E-33:id': {
      if (own)
        return (
          (inB2(actor) ? world.sessions['staff.admin'] : world.sessions[actor]) ??
          world.sessions['staff.admin'] ??
          missing(`${e} session`)
        )
      return world.sessions['staff.admin_b2'] ?? missing(`${e} session`)
    }
    case 'E-37:id': {
      if (own)
        return (
          (inB2(actor) ? world.files['staff.admin'] : world.files[actor]) ??
          world.files['staff.admin'] ??
          missing(`${e} file`)
        )
      return world.files['staff.admin_b2'] ?? missing(`${e} file of B2`)
    }
  }
  const finance = () => financeOf(scope, world)
  if (route.path.startsWith('/staff/fee-batches/') && name === 'id')
    return PUBLISHED_BATCH_ROUTES.has(e)
      ? finance().publishedBatch
      : spareFor(e, actor)
        ? finance().spareDraftBatch
        : finance().draftBatch
  if (route.path.startsWith('/staff/charges/') && name === 'id')
    return OPEN_CHARGE_ROUTES.has(e)
      ? finance().openCharge
      : spareFor(e, actor)
        ? finance().spareDraftCharge
        : finance().draftCharge
  if (route.path.startsWith('/staff/payments/') && name === 'id') return finance().paymentId
  if (route.path.startsWith('/staff/receipts/') && name === 'id') return finance().receiptId
  if (route.path.startsWith('/staff/money-log/') && name === 'id') return finance().gatewayEvent
  if (route.path.startsWith('/me/receipts/') && name === 'id') return finance().receiptId
  if (route.path.startsWith('/me/fees/') && name === 'chargeId') return finance().openCharge
  if (route.path.startsWith('/staff/accounts/') && name === 'id')
    return own ? IDS.staffTarget : IDS.staffTargetB2
  if (route.path.startsWith('/staff/units/') && name === 'id') return own ? IDS.U1 : IDS.U3
  if (route.path.startsWith('/staff/unit-types/') && name === 'id')
    return own ? IDS.unitTypeB1 : IDS.unitTypeB2
  if (route.path.startsWith('/staff/residents/') && name === 'accountId')
    return own ? (world.accounts['res.owner'] as string) : IDS.residentB2
  if (route.path.startsWith('/staff/memberships/') && name === 'id')
    return own ? (world.memberships['res.owner'] as string) : IDS.membershipB2
  if (route.path.startsWith('/staff/imports/') && name === 'id')
    return own ? IDS.importB1 : IDS.importB2
  return missing(`${e} {${name}}`)
}

type Json = Record<string, unknown>

const CHARGE_LINE = {
  itemName: { vi: 'Phí quản lý' },
  quantity: 1,
  unitPrice: 100000,
  amount: 100000,
}

/** The minimal valid body of a route, where it takes one (the examples of DOC-51). `{}` is the body of a route that validates a shape. */
const BODIES: Record<string, (actor: Actor, scope: Scope, world: World) => Json> = {
  'E-08': (actor) => ({ staffId: inB2(actor) ? IDS.staffTargetB2 : IDS.staffTarget }),
  'E-38': () => ({ action: 'staff_email' }),
  'E-40': () => ({
    fullName: 'Matrix Technician',
    email: `new-${crypto.randomUUID()}@b1.example`,
    role: 'technician',
  }),
  'E-42': () => ({ fullName: 'Renamed By Matrix' }),
  'E-43': () => ({}),
  'E-45': () => ({}),
  'E-48': () => ({}),
  'E-50': () => ({ provider: 'payos' }),
  'E-53': () => ({
    kind: 'terms',
    text: { vi: '## Điều khoản mới\n\nNội dung', en: '## New terms\n\nBody' },
  }),
  'E-58': () => ({ code: `Z-${Math.floor(Math.random() * 90000) + 10000}` }),
  'E-60': () => ({ note: 'Edited by the matrix' }),
  'E-92': () => ({ name: { vi: 'Phí đổi tên' } }),
  'E-94': () => ({ lines: [CHARGE_LINE] }),
  'E-96': () => ({ reason: 'Recalled by the matrix' }),
  'E-100': () => ({ reason: 'Voided by the matrix' }),
  'E-105': () => ({ reason: 'Voided by the matrix' }),
  'E-109': () => ({ note: 'Reviewed by the matrix' }),
  // A unit of the actor's own building with an owner: the unit is read before the batch, so a code of the other building is a 404 `unit_not_found`.
  'E-170': (actor) => ({ unitCode: inB2(actor) ? 'B-0101' : 'A-1508', lines: [CHARGE_LINE] }),
  'E-181': () => ({
    code: `matrix_${Math.floor(Math.random() * 90000) + 10000}`,
    name: { vi: `Loại ${Math.floor(Math.random() * 90000) + 10000}` },
  }),
  'E-182': () => ({ defaultBedrooms: 2 }),
  'E-61': () => ({ phone: '+84903999001', fullName: 'New Owner', reason: 'Matrix transfer' }),
  'E-64': (actor) => ({
    unitId: inB2(actor) ? IDS.U3 : IDS.U1,
    phone: '+84903999002',
    fullName: 'Added By Matrix',
    memberType: 'family',
  }),
  'E-66': () => ({ note: 'Edited by the matrix' }),
  'E-67': () => ({ phone: '+84903999003' }),
  'E-69': () => ({ canPay: true }),
  // A body names its own objects: the file is the actor's, so a 404 here is a defect and never a stranger's id.
  'E-72': (actor, _scope, world) => ({
    kind: 'unit_owner',
    fileId: world.importFiles[actor] ?? world.importFiles['staff.admin'],
  }),
}

/** The body of a call, `undefined` for a route that takes none or whose actor is refused before the body is read. */
function bodyFor(route: RouteRecord, actor: Actor, scope: Scope, world: World): Json | undefined {
  if (route.method === 'GET' || route.method === 'DELETE') return undefined
  const make = BODIES[route.endpointId]
  if (make) return make(actor, scope, world)
  // A public route validates its shape: `{}` is a 400 and never an answer that depends on a body.
  return {}
}

/** The ids of the other scope that a response of this actor must not hold (the leak scan, DOC-39 §4.4). */
export function foreignIds(actor: Actor, world: World): string[] {
  if (isResident(actor)) {
    const others = Object.entries(world.accounts)
      .filter(([a]) => a !== actor && isResident(a as Actor))
      .map(([, id]) => id as string)
    return [IDS.U3, IDS.residentB2, IDS.membershipB2, ...others, ...Object.values(world.finance.b2)]
  }
  if (inB2(actor))
    return [
      IDS.U1,
      IDS.U2,
      IDS.staffTarget,
      IDS.importB1,
      world.accounts['res.owner'] as string,
      world.memberships['res.owner'] as string,
      ...Object.values(world.finance.b1),
    ]
  return [
    IDS.U3,
    IDS.staffTargetB2,
    IDS.importB2,
    IDS.residentB2,
    IDS.membershipB2,
    ...Object.values(world.finance.b2),
  ]
}

/** Builds the request of one cell. */
export function requestOf(route: RouteRecord, actor: Actor, scope: Scope, world: World): Request {
  const path = route.path.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name: string) =>
    paramValue(route, name, scope, actor, world),
  )
  const body = bodyFor(route, actor, scope, world)
  const token = world.tokens[actor]
  return new Request(`http://localhost/api/v1${path}`, {
    method: route.method,
    headers: {
      'x-app-id': 'web',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(isResident(actor) ? { 'x-unit-id': IDS.U1 } : {}),
      ...(route.idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
      ...(route.method !== 'GET' && route.pathParams.length > 0 ? { 'if-match': '"1"' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
