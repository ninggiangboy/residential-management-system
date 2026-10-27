import { requestContext } from '@core/context'
import {
  bucketIp,
  describedEnum,
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

const Email = Type.String({
  format: 'email',
  maxLength: 254,
  description: 'The email of the staff account',
})
const Client = describedEnum(
  {
    web: 'The web CMS: the refresh token is kept in an HttpOnly cookie',
    app: 'A mobile app: the refresh token is returned in the body',
  },
  'The kind of client, which decides where the refresh token goes.',
)
type Client = Static<typeof Client>

const LoginBody = strictObject({
  email: Email,
  password: Type.String({ minLength: 1, maxLength: 128, description: 'The password' }),
  client: Client,
})
const PasswordResetBody = strictObject({ email: Email })
const SetPasswordBody = strictObject({
  token: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'The single-use token of the invite or reset link',
  }),
  password: Type.String({
    minLength: 1,
    maxLength: 1024,
    description: 'The new password; a weak one is 400 `validation_failed` rule `password_weak`',
  }),
})
const ResendInviteBody = strictObject({
  staffId: Type.String({
    format: 'uuid',
    description: 'The id of the staff account that is still `invited`',
  }),
})
const OtpBody = strictObject({
  phone: Type.String({
    minLength: 3,
    maxLength: 32,
    description:
      'The phone number of the resident, with or without the country code (Vietnam by default)',
  }),
})
const VerifyOtpBody = strictObject({
  challengeId: Type.String({
    format: 'uuid',
    description: 'The `challengeId` returned by `requestOtp`',
  }),
  code: Type.String({ pattern: '^[0-9]{6}$', description: 'The six-digit code sent by SMS' }),
})
const RefreshBody = Type.Optional(
  strictObject({
    refreshToken: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        description:
          'The refresh token of an app. The web CMS sends no body: its token is in the HttpOnly cookie (with the header `X-Requested-With: rms`)',
      }),
    ),
  }),
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
      ...open({
        endpoint: 'E-05',
        operationId: 'loginStaff',
        summary: 'Sign in as staff',
        description:
          'A staff member signs in with email and password. With `client: "web"` the refresh token is set in an HttpOnly cookie; with `client: "app"` it is returned in the body. A wrong password, an unknown email and an account that is invited, locked or disabled all answer the same 401 `invalid_credentials`.',
      }),
    })
    .post('/staff/password-reset', requestPasswordReset, {
      body: PasswordResetBody,
      ...open({
        endpoint: 'E-06',
        operationId: 'requestStaffPasswordReset',
        summary: 'Request a staff password reset',
        description:
          'A staff member asks for a reset link by email. The answer is the same whether or not the email belongs to an account, so it cannot be used to find out which emails exist.',
      }),
    })
    .post('/staff/password', setPassword, {
      body: SetPasswordBody,
      ...open({
        endpoint: 'E-07',
        operationId: 'setStaffPassword',
        summary: 'Set a staff password',
        description:
          'Sets the password from an invite link or a reset link. The token is single use; an unknown, expired or used token all answer 400 `token_invalid`. A reset revokes every session of the account.',
      }),
    })
    .post('/staff/invite/resend', resendStaffInvite, {
      ...staffRoute(d.guards, 'auth', RESEND_STAFF_INVITE_ROLES, {
        endpoint: 'E-08',
        operationId: 'resendStaffInvite',
        summary: 'Resend a staff invite',
        description:
          'Sends a new invite link to a staff member who is still `invited`, typically after the 24-hour link expired.',
      }),
      body: ResendInviteBody,
    })
    .post('/otp', requestOtp, {
      body: OtpBody,
      ...open({
        endpoint: 'E-09',
        operationId: 'requestOtp',
        summary: 'Request a resident sign-in code',
        description:
          'A resident asks for a one-time code sent by SMS to their phone. An unregistered phone answers 404 `phone_not_registered` and no SMS is sent. Rate limited per IP and per phone; a resend before `resendAfter` answers 429.',
      }),
    })
    .post('/otp/verify', verifyOtp, {
      body: VerifyOtpBody,
      ...open({
        endpoint: 'E-10',
        operationId: 'verifyOtp',
        summary: 'Verify a resident sign-in code',
        description:
          'The resident enters the code and signs in. The answer carries the tokens and the active memberships, so the app can go to the home screen or the unit picker without another call. An empty membership list means no unit is linked yet.',
      }),
    })
    .post('/refresh', refresh, {
      body: RefreshBody,
      ...withRefreshToken({
        endpoint: 'E-11',
        operationId: 'refreshSession',
        summary: 'Refresh the session tokens',
        description:
          'Rotates the access token and the refresh token. The client calls it once on a 401 and replays the request. Presenting a refresh token that was already rotated revokes the whole session family.',
      }),
    })
    .post('/logout', logout, {
      body: RefreshBody,
      ...withRefreshToken({
        endpoint: 'E-12',
        operationId: 'logout',
        summary: 'Sign out',
        description:
          'Ends the session of the given refresh token. Safe to repeat: an unknown or already ended session answers the same.',
      }),
    })
}
