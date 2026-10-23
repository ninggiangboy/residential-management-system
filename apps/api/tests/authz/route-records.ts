import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { StaffRole } from '@rms/shared-types'

/**
 * What the authorization-matrix generator reads (DOC-39 §4.1, EXP-10 §5 step 1): the routes of the mounted `App` joined with the
 * metadata the route helpers of `@core/http` put on each of them, and the catalog of DOC-51 §2. The same checks run as
 * `bun run check:authz-metadata` (AG-01, AG-02), before any request is sent.
 */

type Audience =
  | { kind: 'public'; credential?: string }
  | { kind: 'resident'; capability?: string }
  | { kind: 'staff'; roles: StaffRole[]; byPurpose?: true }
  | { kind: 'webhook'; provider: string }

/** What the object a path names belongs to (DOC-39 §4.1): a unit, the building, the caller's own account, or nothing. */
type ObjectScope = 'unit' | 'building' | 'account' | 'none'

export interface RouteRecord {
  endpointId: string
  method: string
  /** Relative to `/api/v1`, in the `{name}` notation of DOC-51. */
  path: string
  operationId: string
  audience: Audience
  idempotent: boolean
  stepUp: string[]
  pathParams: string[]
  /** The path parameters that name an object of a unit or a building (`{kind}` of a template names none). */
  objectParams: string[]
  scopeOfObject: ObjectScope
}

export interface RouteProblem {
  rule:
    | 'route_without_audience'
    | 'route_without_endpoint_id'
    | 'duplicate_endpoint_id'
    | 'not_in_catalog'
    | 'catalog_mismatch'
    | 'staff_route_without_roles'
  endpointId?: string
  route: string
  message: string
}

export interface CatalogEntry {
  endpointId: string
  method: string
  path: string
  operationId: string
  audience: string
  idempotent: boolean
  stepUp: string
}

/** The documentation pages are hidden routes and carry no metadata. */
const HIDDEN = new Set(['/api/v1/docs', '/api/v1/openapi.json'])

interface MountedRoute {
  method: string
  path: string
  hooks?: { detail?: Record<string, unknown> }
}

const API_PREFIX = '/api/v1'
const ALL_STAFF: StaffRole[] = ['admin', 'manager', 'technician', 'guard']

const relativePath = (path: string) => {
  const rest = path.startsWith(API_PREFIX) ? path.slice(API_PREFIX.length) : path
  const trimmed = rest.length > 1 && rest.endsWith('/') ? rest.slice(0, -1) : rest
  return trimmed.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
}

/** Path parameters that select a kind of document, not an object that belongs to a building. */
const NON_OBJECT_PARAMS = new Set(['kind'])

const scopeOf = (audience: Audience, pathParams: string[]): ObjectScope => {
  if (audience.kind === 'staff') return 'building'
  if (audience.kind === 'resident')
    return audience.capability ? 'unit' : pathParams.length > 0 ? 'account' : 'none'
  return 'none'
}

/** The record of one mounted route, or the problem that stops the run: a route without metadata never gets a request. */
function recordOf(route: MountedRoute): RouteRecord | RouteProblem {
  const name = `${route.method} ${relativePath(route.path)}`
  const detail = route.hooks?.detail ?? {}
  const audience = detail['x-audience'] as Audience | undefined
  if (!audience || typeof audience !== 'object' || !('kind' in audience))
    return { rule: 'route_without_audience', route: name, message: `${name} declares no audience` }
  const endpointId = detail['x-endpoint-id'] as string | undefined
  if (!endpointId)
    return {
      rule: 'route_without_endpoint_id',
      route: name,
      message: `${name} declares no endpoint id (x-endpoint-id)`,
    }
  if (audience.kind === 'staff' && (!Array.isArray(audience.roles) || audience.roles.length === 0))
    return {
      rule: 'staff_route_without_roles',
      endpointId,
      route: name,
      message: `${endpointId} ${name} is a staff route and lists no role`,
    }
  const path = relativePath(route.path)
  const pathParams = [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1] as string)
  const objectParams = pathParams.filter((name) => !NON_OBJECT_PARAMS.has(name))
  const stepUp = detail['x-step-up']
  return {
    endpointId,
    method: route.method,
    path,
    operationId: detail.operationId as string,
    audience,
    idempotent: detail['x-idempotent'] === true,
    stepUp:
      stepUp === undefined ? [] : Array.isArray(stepUp) ? (stepUp as string[]) : [String(stepUp)],
    pathParams,
    objectParams,
    scopeOfObject: scopeOf(audience, objectParams),
  }
}

const isProblem = (value: RouteRecord | RouteProblem): value is RouteProblem => 'rule' in value

/** Every route of the app joined with its metadata; problems are returned beside the records, never thrown. */
export function readRoutes(app: { routes: readonly unknown[] }): {
  records: RouteRecord[]
  problems: RouteProblem[]
} {
  const records: RouteRecord[] = []
  const problems: RouteProblem[] = []
  for (const route of app.routes as MountedRoute[]) {
    if (HIDDEN.has(route.path) || route.method === 'OPTIONS') continue
    const record = recordOf(route)
    if (isProblem(record)) problems.push(record)
    else records.push(record)
  }
  const seen = new Map<string, RouteRecord>()
  for (const record of records) {
    const first = seen.get(record.endpointId)
    if (first)
      problems.push({
        rule: 'duplicate_endpoint_id',
        endpointId: record.endpointId,
        route: `${record.method} ${record.path}`,
        message: `${record.endpointId} is declared by ${first.method} ${first.path} and ${record.method} ${record.path}`,
      })
    else seen.set(record.endpointId, record)
  }
  records.sort((a, b) => a.endpointId.localeCompare(b.endpointId, 'en', { numeric: true }))
  return { records, problems }
}

const CATALOG_PATH = resolve(import.meta.dir, '../../../../docs/07-api/api-endpoints.md')

/** The rows of DOC-51 §2.1 and §2.2 (the columns differ: §2.2 has no step-up column). */
export function readCatalog(source = readFileSync(CATALOG_PATH, 'utf8')): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  const section = source.slice(source.indexOf('## 2. Catalog'), source.indexOf('\n## 3.'))
  let columns: string[] = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells[0] === 'ID') {
      columns = cells
      continue
    }
    const first = cells[0] ?? ''
    if (!/^E-\d+$/.test(first)) continue
    const at = (name: string) => cells[columns.indexOf(name)] ?? ''
    const [method, path] = at('Method and path').replaceAll('`', '').split(' ')
    entries.push({
      endpointId: first,
      method: method ?? '',
      path: path ?? '',
      operationId: at('`operationId`').replaceAll('`', ''),
      audience: at('Audience'),
      idempotent: at('Idem') === 'R',
      stepUp: at('Step-up'),
    })
  }
  return entries
}

/** The audience of a catalog row as the metadata would state it, for the comparison of AG-02. */
function catalogAudience(text: string): Audience | { kind: 'other'; text: string } {
  const staff = /^staff: (.*)$/.exec(text)
  if (staff) {
    const list = (staff[1] ?? '').split(' (')[0] ?? ''
    if (list.startsWith('by purpose')) return { kind: 'staff', roles: ALL_STAFF, byPurpose: true }
    const roles = list === 'any' ? ALL_STAFF : (list.split(',').map((r) => r.trim()) as StaffRole[])
    return { kind: 'staff', roles }
  }
  if (text.startsWith('public')) return { kind: 'public' }
  if (text === 'refresh') return { kind: 'public', credential: 'refresh_token' }
  if (text === 'resident') return { kind: 'resident' }
  const unit = /^unit: (\w+)/.exec(text)
  if (unit && unit[1] !== 'by') return { kind: 'resident', capability: unit[1] }
  if (text.startsWith('unit: by purpose')) return { kind: 'resident' }
  return { kind: 'other', text }
}

const sameRoles = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** AG-01 and AG-02: the declared metadata equals the catalog row of the same endpoint id. */
export function compareWithCatalog(
  records: readonly RouteRecord[],
  catalog: readonly CatalogEntry[],
): RouteProblem[] {
  const byId = new Map(catalog.map((entry) => [entry.endpointId, entry]))
  const problems: RouteProblem[] = []
  for (const record of records) {
    const route = `${record.method} ${record.path}`
    const entry = byId.get(record.endpointId)
    if (!entry) {
      problems.push({
        rule: 'not_in_catalog',
        endpointId: record.endpointId,
        route,
        message: `${record.endpointId} ${route} is not in the catalog of DOC-51 §2`,
      })
      continue
    }
    const mismatch = (what: string, declared: unknown, catalogued: unknown) =>
      problems.push({
        rule: 'catalog_mismatch',
        endpointId: record.endpointId,
        route,
        message: `${record.endpointId}: ${what} is ${JSON.stringify(declared)}, the catalog says ${JSON.stringify(catalogued)}`,
      })
    if (entry.method !== record.method || entry.path !== record.path)
      mismatch('the route', route, `${entry.method} ${entry.path}`)
    if (entry.operationId !== record.operationId)
      mismatch('operationId', record.operationId, entry.operationId)
    if (entry.idempotent !== record.idempotent)
      mismatch('idempotent', record.idempotent, entry.idempotent)
    if ((entry.stepUp !== '') !== record.stepUp.length > 0)
      mismatch('stepUp', record.stepUp, entry.stepUp)
    const expected = catalogAudience(entry.audience)
    if (expected.kind === 'other') continue
    const declared = record.audience
    const same =
      declared.kind === expected.kind &&
      (declared.kind !== 'staff' ||
        (expected.kind === 'staff' && sameRoles(declared.roles, expected.roles))) &&
      (declared.kind !== 'resident' ||
        (expected.kind === 'resident' && declared.capability === expected.capability)) &&
      (declared.kind !== 'public' ||
        (expected.kind === 'public' &&
          (declared.credential ?? null) === (expected.credential ?? null)))
    if (!same) mismatch('audience', declared, expected)
  }
  return problems
}

/** `catalogParity` of EXP-10 §6: catalog entries that are not mounted and mounted routes that are not catalogued. */
export function catalogParity(records: readonly RouteRecord[], catalog: readonly CatalogEntry[]) {
  const mounted = new Set(records.map((r) => r.endpointId))
  const catalogued = new Set(catalog.map((e) => e.endpointId))
  return {
    extra: [...mounted].filter((id) => !catalogued.has(id)),
    /** Catalog entries of the phase-1 groups that are not mounted: informational, they are built by later tasks. */
    missing: [...catalogued].filter((id) => !mounted.has(id)),
  }
}
