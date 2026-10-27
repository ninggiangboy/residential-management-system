import {
  API_PREFIX,
  describedEnum,
  type RouteInfo,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
import { ValidationError, VersionConflictError } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { BuildingDocument } from '../application/building-document'
import {
  type BuildingQueries,
  GET_GATEWAY_ROLES,
  GET_SETTINGS_ROLES,
  LIST_TERMS_ROLES,
} from '../application/queries/building-queries'
import { PUBLISH_TERMS_ROLES, type PublishTerms } from '../application/use-cases/publish-terms'
import { RESET_DEMO_ROLES, type ResetDemo } from '../application/use-cases/reset-demo'
import {
  SAVE_GATEWAY_CONFIG_ROLES,
  type SaveGatewayConfig,
} from '../application/use-cases/save-gateway-config'
import {
  UPDATE_BUILDING_SETTINGS_ROLES,
  type UpdateBuildingSettings,
} from '../application/use-cases/update-building-settings'
import { SettingsUpdateSchema, type TermsKind } from '../contracts'

/** The names of the staff members who published a version: `identity` owns them, the composition root passes the forwarder. */
export interface StaffNames {
  names(staffIds: readonly string[]): Promise<Record<string, string>>
}

export interface BuildingRouteDeps {
  queries: BuildingQueries
  updateBuildingSettings: UpdateBuildingSettings
  saveGatewayConfig: SaveGatewayConfig
  publishTerms: PublishTerms
  resetDemo: ResetDemo
  staffNames: StaffNames
  guards: Guards
}

const quoted = (value: string | number) => `"${value}"`

/** The document of E-47 without its `etag`, which travels as a header. */
const documentBody = ({ etag: _etag, ...body }: BuildingDocument) => body

/** `If-Match: "3"` of E-50 → `3`; a header that is not a whole number cannot match any version. */
function versionOf(header: string | null): number | undefined {
  if (header === null) return undefined
  const match = /^"?(\d+)"?$/.exec(header.trim())
  if (!match) throw new VersionConflictError()
  return Number(match[1])
}

const ReceivingAccountBody = strictObject(
  {
    bankBin: Type.String({ description: 'The bank identification number, six digits' }),
    accountNumber: Type.String({ description: 'The account number, 6…20 digits' }),
    accountName: Type.String({
      description: 'The account holder, 1…50 upper-case ASCII letters, digits and spaces',
    }),
  },
  { description: 'The bank account that receives the payments. Required on create' },
)

const GatewayBody = strictObject({
  provider: describedEnum(
    { payos: 'payOS', vietqr: 'VietQR' },
    'The payment provider this configuration is for. One active configuration exists per provider.',
  ),
  driver: Type.Optional(
    describedEnum(
      {
        payos: 'Calls the payOS API',
        vietqr: 'Builds VietQR transfer codes',
        fake: 'A test driver that always answers ok; only for a demo building',
      },
      'The code that talks to the provider. Required on create and when the driver changes.',
    ),
  ),
  status: Type.Optional(
    describedEnum(
      { active: 'The configuration is used', disabled: 'The configuration is kept but not used' },
      'Defaults to `active` on create and to the stored value afterwards.',
    ),
  ),
  receivingAccount: Type.Optional(ReceivingAccountBody),
  secrets: Type.Optional(
    Type.Record(Type.String(), Type.String({ minLength: 1, maxLength: 512 }), {
      description:
        'The fields the driver needs (`clientId`, `apiKey`, `checksumKey` for `payos`). A field present replaces the stored one; a field absent keeps it. Required on create and with a new driver',
    }),
  ),
  stepUp: Type.Optional(
    strictObject(
      {
        password: Type.String({
          minLength: 1,
          maxLength: 128,
          description: 'The password of the signed-in admin',
        }),
        code: Type.String({
          pattern: '^[0-9]{6}$',
          description: 'The six-digit code mailed by `requestStepUp` for `gateway_config`',
        }),
      },
      {
        description:
          'The proof of a sensitive action. Required, even to re-save an unchanged configuration',
      },
    ),
  ),
})

const TermsKindSchema = describedEnum(
  { terms: 'The terms of use', privacy: 'The privacy notice' },
  'Which document.',
)

const TermsQuery = strictObject({ kind: Type.Optional(TermsKindSchema) })

const TermsBody = strictObject({
  kind: TermsKindSchema,
  text: strictObject(
    {
      vi: Type.String({ minLength: 1, maxLength: 100_000, description: 'The Vietnamese text' }),
      en: Type.Optional(
        Type.String({ minLength: 1, maxLength: 100_000, description: 'The English text' }),
      ),
    },
    { description: 'The text of the new version' },
  ),
})

/**
 * `/staff/settings`, `/staff/gateway`, `/staff/terms` and `/staff/demo/reset` of `building` (DOC-36 §4, §7, §8, §10.4; E-47…E-50,
 * E-52, E-53, E-56). Every route
 * is the Admin's, reads its roles from the use case or query it calls, and holds no rule. `POST /staff/gateway/check` (E-51)
 * comes with the drivers of DOC-24; the resident terms routes (E-16, E-17) with P1-11.
 */
export function buildingRoutes(d: BuildingRouteDeps) {
  /** The listing of E-52 with the names of the publishers filled in. */
  async function termsListing(staff: ReturnType<typeof staffOf>, kind: TermsKind | null) {
    const rows = await d.queries.termsVersions(staff, kind)
    const names = await d.staffNames.names([...new Set(rows.map((row) => row.publishedBy))])
    return rows.map((row) => ({
      versionId: row.id,
      kind: row.kind,
      version: row.version,
      text: row.text,
      publishedBy: { id: row.publishedBy, name: names[row.publishedBy] ?? null },
      publishedAt: row.publishedAt.toISOString(),
      acceptedCount: row.acceptedCount,
    }))
  }

  const getSettings = async (context: { request: Request; set: RouteSet }) => {
    const document = await d.queries.settings(staffOf(context))
    const etag = quoted(document.etag)
    context.set.headers.etag = etag
    context.set.headers['cache-control'] = 'private, no-cache'
    if (context.request.headers.get('if-none-match') === etag) {
      context.set.status = 304
      return undefined
    }
    return documentBody(document)
  }

  const updateSettings = async (context: {
    request: Request
    body: Static<typeof SettingsUpdateSchema>
    set: RouteSet
  }) => {
    if (!context.body.building && !context.body.settings)
      throw new ValidationError([
        { path: 'building', code: 'required', message: 'building or settings' },
      ])
    const document = await d.updateBuildingSettings.execute(staffOf(context), {
      ...context.body,
      etag: context.request.headers.get('if-match') ?? undefined,
    })
    context.set.headers.etag = quoted(document.etag)
    return documentBody(document)
  }

  const getGateway = async (context: { set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.queries.gatewayView(staffOf(context))
  }

  const saveGateway = async (context: {
    request: Request
    body: Static<typeof GatewayBody>
    set: RouteSet
  }) => {
    const { created, config } = await d.saveGatewayConfig.execute(staffOf(context), {
      ...context.body,
      version: versionOf(context.request.headers.get('if-match')),
    })
    context.set.headers.etag = quoted(config.version)
    context.set.headers['cache-control'] = 'no-store'
    if (created) {
      context.set.status = 201
      context.set.headers.location = `${API_PREFIX}/staff/gateway`
    }
    return config
  }

  const listTerms = async (context: { query: Static<typeof TermsQuery>; set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return { items: await termsListing(staffOf(context), context.query.kind ?? null) }
  }

  const publishTerms = async (context: { body: Static<typeof TermsBody>; set: RouteSet }) => {
    const staff = staffOf(context)
    const published = await d.publishTerms.execute(staff, context.body)
    const [created] = (await termsListing(staff, published.kind)).filter(
      (row) => row.versionId === published.id,
    )
    context.set.status = 201
    context.set.headers.location = `${API_PREFIX}/staff/terms?kind=${published.kind}`
    return created
  }

  const resetDemo = async (context: { set: RouteSet }) => {
    context.set.headers['cache-control'] = 'no-store'
    return d.resetDemo.execute(staffOf(context))
  }

  const route = (roles: Parameters<Guards['staff']>[0], info: RouteInfo) =>
    staffRoute(d.guards, 'building', roles, info)

  return routePlugin({ prefix: '/staff' })
    .get(
      '/settings',
      getSettings,
      route(GET_SETTINGS_ROLES, {
        endpoint: 'E-47',
        operationId: 'getSettings',
        summary: 'Get the building settings',
        description:
          'The building row (name, company block, contact, logo) and the settings in one document.',
      }),
    )
    .patch('/settings', updateSettings, {
      ...route(UPDATE_BUILDING_SETTINGS_ROLES, {
        endpoint: 'E-48',
        operationId: 'updateSettings',
        summary: 'Update the building settings',
        description: 'Edits the building row, the settings or both in one transaction.',
      }),
      body: SettingsUpdateSchema,
    })
    .get(
      '/gateway',
      getGateway,
      route(GET_GATEWAY_ROLES, {
        endpoint: 'E-49',
        operationId: 'getGateway',
        summary: 'Get the payment gateway configuration',
        description:
          'The gateway configurations with masked secrets, the drivers allowed for this building and the last connection check.',
      }),
    )
    .put('/gateway', saveGateway, {
      ...route(SAVE_GATEWAY_CONFIG_ROLES, {
        endpoint: 'E-50',
        operationId: 'putGateway',
        summary: 'Save a payment gateway configuration',
        description:
          'Creates or changes the configuration of one payment provider: secrets, receiving account, driver and status. Needs a step-up code for `gateway_config`.',
        stepUp: 'gateway_config',
      }),
      body: GatewayBody,
    })
    .get('/terms', listTerms, {
      ...route(LIST_TERMS_ROLES, {
        endpoint: 'E-52',
        operationId: 'listTermsVersions',
        summary: 'List terms versions',
        description:
          'Every published version of the terms of use and the privacy notice, newest first, with the text and the number of residents who accepted it.',
      }),
      query: TermsQuery,
    })
    .post('/terms', publishTerms, {
      ...route(PUBLISH_TERMS_ROLES, {
        endpoint: 'E-53',
        operationId: 'publishTermsVersion',
        summary: 'Publish a terms version',
        description:
          'Publishes the next version of the terms of use or the privacy notice. Every resident is refused with 403 `terms_required` at their next request until they accept it.',
      }),
      body: TermsBody,
    })
    .post(
      '/demo/reset',
      resetDemo,
      route(RESET_DEMO_ROLES, {
        endpoint: 'E-56',
        operationId: 'resetDemo',
        summary: 'Reset the demo building',
        description:
          'Puts the demo building back to its seed: every module deletes its rows and seeds them again in one transaction. Every demo session ends. The answer is 404 for a building that is not a demo building.',
      }),
    )
}
