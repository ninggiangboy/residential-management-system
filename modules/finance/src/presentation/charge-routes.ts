import {
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
  ADD_DRAFT_CHARGE_ROLES,
  type AddDraftCharge,
} from '../application/use-cases/add-draft-charge'
import {
  REMOVE_DRAFT_CHARGE_ROLES,
  type RemoveDraftCharge,
} from '../application/use-cases/remove-draft-charge'
import {
  REPLACE_DRAFT_CHARGE_ROLES,
  type ReplaceDraftCharge,
} from '../application/use-cases/replace-draft-charge'
import { VOID_CHARGE_ROLES, type VoidCharge } from '../application/use-cases/void-charge'
import { chargeBody } from './bodies'
import { quoted, versionOf } from './http'

export interface ChargeRouteDeps {
  addDraftCharge: AddDraftCharge
  replaceDraftCharge: ReplaceDraftCharge
  removeDraftCharge: RemoveDraftCharge
  voidCharge: VoidCharge
  guards: Guards
  idempotent: Idempotent
}

const Line = Type.Object(
  {
    kind: Type.Optional(
      Type.Union([Type.Literal('fee'), Type.Literal('adjustment')], {
        description: '`fee` (the default) or `adjustment`; an adjustment needs a `note`',
      }),
    ),
    itemName: Type.Object(
      {
        vi: Type.String({ maxLength: 200, description: 'The item in Vietnamese, required' }),
        en: Type.Optional(Type.String({ maxLength: 200, description: 'The item in English' })),
      },
      { additionalProperties: false, description: 'The name of the item in both languages' },
    ),
    quantity: Type.Optional(
      Type.Union([Type.String(), Type.Number()], {
        description: 'The quantity, up to 3 decimals; 1 when absent',
      }),
    ),
    unitPrice: Type.Optional(Type.Integer({ description: 'The price of one, in đồng' })),
    amount: Type.Optional(
      Type.Integer({
        description: 'The amount in đồng; it must equal quantity × price when both are sent',
      }),
    ),
    note: Type.Optional(
      Type.Union([
        Type.String({ maxLength: 500, description: 'A note, required for an adjustment' }),
        Type.Null(),
      ]),
    ),
  },
  { additionalProperties: false, description: 'One line of a charge (DOC-21 §3.2)' },
)
const Lines = Type.Array(Line, {
  description: 'The lines of the charge, in order; their sum must be above zero',
})
const AddBody = strictObject(
  {
    unitCode: Type.String({ maxLength: 64, description: 'The code of the unit that owes' }),
    lines: Lines,
  },
  { description: 'The charge to add to the draft (DOC-21 §3.2)' },
)
const ReplaceBody = strictObject(
  { lines: Lines },
  { description: 'The new lines of the draft charge' },
)
const VoidBody = strictObject(
  {
    reason: Type.String({
      maxLength: 1000,
      description: 'Why the charge is voided, 5 to 500 characters',
    }),
  },
  { description: 'The reason of the void (DOC-21 §3.9)' },
)

/** E-94, E-100, E-170 and E-171: the charges of a batch (DOC-21 §3.2, §3.9, P2-15). */
export function chargeRoutes(d: ChargeRouteDeps) {
  const version = (context: { request: Request }) =>
    versionOf(context.request.headers.get('if-match'))

  const add = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof AddBody>
    set: RouteSet
  }) => {
    const charge = await d.addDraftCharge.execute(staffOf(context), context.params.id, context.body)
    context.set.status = 201
    context.set.headers.etag = quoted(charge.version)
    return chargeBody(charge)
  }

  const replace = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof ReplaceBody>
    request: Request
    set: RouteSet
  }) => {
    const charge = await d.replaceDraftCharge.execute(staffOf(context), context.params.id, {
      lines: context.body.lines,
      version: version(context),
    })
    context.set.headers.etag = quoted(charge.version)
    return chargeBody(charge)
  }

  const remove = async (context: {
    params: Static<typeof IdParams>
    request: Request
    set: RouteSet
  }) => {
    await d.removeDraftCharge.execute(staffOf(context), context.params.id, version(context))
    context.set.status = 204
  }

  const voidIt = async (context: {
    params: Static<typeof IdParams>
    body: Static<typeof VoidBody>
    request: Request
    set: RouteSet
  }) => {
    const out = await d.voidCharge.execute(staffOf(context), context.params.id, {
      reason: context.body.reason,
      version: version(context),
    })
    context.set.headers.etag = quoted(out.charge.version)
    return chargeBody(out.charge)
  }

  return routePlugin({ prefix: '/staff' })
    .post('/fee-batches/:id/charges', add, {
      ...staffRoute(d.guards, 'finance', ADD_DRAFT_CHARGE_ROLES, {
        endpoint: 'E-170',
        operationId: 'addDraftCharge',
        summary: 'Add a charge to a draft batch',
        description:
          'Adds the charge of one unit, found by its code, to a draft batch. 404 `unit_not_found`, 422 `unit_without_owner`, 409 `charge_exists` or `invalid_transition` write nothing.',
      }),
      params: IdParams,
      body: AddBody,
    })
    .put('/charges/:id', replace, {
      ...staffRoute(d.guards, 'finance', REPLACE_DRAFT_CHARGE_ROLES, {
        endpoint: 'E-94',
        operationId: 'replaceDraftCharge',
        summary: 'Replace the lines of a draft charge',
        description:
          'Replaces all lines of a charge of a draft batch under the rules of an imported row. Needs `If-Match` with the charge version.',
      }),
      params: IdParams,
      body: ReplaceBody,
    })
    .delete('/charges/:id', remove, {
      ...staffRoute(d.guards, 'finance', REMOVE_DRAFT_CHARGE_ROLES, {
        endpoint: 'E-171',
        operationId: 'removeDraftCharge',
        summary: 'Remove a draft charge',
        description:
          'Deletes a charge of a draft batch with its lines. Needs `If-Match` with the charge version.',
      }),
      params: IdParams,
    })
    .post('/charges/:id/void', voidIt, {
      ...staffRoute(d.guards, 'finance', VOID_CHARGE_ROLES, {
        endpoint: 'E-100',
        operationId: 'voidCharge',
        summary: 'Void one open charge',
        description:
          'Voids a single open charge with a reason and cancels the payment links that hold it. A paid charge is 409 `charge_not_voidable`. Needs `If-Match` with the charge version.',
      }),
      params: IdParams,
      body: VoidBody,
    })
}
