import { type TObject, type TProperties, Type } from '@sinclair/typebox'
import { type Context, Elysia, type ElysiaConfig } from 'elysia'

/**
 * A route plugin of a module (DOC-12 §4.1). `normalize: false` is what makes an unknown key of a body a 400 `unknown_key`:
 * with Elysia's default the key is silently stripped and the schema's `additionalProperties: false` never reports it
 * (DOC-50 §6, AG-20). Every route plugin is created with this, never with `new Elysia(…)`.
 */
export const routePlugin = <const Prefix extends string = ''>(config: ElysiaConfig<Prefix> = {}) =>
  new Elysia({ ...config, normalize: false })

/** A request body that refuses unknown keys (DOC-50 §6). */
export const strictObject = <T extends TProperties>(properties: T): TObject<T> =>
  Type.Object(properties, { additionalProperties: false })

/** The `set` of a route handler (status and headers), for a handler written outside the chain of its route. */
export type RouteSet = Context['set']

/** The path parameter of a route that names one row. */
export const IdParams = strictObject({ id: Type.String({ format: 'uuid' }) })

/** The route metadata of DOC-12 §5.3, as the vendor extension the OpenAPI document carries (DOC-50 §2). */
const routeMeta = (tag: string, audience: object) => ({
  detail: { tags: [tag], 'x-audience': audience },
})

/** A route nobody signs in for; `extra` names what it takes instead (`{ credential: 'refresh_token' }`). */
export const publicRoute = (tag: string, extra: object = {}) =>
  routeMeta(tag, { kind: 'public', ...extra })

/** A staff route: the `staff` guard and the audience from the same `roles`, so the two cannot differ. */
export const staffRoute = <Guard extends object, Role extends string>(
  guards: { staff(roles: readonly Role[]): Guard },
  tag: string,
  roles: readonly Role[],
  extra: object = {},
) => ({ ...guards.staff(roles), ...routeMeta(tag, { kind: 'staff', roles, ...extra }) })

/** A token-only resident route: the `resident` guard and no unit (DOC-12 §5.3). */
export const residentRoute = <Guard extends object>(
  guards: { resident(): Guard },
  tag: string,
) => ({
  ...guards.resident(),
  ...routeMeta(tag, { kind: 'resident' }),
})

/**
 * A route of one unit: the `unit(capability)` guard (token, `X-Unit-Id`, membership, terms gate, policy) and the audience from the
 * same `capability`, so the two cannot differ (DOC-12 §5.3).
 */
export const unitRoute = <Guard extends object, Capability extends string>(
  guards: { unit(capability: Capability): Guard },
  tag: string,
  capability: Capability,
) => ({
  ...guards.unit(capability),
  ...routeMeta(tag, { kind: 'resident', capability }),
})
