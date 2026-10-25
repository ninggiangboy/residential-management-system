import { requestContext } from '@core/context'
import { bucketIp, publicRoute, type RouteSet, routePlugin, strictObject } from '@core/http'
import { PayloadTooLargeError, ValidationError } from '@core/kernel'
import { type Static, Type } from '@sinclair/typebox'
import type { ReportClientError } from '../application/use-cases/report-client-error'
import type { AccessTokenVerifier } from '../contracts'

export interface ClientErrorRouteDeps {
  reportClientError: ReportClientError
  verifier: AccessTokenVerifier
}

/** The whole body, as the table of DOC-42 §10 sets it; larger is a bare 413 before the body is read. */
const MAX_BODY_BYTES = 8 * 1024
const MAX_STACK_BYTES = 4 * 1024

const Text = (maxLength: number, minLength = 0) => Type.String({ minLength, maxLength })
const Nullable = <T extends ReturnType<typeof Text>>(schema: T) =>
  Type.Optional(Type.Union([schema, Type.Null()]))

const Body = strictObject({
  app: Type.Union([Type.Literal('resident'), Type.Literal('staff'), Type.Literal('web')]),
  appVersion: Type.String({
    pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$',
    maxLength: 20,
  }),
  platform: Type.Union([Type.Literal('ios'), Type.Literal('android'), Type.Literal('web')]),
  kind: Type.Union([
    Type.Literal('crash'),
    Type.Literal('unhandled_rejection'),
    Type.Literal('render'),
    Type.Literal('network'),
  ]),
  screen: Nullable(Text(60)),
  errorName: Text(100, 1),
  message: Text(500, 1),
  // Characters here; the bytes are counted in the handler because a stack can hold more bytes than characters.
  stack: Nullable(Text(MAX_STACK_BYTES)),
  requestId: Nullable(Text(64)),
})

/** A bearer token that verifies names the account; anything else is ignored, never a 401 (DOC-51 E-04). */
async function accountOf(request: Request, verifier: AccessTokenVerifier) {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  try {
    const claims = await verifier.verify(header.slice(7))
    return { kind: claims.kind, id: claims.sub }
  } catch {
    return null
  }
}

/**
 * `POST /client-errors` (E-04, DOC-42 §10): public, no body larger than 8 KB, no known account needed. It is outside the app-version
 * gate (an old app must be able to say why it fails) and answers `no-store`.
 */
export function clientErrorRoutes(d: ClientErrorRouteDeps) {
  const report = async (context: {
    body: Static<typeof Body>
    request: Request
    set: RouteSet
  }) => {
    const { body } = context
    if (body.stack != null && Buffer.byteLength(body.stack) > MAX_STACK_BYTES)
      throw new ValidationError([
        { path: 'stack', code: 'max_bytes', message: 'at most 4096 bytes' },
      ])
    await d.reportClientError.execute({
      report: {
        ...body,
        screen: body.screen ?? null,
        stack: body.stack ?? null,
        requestId: body.requestId ?? null,
      },
      ip: bucketIp(requestContext.get()?.ip ?? 'unknown'),
      account: await accountOf(context.request, d.verifier),
    })
    context.set.status = 204
    context.set.headers['cache-control'] = 'no-store'
  }

  return routePlugin({ prefix: '/client-errors' }).post('/', report, {
    ...publicRoute('client-errors', { endpoint: 'E-04', operationId: 'reportClientError' }),
    // Before the body is validated: the declared length decides, so an oversized body is a 413 and never a list of 400 findings.
    transform: ({ request }: { request: Request }) => {
      if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
        throw new PayloadTooLargeError()
    },
    body: Body,
  })
}
