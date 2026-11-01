import {
  describedEnum,
  type Idempotent,
  IdParams,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import {
  UNIT_TYPE_READ_ROLES,
  type UnitTypeQueries,
} from '../application/queries/unit-type-queries'
import { unitTypeBody } from '../application/unit-type-body'
import {
  CREATE_UNIT_TYPE_ROLES,
  type CreateUnitType,
} from '../application/use-cases/create-unit-type'
import {
  UPDATE_UNIT_TYPE_ROLES,
  type UpdateUnitType,
} from '../application/use-cases/update-unit-type'
import type { UnitTypeCreateInput, UnitTypeEdit } from '../domain/unit-type'
import { quoted, staffAccount, versionOf } from './http'

export interface UnitTypeRouteDeps {
  unitTypeQueries: UnitTypeQueries
  createUnitType: CreateUnitType
  updateUnitType: UpdateUnitType
  guards: Guards
  idempotent: Idempotent
}

const Status = describedEnum(
  {
    active: 'The type is offered for new units',
    archived: 'The type is kept on its units and offered nowhere new',
  },
  'Whether the unit type is in use. An archive is reversible; a type is never deleted.',
)
const Nullable = <T extends ReturnType<typeof Type.String> | ReturnType<typeof Type.Integer>>(
  schema: T,
) => Type.Union([schema, Type.Null()])

const Code = Type.String({
  maxLength: 64,
  description:
    'The stable key of the type: lower-case letters, digits and `_`, 2 to 30 characters, starting with a letter. Never edited afterwards',
})
const NameVi = Type.String({ maxLength: 200, description: 'The Vietnamese name, 1…60 characters' })
const NameEn = Nullable(
  Type.String({
    maxLength: 200,
    description: 'The English name, 1…60 characters. `null` clears it',
  }),
)
const DefaultBedrooms = Type.Optional(
  Nullable(
    Type.Integer({
      description: 'The bedrooms a new unit of this type takes, 0…20. `null` means no default',
    }),
  ),
)
const DefaultAreaM2 = Type.Optional(
  Nullable(
    Type.String({
      maxLength: 16,
      description:
        'The area in square metres a new unit of this type takes, a decimal string above 0, at most `"2000"` with 2 decimals. `null` means no default',
    }),
  ),
)
const CreateBody = strictObject({
  code: Code,
  name: strictObject(
    { vi: NameVi, en: Type.Optional(NameEn) },
    { description: 'The bilingual name: `vi` is required, `en` is optional' },
  ),
  defaultBedrooms: DefaultBedrooms,
  defaultAreaM2: DefaultAreaM2,
})
const UpdateBody = strictObject({
  name: Type.Optional(
    strictObject(
      { vi: Type.Optional(NameVi), en: Type.Optional(NameEn) },
      { description: 'The names to change; a name left out is kept' },
    ),
  ),
  defaultBedrooms: DefaultBedrooms,
  defaultAreaM2: DefaultAreaM2,
  status: Type.Optional(Status),
})
const ListQuery = strictObject({
  status: Type.Optional(Status),
})

/** A body with an `undefined` key is the same as one without it; `null` is a value. */
const defined = <T extends object>(body: T): T =>
  Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)) as T

/**
 * `/staff/unit-types` (E-180…E-182; DOC-27 §4.3, DR-314, DR-315): the list with unit counts, the create and the edit that also
 * archives and restores. Every handler is the call of a use case or a query service and holds no rule.
 */
export function unitTypeRoutes(d: UnitTypeRouteDeps) {
  const list = (context: { query: Static<typeof ListQuery> }) =>
    d.unitTypeQueries.list(staffOf(context), context.query.status)

  const create = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    const unitType = await d.createUnitType.execute(
      staffOf(context),
      defined(context.body) as UnitTypeCreateInput,
    )
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/unit-types/${unitType.id}`
    context.set.headers.etag = quoted(unitType.version)
    return unitTypeBody(unitType)
  }

  const update = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof UpdateBody>
    request: Request
    set: RouteSet
  }) => {
    const { unitType, unitCount } = await d.updateUnitType.execute(
      staffOf(context),
      context.params.id,
      {
        edit: defined(context.body) as UnitTypeEdit,
        version: versionOf(context.request.headers.get('if-match')),
      },
    )
    context.set.headers.etag = quoted(unitType.version)
    return unitTypeBody(unitType, unitCount)
  }

  return routePlugin({ prefix: '/staff/unit-types' })
    .get('/', list, {
      ...staffRoute(d.guards, 'residency', UNIT_TYPE_READ_ROLES, {
        endpoint: 'E-180',
        operationId: 'listUnitTypes',
        summary: 'List unit types',
        description:
          'The unit types of the building with the number of units of each, ordered by Vietnamese name, and the summary of the building. At most 50 types, so there is no cursor.',
      }),
      query: ListQuery,
    })
    .post('/', d.idempotent({ account: staffAccount }, create), {
      ...staffRoute(d.guards, 'residency', CREATE_UNIT_TYPE_ROLES, {
        endpoint: 'E-181',
        operationId: 'createUnitType',
        summary: 'Create a unit type',
        description:
          'Adds a kind of unit (apartment, studio, duplex…) with an optional default number of bedrooms and area for new units. A type is never deleted. Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: CreateBody,
    })
    .patch('/:id', update, {
      ...staffRoute(d.guards, 'residency', UPDATE_UNIT_TYPE_ROLES, {
        endpoint: 'E-182',
        operationId: 'updateUnitType',
        summary: 'Update a unit type',
        description:
          'Renames a type, changes its defaults, archives it or restores it. The code cannot change and a default changes no existing unit. Needs `If-Match`.',
      }),
      params: IdParams,
      body: UpdateBody,
    })
}
