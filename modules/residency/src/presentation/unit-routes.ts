import {
  type Idempotent,
  IdParams,
  type RouteInfo,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { ValidationError } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import { UNIT_READ_ROLES, type UnitQueries } from '../application/queries/unit-queries'
import { unitBody } from '../application/unit-body'
import {
  CREATE_UNIT_ROLES,
  type CreateUnit,
  type CreateUnitInput,
} from '../application/use-cases/create-unit'
import {
  TRANSFER_OWNERSHIP_ROLES,
  type TransferOwnership,
} from '../application/use-cases/transfer-ownership'
import { UPDATE_UNIT_ROLES, type UpdateUnit } from '../application/use-cases/update-unit'
import type { UnitEdit } from '../domain/unit'
import { decodeCursor, encodeCursor, quoted, staffAccount, versionOf, wholeParam } from './http'

export interface UnitRouteDeps {
  unitQueries: UnitQueries
  createUnit: CreateUnit
  updateUnit: UpdateUnit
  transferOwnership: TransferOwnership
  guards: Guards
  idempotent: Idempotent
}

const Occupancy = Type.Union([
  Type.Literal('occupied'),
  Type.Literal('rented'),
  Type.Literal('vacant'),
])
const Nullable = <T extends ReturnType<typeof Type.String> | ReturnType<typeof Type.Integer>>(
  schema: T,
) => Type.Union([schema, Type.Null()])

const CreateBody = strictObject({
  code: Type.String({ maxLength: 64 }),
  floor: Type.Optional(Nullable(Type.Integer())),
  bedrooms: Type.Optional(Nullable(Type.Integer())),
  areaM2: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
  occupancy: Type.Optional(Occupancy),
  note: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
})
const UpdateBody = strictObject({
  code: Type.Optional(Type.String({ maxLength: 64 })),
  floor: Type.Optional(Nullable(Type.Integer())),
  bedrooms: Type.Optional(Nullable(Type.Integer())),
  areaM2: Type.Optional(Nullable(Type.String({ maxLength: 16 }))),
  occupancy: Type.Optional(Occupancy),
  note: Type.Optional(Nullable(Type.String({ maxLength: 2000 }))),
})
const TransferBody = strictObject({
  phone: Type.String({ maxLength: 40 }),
  fullName: Type.String({ maxLength: 200 }),
  keepMembers: Type.Optional(Type.Boolean()),
  reason: Type.String({ maxLength: 2000 }),
})
const ListQuery = strictObject({
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  occupancy: Type.Optional(Occupancy),
  floor: Type.Optional(Type.String({ maxLength: 8 })),
  bedrooms: Type.Optional(Type.String({ maxLength: 8 })),
  cursor: Type.Optional(Type.String({ maxLength: 300 })),
  limit: Type.Optional(Type.String({ maxLength: 8 })),
})
const HistoryQuery = strictObject({
  cursor: Type.Optional(Type.String({ maxLength: 300 })),
  limit: Type.Optional(Type.String({ maxLength: 8 })),
})

/** A body with an `undefined` key is the same as one without it; `null` is a value. */
const defined = <T extends object>(body: T): T =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as T

/**
 * `/staff/units` (E-57…E-62; DOC-27 §4, §7, §10): the list and search, the detail with its `ETag`, the create and the edit, the
 * ownership transfer and the history. Every handler is the call of a use case or a query service and holds no rule.
 */
export function unitRoutes(d: UnitRouteDeps) {
  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const { q, occupancy, cursor } = context.query
    const limit = wholeParam('limit', context.query.limit, 1, 200) ?? 50
    const key = cursor === undefined ? undefined : decodeCursor(cursor, ['c', 'i'] as const)
    const page = await d.unitQueries.list(staffOf(context), {
      q,
      occupancy,
      floor: wholeParam('floor', context.query.floor, -5, 150),
      bedrooms: wholeParam('bedrooms', context.query.bedrooms, 0, 20),
      after: key && { code: key.c, id: key.i },
      limit,
    })
    return {
      items: page.items,
      nextCursor: page.next ? encodeCursor({ c: page.next.code, i: page.next.id }) : null,
      summary: page.summary,
    }
  }

  const create = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    const unit = await d.createUnit.execute(
      staffOf(context),
      defined(context.body) as CreateUnitInput,
    )
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/units/${unit.id}`
    context.set.headers.etag = quoted(unit.version)
    return unitBody(unit)
  }

  /**
   * The `ETag` is the unit's `version`, the value an edit sends back as `If-Match`. It is not a validator of the whole answer: the
   * owner, the members and the debt change without moving it, so `If-None-Match` is never answered 304 (a browser that cached the
   * first answer would show a stale household, P1-16).
   */
  const get = async (context: { params: Static<typeof IdParams>; set: RouteSet }) => {
    const { version, ...detail } = await d.unitQueries.get(staffOf(context), context.params.id)
    context.set.headers.etag = quoted(version)
    context.set.headers['cache-control'] = 'private, no-cache'
    return { ...detail, version }
  }

  const update = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof UpdateBody>
    request: Request
    set: RouteSet
  }) => {
    const unit = await d.updateUnit.execute(staffOf(context), context.params.id, {
      edit: defined(context.body) as UnitEdit,
      version: versionOf(context.request.headers.get('if-match')),
    })
    context.set.headers.etag = quoted(unit.version)
    return unitBody(unit)
  }

  const transfer = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof TransferBody>
    request: Request
    set: RouteSet
  }) => {
    const { previousOwnerMembershipId: _previous, ...result } = await d.transferOwnership.execute(
      staffOf(context),
      context.params.id,
      {
        ...context.body,
        keepMembers: context.body.keepMembers ?? false,
        version: versionOf(context.request.headers.get('if-match')),
      },
    )
    context.set.headers.etag = quoted(result.unit.version)
    return result
  }

  const history = async (context: {
    params: Static<typeof IdParams>
    query: Static<typeof HistoryQuery>
  }) => {
    const { cursor } = context.query
    const limit = wholeParam('limit', context.query.limit, 1, 100) ?? 50
    const after = cursor === undefined ? undefined : decodeCursor(cursor, ['t', 'i'] as const)
    const date = after === undefined ? undefined : new Date(after.t)
    if (date !== undefined && Number.isNaN(date.getTime()))
      throw new ValidationError([], 'invalid_cursor', 'The cursor is not valid')
    const page = await d.unitQueries.history(staffOf(context), context.params.id, {
      after: after === undefined || date === undefined ? undefined : { at: date, id: after.i },
      limit,
    })
    return {
      items: page.items,
      nextCursor: page.next
        ? encodeCursor({ t: page.next.at.toISOString(), i: page.next.id })
        : null,
    }
  }

  const read = (info: RouteInfo) => staffRoute(d.guards, 'residency', UNIT_READ_ROLES, info)

  return routePlugin({ prefix: '/staff/units' })
    .get('/', list, { ...read({ endpoint: 'E-57', operationId: 'listUnits' }), query: ListQuery })
    .post('/', d.idempotent({ account: staffAccount }, create), {
      ...staffRoute(d.guards, 'residency', CREATE_UNIT_ROLES, {
        endpoint: 'E-58',
        operationId: 'createUnit',
        idempotent: true,
      }),
      body: CreateBody,
    })
    .get('/:id', get, {
      ...read({ endpoint: 'E-59', operationId: 'getUnit' }),
      params: IdParams,
    })
    .patch('/:id', update, {
      ...staffRoute(d.guards, 'residency', UPDATE_UNIT_ROLES, {
        endpoint: 'E-60',
        operationId: 'updateUnit',
      }),
      params: IdParams,
      body: UpdateBody,
    })
    .post('/:id/owner', transfer, {
      ...staffRoute(d.guards, 'residency', TRANSFER_OWNERSHIP_ROLES, {
        endpoint: 'E-61',
        operationId: 'transferOwnership',
      }),
      params: IdParams,
      body: TransferBody,
    })
    .get('/:id/history', history, {
      ...read({ endpoint: 'E-62', operationId: 'listUnitHistory' }),
      params: IdParams,
      query: HistoryQuery,
    })
}
