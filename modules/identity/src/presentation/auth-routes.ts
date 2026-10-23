import { requestContext } from '@core/context'
import {
  bucketIp,
  publicRoute,
  type RouteInfo,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
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
type Client = Static<typeof Client>

const LoginBody = strictObject({
  email: Email,
  password: Type.String({ minLength: 1, maxLength: 128 }),
  client: Client,
})
const PasswordResetBody = strictObject({ email: Email })
const SetPasswordBody = strictObject({
  token: Type.String({ minLength: 1, maxLength: 200 }),
  password: Type.String({ minLength: 1, maxLength: 1024 }),
})
const ResendInviteBody = strictObject({ staffId: Type.String({ format: 'uuid' }) })
const OtpBody = strictObject({ phone: Type.String({ minLength: 3, maxLength: 32 }) })
const VerifyOtpBody = strictObject({
  challengeId: Type.String({ format: 'uuid' }),
  code: Type.String({ pattern: '^[0-9]{6}$' }),
})
const RefreshBody = Type.Optional(
  strictObject({ refreshToken: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })) }),
)

/** The ip the buckets key on: an IPv6 address is reduced to its /64 (DOC-39 §5.3). */
const clientIp = () => bucketIp(requestContext.get()?.ip ?? 'unknown')

/** Where a sign-in comes from, for the rate buckets and the session list. */
const clientInfo = () => ({
  ip: clientIp(),
  userAgent: requestContext.get()?.userAgent ?? null,
})

/** Routes of `/auth` that carry no session; the refresh and the logout take the refresh token instead. */
const open = (info: RouteInfo) => publicRoute('auth', info)
const withRefreshToken = (info: Omit<RouteInfo, 'credential'>) =>
  publicRoute('auth', { ...info, credential: 'refresh_token' })

/**
 * `/auth/*` for staff (DOC-26 §7): sign-in, password reset and set-password, the refresh and the logout, and the resend of an
 * invite. The refresh token goes to the web CMS in a cookie only and to the apps in the body only (DOC-26 §3.3).
 */
export function authRoutes(d: AuthRouteDeps) {
  /** The answer of a sign-in or a refresh, by how the client receives its refresh token. */
  const session = (
    issued: Pick<IssuedSession, 'accessToken' | 'expiresIn' | 'refreshToken' | 'refreshExpiresAt'>,
    client: Client,
    set: Pick<RouteSet, 'headers'>,
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

  const staffLogin = async ({
    body,
    set,
  }: {
    body: Static<typeof LoginBody>
    set: RouteSet
  }): Promise<{ staff: StaffProfile } & ReturnType<typeof session>> => {
    const result = await d.signInStaff.execute({ ...body, ...clientInfo() })
    return { ...session(result.session, body.client, set), staff: result.staff }
  }

  const requestPasswordReset = async ({
    body,
    set,
  }: {
    body: Static<typeof PasswordResetBody>
    set: RouteSet
  }) => {
    await d.requestPasswordReset.execute({ email: body.email, ip: clientIp() })
    set.status = 202
    return {}
  }

  const setPassword = async ({
    body,
    set,
  }: {
    body: Static<typeof SetPasswordBody>
    set: RouteSet
  }) => {
    await d.setPassword.execute(body)
    set.status = 204
  }

  const resendStaffInvite = async (context: {
    body: Static<typeof ResendInviteBody>
    set: RouteSet
  }) => {
    await d.resendStaffInvite.execute(staffOf(context), context.body.staffId)
    context.set.status = 204
  }

  const requestOtp = async ({ body, set }: { body: Static<typeof OtpBody>; set: RouteSet }) => {
    const requested = await d.requestOtp.execute({ phone: body.phone, ip: clientIp() })
    set.status = 202
    return requested
  }

  const verifyOtp = async ({ body }: { body: Static<typeof VerifyOtpBody> }) => {
    const signedIn = await d.verifyOtp.execute({ ...body, ...clientInfo() })
    // A resident always signs in from the app: the refresh token is in the body, never a cookie (DOC-26 §3.3).
    return {
      ...session(signedIn.session, 'app', { headers: {} }),
      account: signedIn.account,
      memberships: signedIn.memberships,
    }
  }

  const refresh = async ({
    request,
    body,
    set,
  }: {
    request: Request
    body: Static<typeof RefreshBody> | null
    set: RouteSet
  }) => {
    const token = refreshCredential(request, body?.refreshToken)
    if (!token) throw new UnauthenticatedError()
    const result = await d.refreshSession.execute({ refreshToken: token })
    return session(result, result.client, set)
  }

  const logout = async ({
    request,
    body,
    set,
  }: {
    request: Request
    body: Static<typeof RefreshBody> | null
    set: RouteSet
  }) => {
    const token = refreshCredential(request, body?.refreshToken)
    if (token) await d.signOut.execute({ refreshToken: token })
    // The same answer whether or not the token is known; the browser drops the cookie either way.
    set.headers['set-cookie'] = clearedRefreshCookie()
    set.status = 204
  }

  return routePlugin({ prefix: '/auth' })
    .post('/staff/login', staffLogin, {
      body: LoginBody,
      ...open({ endpoint: 'E-05', operationId: 'loginStaff' }),
    })
    .post('/staff/password-reset', requestPasswordReset, {
      body: PasswordResetBody,
      ...open({ endpoint: 'E-06', operationId: 'requestStaffPasswordReset' }),
    })
    .post('/staff/password', setPassword, {
      body: SetPasswordBody,
      ...open({ endpoint: 'E-07', operationId: 'setStaffPassword' }),
    })
    .post('/staff/invite/resend', resendStaffInvite, {
      ...staffRoute(d.guards, 'auth', RESEND_STAFF_INVITE_ROLES, {
        endpoint: 'E-08',
        operationId: 'resendStaffInvite',
      }),
      body: ResendInviteBody,
    })
    .post('/otp', requestOtp, {
      body: OtpBody,
      ...open({ endpoint: 'E-09', operationId: 'requestOtp' }),
    })
    .post('/otp/verify', verifyOtp, {
      body: VerifyOtpBody,
      ...open({ endpoint: 'E-10', operationId: 'verifyOtp' }),
    })
    .post('/refresh', refresh, {
      body: RefreshBody,
      ...withRefreshToken({ endpoint: 'E-11', operationId: 'refreshSession' }),
    })
    .post('/logout', logout, {
      body: RefreshBody,
      ...withRefreshToken({ endpoint: 'E-12', operationId: 'logout' }),
    })
}
