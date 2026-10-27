import { Kind, type TObject, type TProperties, Type } from '@sinclair/typebox'
import { type Context, Elysia, type ElysiaConfig } from 'elysia'

/**
 * A route plugin of a module (DOC-12 §4.1). `normalize: false` is what makes an unknown key of a body a 400 `unknown_key`:
 * with Elysia's default the key is silently stripped and the schema's `additionalProperties: false` never reports it
 * (DOC-50 §6, AG-20). Every route plugin is created with this, never with `new Elysia(…)`.
 */
export const routePlugin = <const Prefix extends string = ''>(config: ElysiaConfig<Prefix> = {}) =>
  new Elysia({ ...config, normalize: false })

/**
 * A string that is one of the keys of `values`, with what each value means. The OpenAPI document carries the `enum` (a list to
 * choose from in the API reference), the meanings in `x-enumDescriptions` and again as a Markdown list in `description`, for
 * the readers that ignore the extension. The type is the union of the keys, as with `Type.Union` of `Type.Literal`.
 *
 * It is Elysia's `UnionEnum` kind and not a union of literals on purpose: the OpenAPI plugin rewrites a union of literals to a
 * bare `enum` and drops its `description` and extensions. `t.UnionEnum` itself adds a `default`, which would fill a missing key.
 */
export const describedEnum = <const Values extends Record<string, string>>(
  values: Values,
  description?: string,
) => {
  const list = Object.entries(values)
    .map(([value, meaning]) => `- \`${value}\`: ${meaning}`)
    .join('\n')
  return Type.Unsafe<Extract<keyof Values, string>>({
    [Kind]: 'UnionEnum',
    type: 'string',
    enum: Object.keys(values),
    description: description ? `${description}\n\n${list}` : list,
    'x-enumDescriptions': values,
  })
}

/** A request body that refuses unknown keys (DOC-50 §6). */
export const strictObject = <T extends TProperties>(
  properties: T,
  options: { description?: string } = {},
): TObject<T> => Type.Object(properties, { ...options, additionalProperties: false })

/** The `set` of a route handler (status and headers), for a handler written outside the chain of its route. */
export type RouteSet = Context['set']

/** The path parameter of a route that names one row. */
export const IdParams = strictObject({
  id: Type.String({ format: 'uuid', description: 'The id of the record in the path' }),
})

/**
 * What a route says about itself beyond its guard (DOC-50 §2, DOC-39 §4.1): the catalog number and `operationId` of DOC-51 §2, which
 * the authorization-matrix generator joins with the audience, and the flags the catalog marks (`R`, step-up). `byPurpose` and
 * `credential` stay inside the audience: they name how the gate decides, not a second endpoint property.
 */
export interface RouteInfo {
  /** `E-57`: the number in DOC-51 §2 (AG-02 compares the mounted routes with the catalog). */
  endpoint: string
  operationId: string
  /** The name of the endpoint in the docs: one line, in the imperative (`List units`). */
  summary: string
  /** What the endpoint does beyond its name: who calls it, what it changes, what it refuses. Markdown. */
  description?: string
  /** `Idempotency-Key` is required (the `R` of the catalog). */
  idempotent?: true
  /** The step-up actions the route may demand (DOC-26 §4.5), one or several. */
  stepUp?: string | readonly string[]
  /** The roles are checked by purpose inside the use case (DOC-37 §4). */
  byPurpose?: true
  /** A credential other than a token (`refresh_token`). */
  credential?: string
}

/** The route metadata of DOC-12 §5.3, as the vendor extensions the OpenAPI document carries (DOC-50 §2). */
const routeMeta = (tag: string, audience: object, info: RouteInfo) => {
  const { endpoint, operationId, summary, description, idempotent, stepUp, byPurpose, credential } =
    info
  return {
    detail: {
      tags: [tag],
      operationId,
      summary,
      ...(description ? { description } : {}),
      'x-endpoint-id': endpoint,
      'x-audience': {
        ...audience,
        ...(byPurpose ? { byPurpose } : {}),
        ...(credential ? { credential } : {}),
      },
      ...(idempotent ? { 'x-idempotent': true } : {}),
      ...(stepUp ? { 'x-step-up': stepUp } : {}),
    },
  }
}

/** A route nobody signs in for; `info.credential` names what it takes instead (`refresh_token`). */
export const publicRoute = (tag: string, info: RouteInfo) =>
  routeMeta(tag, { kind: 'public' }, info)

/** A staff route: the `staff` guard and the audience from the same `roles`, so the two cannot differ. */
export const staffRoute = <Guard extends object, Role extends string>(
  guards: { staff(roles: readonly Role[]): Guard },
  tag: string,
  roles: readonly Role[],
  info: RouteInfo,
) => ({ ...guards.staff(roles), ...routeMeta(tag, { kind: 'staff', roles }, info) })

/** A token-only resident route: the `resident` guard and no unit (DOC-12 §5.3). */
export const residentRoute = <Guard extends object>(
  guards: { resident(): Guard },
  tag: string,
  info: RouteInfo,
) => ({
  ...guards.resident(),
  ...routeMeta(tag, { kind: 'resident' }, info),
})

/**
 * A route of one unit: the `unit(capability)` guard (token, `X-Unit-Id`, membership, terms gate, policy) and the audience from the
 * same `capability`, so the two cannot differ (DOC-12 §5.3).
 */
export const unitRoute = <Guard extends object, Capability extends string>(
  guards: { unit(capability: Capability): Guard },
  tag: string,
  capability: Capability,
  info: RouteInfo,
) => ({
  ...guards.unit(capability),
  ...routeMeta(tag, { kind: 'resident', capability }, info),
})
