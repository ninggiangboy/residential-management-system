import { requestContext } from '@core/context'
import { bucketIp, routePlugin, strictObject } from '@core/http'
import type { Clock } from '@core/kernel'
import { type Guards, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import type { IssuedSession } from '../application/session-issuer'
import type { StaffProfile } from '../application/staff-dto'
import type { RefreshSession } from '../application/use-cases/refresh-session'
import type { RequestOtp } from '../application/use-cases/request-otp'
import type { RequestPasswordReset } from '../application/use-cases/request-password-reset'
import type { ResendStaffInvite } from '../application/use-cases/resend-staff-invite'
import { RESEND_STAFF_INVITE_ROLES } from '../application/use-cases/resend-staff-invite'
import type { SetPassword } from '../application/use-cases/set-password'
import type { SignInStaff } from '../application/use-cases/sign-in-staff'
import type { SignOut } from '../application/use-cases/sign-out'
import type { VerifyOtp } from '../application/use-cases/verify-otp'
import { UnauthenticatedError } from '../domain/errors'
import { clearedRefreshCookie, refreshCookie, refreshCredential } from './refresh-cookie'

export interface AuthRouteDeps {
  signInStaff: SignInStaff
  refreshSession: RefreshSession
  signOut: SignOut
  requestPasswordReset: RequestPasswordReset
  setPassword: SetPassword
  resendStaffInvite: ResendStaffInvite
  requestOtp: RequestOtp
  verifyOtp: VerifyOtp
  guards: Guards
  clock: Clock
}

const Email = Type.String({ format: 'email', maxLength: 254 })
const Client = Type.Union([Type.Literal('web'), Type.Literal('app')])
const RefreshBody = Type.Optional(
  strictObject({ refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }),
)
type Client = Static<typeof Client>

/** The route metadata of DOC-12 §5.3, as the vendor extension the OpenAPI document carries (DOC-50 §2). */
const audience = (value: object) => ({ detail: { tags: ['auth'], 'x-audience': value } })

/** The ip the buckets key on: an IPv6 address is reduced to its /64 (DOC-39 §5.3). */
const clientIp = () => bucketIp(requestContext.get()?.ip ?? 'unknown')

/**
 * `/auth/*` for staff (DOC-26 §7): sign-in, password reset and set-password, the refresh and the logout, and the resend of an
 * invite. The refresh token goes to the web CMS in a cookie only and to the apps in the body only (DOC-26 §3.3).
 */
export function authRoutes(d: AuthRouteDeps) {
  /** The answer of a sign-in or a refresh, by how the client receives its refresh token. */
  const session = (
    issued: Pick<IssuedSession, 'accessToken' | 'expiresIn' | 'refreshToken' | 'refreshExpiresAt'>,
    client: Client,
    set: { headers: Record<string, string | number | undefined> },
  ) => {
    if (client === 'web')
      set.headers['set-cookie'] = refreshCookie(
        issued.refreshToken,
        issued.refreshExpiresAt,
        d.clock.now(),
      )
    return {
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      ...(client === 'app' ? { refreshToken: issued.refreshToken } : {}),
    }
  }

  return routePlugin({ prefix: '/auth' })
    .post(
      '/staff/login',
      async ({ body, set }): Promise<{ staff: StaffProfile } & ReturnType<typeof session>> => {
        const context = requestContext.get()
        const result = await d.signInStaff.execute({
          ...body,
          ip: clientIp(),
          userAgent: context?.userAgent ?? null,
        })
        return { ...session(result.session, body.client, set), staff: result.staff }
      },
      {
        body: strictObject({
          email: Email,
          password: Type.String({ minLength: 1, maxLength: 128 }),
          client: Client,
        }),
        ...audience({ kind: 'public' }),
      },
    )
    .post(
      '/staff/password-reset',
      async ({ body, set }) => {
        await d.requestPasswordReset.execute({ email: body.email, ip: clientIp() })
        set.status = 202
        return {}
      },
      { body: strictObject({ email: Email }), ...audience({ kind: 'public' }) },
    )
    .post(
      '/staff/password',
      async ({ body, set }) => {
        await d.setPassword.execute(body)
        set.status = 204
      },
      {
        body: strictObject({
          token: Type.String({ minLength: 1, maxLength: 200 }),
          password: Type.String({ minLength: 1, maxLength: 1024 }),
        }),
        ...audience({ kind: 'public' }),
      },
    )
    .post(
      '/staff/invite/resend',
      async (context) => {
        await d.resendStaffInvite.execute(staffOf(context), context.body.staffId)
        context.set.status = 204
      },
      {
        ...d.guards.staff(RESEND_STAFF_INVITE_ROLES),
        body: strictObject({ staffId: Type.String({ format: 'uuid' }) }),
        ...audience({ kind: 'staff', roles: RESEND_STAFF_INVITE_ROLES }),
      },
    )
    .post(
      '/otp',
      async ({ body, set }) => {
        const requested = await d.requestOtp.execute({ phone: body.phone, ip: clientIp() })
        set.status = 202
        return requested
      },
      {
        body: strictObject({ phone: Type.String({ minLength: 3, maxLength: 32 }) }),
        ...audience({ kind: 'public' }),
      },
    )
    .post(
      '/otp/verify',
      async ({ body }) => {
        const signedIn = await d.verifyOtp.execute({
          ...body,
          userAgent: requestContext.get()?.userAgent ?? null,
          ip: clientIp(),
        })
        // A resident always signs in from the app: the refresh token is in the body, never a cookie (DOC-26 §3.3).
        return {
          ...session(signedIn.session, 'app', { headers: {} }),
          account: signedIn.account,
          memberships: signedIn.memberships,
        }
      },
      {
        body: strictObject({
          challengeId: Type.String({ format: 'uuid' }),
          code: Type.String({ pattern: '^[0-9]{6}$' }),
        }),
        ...audience({ kind: 'public' }),
      },
    )
    .post(
      '/refresh',
      async ({ request, body, set }) => {
        const token = refreshCredential(request, body?.refreshToken)
        if (!token) throw new UnauthenticatedError()
        const result = await d.refreshSession.execute({ refreshToken: token })
        return session(result, result.client, set)
      },
      { body: RefreshBody, ...audience({ kind: 'public', credential: 'refresh_token' }) },
    )
    .post(
      '/logout',
      async ({ request, body, set }) => {
        const token = refreshCredential(request, body?.refreshToken)
        if (token) await d.signOut.execute({ refreshToken: token })
        // The same answer whether or not the token is known; the browser drops the cookie either way.
        set.headers['set-cookie'] = clearedRefreshCookie()
        set.status = 204
      },
      { body: RefreshBody, ...audience({ kind: 'public', credential: 'refresh_token' }) },
    )
}
