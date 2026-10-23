import type { Database } from '@core/db'
import { routePlugin } from '@core/http'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import {
  DrizzleInboxGuard,
  DrizzleOutboxWriter,
  type IntegrationEventHandler,
} from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi } from '@mod/building/contracts'
import type { Guards } from '@rms/shared-types'
import { IdentityApiImpl } from './application/api/identity-api-impl'
import type { IdentityConfig } from './application/config'
import { FailureCounter } from './application/failure-counter'
import { SendMailHandler } from './application/handlers/send-mail'
import { InviteIssuer } from './application/invite-issuer'
import { MailCommands } from './application/mail-commands'
import type { Delay, Mailer, PasswordHasher } from './application/ports'
import { SessionQueries } from './application/queries/session-queries'
import { StaffQueries } from './application/queries/staff-queries'
import { SessionEvents } from './application/session-events'
import { SessionIssuer } from './application/session-issuer'
import { RefreshSession } from './application/use-cases/refresh-session'
import { RequestPasswordReset } from './application/use-cases/request-password-reset'
import { RequestStepUp } from './application/use-cases/request-step-up'
import { ResendStaffInvite } from './application/use-cases/resend-staff-invite'
import { RevokeStaffSession } from './application/use-cases/revoke-staff-session'
import { SetPassword } from './application/use-cases/set-password'
import { SignInStaff } from './application/use-cases/sign-in-staff'
import { SignOut } from './application/use-cases/sign-out'
import { VerifyStepUp } from './application/use-cases/verify-step-up'
import type { AccessTokenVerifier, IdentityApi } from './contracts'
import { DatabaseAutonomous } from './infrastructure/persistence/database-autonomous'
import { DrizzlePasswordTokenRepository } from './infrastructure/persistence/drizzle-password-token-repository'
import { DrizzleSessionRepository } from './infrastructure/persistence/drizzle-session-repository'
import { DrizzleStaffAccountRepository } from './infrastructure/persistence/drizzle-staff-account-repository'
import { identityInbox, identityOutbox } from './infrastructure/persistence/schema'
import { SqlRateLimiter } from './infrastructure/persistence/sql-rate-limiter'
import {
  type Argon2Params,
  Argon2PasswordHasher,
} from './infrastructure/security/argon2-password-hasher'
import { CryptoTokenFactory } from './infrastructure/security/crypto-token-factory'
import { JoseTokens } from './infrastructure/security/jose-tokens'
import { identityManifest } from './manifest'
import { authRoutes } from './presentation/auth-routes'
import { staffRoutes } from './presentation/staff-routes'

export interface IdentityDeps {
  config: IdentityConfig
  argon2: Argon2Params
  /** `JWT_KEYS`: `kid → PEM` (DR-65). */
  jwtKeys: Readonly<Record<string, string>>
  /** `OTP_HMAC_KEY`: binds a step-up code to its person and action (DR-132). */
  otpHmacKey: string
  /** The `SETTINGS_ENCRYPTION_KEYS` ring: opens and seals the secret of a mail command (DR-117). */
  secretBox: SecretBox
  mailer: Mailer
  /** Only the lockout settings of the staff member's building are read (DOC-26 §4.1). */
  building: Pick<BuildingApi, 'getSettings'>
  audited: Audited
  guards: Guards
  /** `OUTBOX_MAX_PAYLOAD_BYTES`. */
  outboxMaxPayloadBytes: number
  /** Tests replace the hasher and the wait; production builds both. */
  hasher?: PasswordHasher
  delay?: Delay
}

export interface IdentityModuleDeps extends IdentityDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

export type IdentityRoutes = ReturnType<typeof createRoutes>

function createRoutes(deps: Parameters<typeof authRoutes>[0] & Parameters<typeof staffRoutes>[0]) {
  return routePlugin().use(authRoutes(deps)).use(staffRoutes(deps))
}

/** What the routes call; the test harness and later tasks (P1-14, P1-22) call the same objects. */
export interface IdentityUseCases {
  /** `POST /auth/staff/login`. */
  signInStaff: SignInStaff
  /** `POST /auth/refresh`. */
  refreshSession: RefreshSession
  /** `POST /auth/logout`. */
  signOut: SignOut
  /** `POST /auth/staff/password-reset`. */
  requestPasswordReset: RequestPasswordReset
  /** `POST /auth/staff/password`. */
  setPassword: SetPassword
  /** `POST /auth/staff/invite/resend`. */
  resendStaffInvite: ResendStaffInvite
  /** `POST /staff/step-up`. */
  requestStepUp: RequestStepUp
  /** `DELETE /staff/sessions/{id}`. */
  revokeStaffSession: RevokeStaffSession
}

export interface IdentityModule extends AppModule<'identity', IdentityRoutes> {
  readonly api: IdentityApi
  readonly useCases: IdentityUseCases
  /** The reads behind `GET /staff/me` and `GET /staff/sessions`. */
  readonly queries: { staff: StaffQueries; sessions: SessionQueries }
  readonly verifier: AccessTokenVerifier & { ready(): Promise<void> }
  /** Issues an invite for a staff account created by P1-14; here for the resend. */
  readonly inviteIssuer: InviteIssuer
}

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createIdentityModule(deps: IdentityModuleDeps): IdentityModule {
  const { database, clock, ids, logger, config } = deps

  const staffAccounts = new DrizzleStaffAccountRepository(database)
  const passwordTokens = new DrizzlePasswordTokenRepository(database)
  const sessions = new DrizzleSessionRepository(database)
  const limiter = new SqlRateLimiter(database, 'identity.rate_bucket')
  const accountLimiter = new SqlRateLimiter(database, 'platform.rate_bucket')
  const autonomous = new DatabaseAutonomous(database)

  const hasher = deps.hasher ?? new Argon2PasswordHasher(deps.argon2)
  const tokens = new JoseTokens({
    keys: deps.jwtKeys,
    accessTtlSeconds: config.accessTtlSeconds,
    clock,
  })
  const factory = new CryptoTokenFactory(deps.otpHmacKey)

  const outbox = new DrizzleOutboxWriter(database, identityOutbox, () => ids.next(), {
    source: 'identity',
    types: new Set(Object.keys(identityManifest.outboxPolicies)),
    maxPayloadBytes: deps.outboxMaxPayloadBytes,
  })
  const inbox = new DrizzleInboxGuard(database, identityInbox)

  const events = new SessionEvents(outbox)
  const mail = new MailCommands(outbox, deps.secretBox, clock)
  const issuer = new SessionIssuer(sessions, events, factory, tokens, clock, ids, config)
  const inviteIssuer = new InviteIssuer(passwordTokens, factory, mail, clock, ids, config)

  const failures = new FailureCounter(staffAccounts)
  const signInStaff = new SignInStaff(
    staffAccounts,
    failures,
    hasher,
    limiter,
    deps.building,
    issuer,
    database,
    clock,
    logger,
    config,
  )
  const refreshSession = new RefreshSession(
    sessions,
    staffAccounts,
    events,
    factory,
    tokens,
    database,
    clock,
    ids,
    logger,
    config,
  )
  const signOut = new SignOut(sessions, events, factory, database, clock)
  const revokeStaffSession = new RevokeStaffSession(sessions, events, database, clock)
  const requestPasswordReset = new RequestPasswordReset(
    staffAccounts,
    passwordTokens,
    limiter,
    factory,
    mail,
    database,
    clock,
    ids,
    config,
    deps.delay ?? ((milliseconds) => Bun.sleep(milliseconds)),
  )
  const setPassword = new SetPassword(
    staffAccounts,
    passwordTokens,
    sessions,
    events,
    hasher,
    factory,
    database,
    clock,
  )
  const resendStaffInvite = new ResendStaffInvite(
    staffAccounts,
    inviteIssuer,
    database,
    deps.audited,
  )
  const requestStepUp = new RequestStepUp(
    staffAccounts,
    passwordTokens,
    accountLimiter,
    factory,
    mail,
    database,
    clock,
    ids,
    config,
  )
  const verifyStepUp = new VerifyStepUp(
    staffAccounts,
    failures,
    passwordTokens,
    hasher,
    factory,
    mail,
    deps.building,
    autonomous,
    clock,
    config,
  )

  const staffQueries = new StaffQueries(staffAccounts)
  const sessionQueries = new SessionQueries(sessions, clock)

  const handlers: IntegrationEventHandler[] = [
    new SendMailHandler(
      staffAccounts,
      deps.secretBox,
      deps.mailer,
      inbox,
      clock,
      logger,
      config.adminBaseUrl,
    ),
  ]

  const useCases: IdentityUseCases = {
    signInStaff,
    refreshSession,
    signOut,
    requestPasswordReset,
    setPassword,
    resendStaffInvite,
    requestStepUp,
    revokeStaffSession,
  }

  return {
    name: 'identity',
    api: new IdentityApiImpl(staffQueries, verifyStepUp),
    useCases,
    queries: { staff: staffQueries, sessions: sessionQueries },
    verifier: tokens,
    inviteIssuer,
    routes: createRoutes({
      ...useCases,
      staffQueries,
      sessionQueries,
      guards: deps.guards,
      clock,
    }),
    handlers,
    outbox: { name: 'identity', table: identityOutbox, inboxTable: identityInbox },
    jobs: [],
  }
}
