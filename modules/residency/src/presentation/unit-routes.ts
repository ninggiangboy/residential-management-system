import {
  describedEnum,
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

const Occupancy = describedEnum(
  {
    occupied: 'The owner lives in the unit',
    rented: 'The unit is let to a tenant',
    vacant: 'Nobody lives in the unit',
  },
  'Who lives in the unit. Set by the manager and never derived from the memberships.',
)
const Nullable = <T extends ReturnType<typeof Type.String> | ReturnType<typeof Type.Integer>>(
  schema: T,
) => Type.Union([schema, Type.Null()])

const Code = (required: boolean) =>
  Type.String({
    maxLength: 64,
    description: `The unit code, letters, digits and \`. _ / -\`, at most 20 characters, stored upper-case${required ? '' : '. Cannot be cleared'}`,
  })
const Floor = Type.Optional(
  Nullable(Type.Integer({ description: 'The floor, −5…150. `null` clears it' })),
)
const Bedrooms = Type.Optional(
  Nullable(Type.Integer({ description: 'The number of bedrooms, 0…20. `null` clears it' })),
)
const AreaM2 = Type.Optional(
  Nullable(
    Type.String({
      maxLength: 16,
      description:
        'The area in square metres as a decimal string above 0, at most `"2000"` with 2 decimals. `null` clears it',
    }),
  ),
)
const UnitNote = Type.Optional(
  Nullable(
    Type.String({
      maxLength: 2000,
      description: 'A note of the manager, at most 500 characters. `null` clears it',
    }),
  ),
)
const CursorParam = Type.Optional(
  Type.String({
    maxLength: 300,
    description:
      'The `next` cursor of the previous page. Opaque; one that does not decode is 400 `invalid_cursor`',
  }),
)
const CreateBody = strictObject({
  code: Code(true),
  floor: Floor,
  bedrooms: Bedrooms,
  areaM2: AreaM2,
  occupancy: Type.Optional(Occupancy),
  note: UnitNote,
})
const UpdateBody = strictObject({
  code: Type.Optional(Code(false)),
  floor: Floor,
  bedrooms: Bedrooms,
  areaM2: AreaM2,
  occupancy: Type.Optional(Occupancy),
  note: UnitNote,
})
const TransferBody = strictObject({
  phone: Type.String({
    maxLength: 40,
    description:
      'The phone of the new owner, Vietnamese or international. An invalid one is 400 `phone_invalid`',
  }),
  fullName: Type.String({
    maxLength: 200,
    description:
      'The name of the new owner for the building record. An existing account keeps its own name',
  }),
  keepMembers: Type.Optional(
    Type.Boolean({
      description:
        '`true` removes only the old owner and keeps the other members (default `false`)',
    }),
  ),
  reason: Type.String({
    maxLength: 2000,
    description: 'Why the ownership changes, 5…500 characters',
  }),
})
const ListQuery = strictObject({
  q: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 100,
      description:
        'Searches by unit code prefix (at least 2 characters, exact match first). A search returns at most 20 rows and no cursor',
    }),
  ),
  occupancy: Type.Optional(Occupancy),
  floor: Type.Optional(Type.String({ maxLength: 8, description: 'Only this floor, −5…150' })),
  bedrooms: Type.Optional(
    Type.String({ maxLength: 8, description: 'Only units with this number of bedrooms, 0…20' }),
  ),
  cursor: CursorParam,
  limit: Type.Optional(
    Type.String({ maxLength: 8, description: 'Rows per page, 1…200 (default 50)' }),
  ),
})
const HistoryQuery = strictObject({
  cursor: CursorParam,
  limit: Type.Optional(
    Type.String({ maxLength: 8, description: 'Rows per page, 1…100 (default 50)' }),
  ),
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
    .get('/', list, {
      ...read({
        endpoint: 'E-57',
        operationId: 'listUnits',
        summary: 'List units',
        description:
          'The unit list and search, with filters and cursor pagination, used by the units page and the unit pickers.',
      }),
      query: ListQuery,
    })
    .post('/', d.idempotent({ account: staffAccount }, create), {
      ...staffRoute(d.guards, 'residency', CREATE_UNIT_ROLES, {
        endpoint: 'E-58',
        operationId: 'createUnit',
        summary: 'Create a unit',
        description:
          'Adds one unit by hand. A unit is never deleted; a unit made by mistake is set `vacant`. Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: CreateBody,
    })
    .get('/:id', get, {
      ...read({
        endpoint: 'E-59',
        operationId: 'getUnit',
        summary: 'Get a unit',
        description:
          'The unit, its owner, its members and the open debt in one answer. The `ETag` is the value to send back as `If-Match` when editing the unit or transferring its ownership.',
      }),
      params: IdParams,
    })
    .patch('/:id', update, {
      ...staffRoute(d.guards, 'residency', UPDATE_UNIT_ROLES, {
        endpoint: 'E-60',
        operationId: 'updateUnit',
        summary: 'Update a unit',
        description:
          'Edits the code, floor, bedrooms, area, occupancy or note. `occupancy` is set by the manager and never derived from memberships. Needs `If-Match`.',
      }),
      params: IdParams,
      body: UpdateBody,
    })
    .post('/:id/owner', transfer, {
      ...staffRoute(d.guards, 'residency', TRANSFER_OWNERSHIP_ROLES, {
        endpoint: 'E-61',
        operationId: 'transferOwnership',
        summary: 'Transfer the ownership of a unit',
        description:
          'Transfers the ownership to a person given by phone. In one transaction it removes the old owner and, unless `keepMembers` is set, the other members, promotes or inserts the new owner, and writes the unit history, the events and the audit row. Needs `If-Match`.',
      }),
      params: IdParams,
      body: TransferBody,
    })
    .get('/:id/history', history, {
      ...read({
        endpoint: 'E-62',
        operationId: 'listUnitHistory',
        summary: 'List the history of a unit',
        description: 'Who owned or lived in the unit and when, newest first.',
      }),
      params: IdParams,
      query: HistoryQuery,
    })
}
