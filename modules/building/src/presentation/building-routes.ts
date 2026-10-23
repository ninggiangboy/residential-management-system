import { API_PREFIX, routePlugin, strictObject } from '@core/http'
import { ValidationError, VersionConflictError } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { Type } from '@sinclair/typebox'
import type { BuildingDocument } from '../application/building-document'
import {
  type BuildingQueries,
  GET_GATEWAY_ROLES,
  GET_SETTINGS_ROLES,
  LIST_TERMS_ROLES,
} from '../application/queries/building-queries'
import { PUBLISH_TERMS_ROLES, type PublishTerms } from '../application/use-cases/publish-terms'
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
  staffNames: StaffNames
  guards: Guards
}

const audience = (roles: readonly string[]) => ({
  detail: { tags: ['building'], 'x-audience': { kind: 'staff', roles } },
})

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

const ReceivingAccountBody = strictObject({
  bankBin: Type.String(),
  accountNumber: Type.String(),
  accountName: Type.String(),
})

const GatewayBody = strictObject({
  provider: Type.Union([Type.Literal('payos'), Type.Literal('vietqr')]),
  driver: Type.Optional(
    Type.Union([Type.Literal('payos'), Type.Literal('vietqr'), Type.Literal('fake')]),
  ),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('disabled')])),
  receivingAccount: Type.Optional(ReceivingAccountBody),
  secrets: Type.Optional(Type.Record(Type.String(), Type.String({ minLength: 1, maxLength: 512 }))),
  stepUp: Type.Optional(
    strictObject({
      password: Type.String({ minLength: 1, maxLength: 128 }),
      code: Type.String({ pattern: '^[0-9]{6}$' }),
    }),
  ),
})

const TermsKindSchema = Type.Union([Type.Literal('terms'), Type.Literal('privacy')])

const TermsBody = strictObject({
  kind: TermsKindSchema,
  text: strictObject({
    vi: Type.String({ minLength: 1, maxLength: 100_000 }),
    en: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
  }),
})

/**
 * `/staff/settings`, `/staff/gateway` and `/staff/terms` of `building` (DOC-36 §4, §7, §8; E-47…E-50, E-52, E-53). Every route
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

  return routePlugin({ prefix: '/staff' })
    .get(
      '/settings',
      async (context) => {
        const document = await d.queries.settings(staffOf(context))
        const etag = quoted(document.etag)
        context.set.headers.etag = etag
        context.set.headers['cache-control'] = 'private, no-cache'
        if (context.request.headers.get('if-none-match') === etag) {
          context.set.status = 304
          return undefined
        }
        return documentBody(document)
      },
      { ...d.guards.staff(GET_SETTINGS_ROLES), ...audience(GET_SETTINGS_ROLES) },
    )
    .patch(
      '/settings',
      async (context) => {
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
      },
      {
        ...d.guards.staff(UPDATE_BUILDING_SETTINGS_ROLES),
        body: SettingsUpdateSchema,
        ...audience(UPDATE_BUILDING_SETTINGS_ROLES),
      },
    )
    .get(
      '/gateway',
      async (context) => {
        context.set.headers['cache-control'] = 'no-store'
        return d.queries.gatewayView(staffOf(context))
      },
      { ...d.guards.staff(GET_GATEWAY_ROLES), ...audience(GET_GATEWAY_ROLES) },
    )
    .put(
      '/gateway',
      async (context) => {
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
      },
      {
        ...d.guards.staff(SAVE_GATEWAY_CONFIG_ROLES),
        body: GatewayBody,
        ...audience(SAVE_GATEWAY_CONFIG_ROLES),
      },
    )
    .get(
      '/terms',
      async (context) => {
        context.set.headers['cache-control'] = 'no-store'
        return { items: await termsListing(staffOf(context), context.query.kind ?? null) }
      },
      {
        ...d.guards.staff(LIST_TERMS_ROLES),
        query: strictObject({ kind: Type.Optional(TermsKindSchema) }),
        ...audience(LIST_TERMS_ROLES),
      },
    )
    .post(
      '/terms',
      async (context) => {
        const staff = staffOf(context)
        const published = await d.publishTerms.execute(staff, context.body)
        const [created] = (await termsListing(staff, published.kind)).filter(
          (row) => row.versionId === published.id,
        )
        context.set.status = 201
        context.set.headers.location = `${API_PREFIX}/staff/terms?kind=${published.kind}`
        return created
      },
      {
        ...d.guards.staff(PUBLISH_TERMS_ROLES),
        body: TermsBody,
        ...audience(PUBLISH_TERMS_ROLES),
      },
    )
}
