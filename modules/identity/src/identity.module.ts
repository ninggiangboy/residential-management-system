import type { Database } from '@core/db'
import { type Idempotent, routePlugin } from '@core/http'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import {
  DrizzleInboxGuard,
  DrizzleOutboxWriter,
  type IntegrationEventHandler,
} from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi, FilesApi } from '@mod/building/contracts'
import type { Guards } from '@rms/shared-types'
import { IdentityApiImpl } from './application/api/identity-api-impl'
import type { IdentityConfig } from './application/config'
import { FailureCounter } from './application/failure-counter'
import { SendMailHandler } from './application/handlers/send-mail'
import { SendSmsHandler } from './application/handlers/send-sms'
import { InviteIssuer } from './application/invite-issuer'
import { MailCommands } from './application/mail-commands'
import type {
  ActiveMemberships,
  Delay,
  Mailer,
  PasswordHasher,
  SmsSender,
} from './application/ports'
import { ResidentQueries } from './application/queries/resident-queries'
import { SessionQueries } from './application/queries/session-queries'
import { StaffQueries } from './application/queries/staff-queries'
import { SessionEvents } from './application/session-events'
import { SessionIssuer } from './application/session-issuer'
import { SessionOwners } from './application/session-owners'
import { SmsCommands } from './application/sms-commands'
import { StaffSafeguards } from './application/staff-safeguards'
import { StaffSessions } from './application/staff-sessions'
import { ApproveResidentDeletion } from './application/use-cases/approve-resident-deletion'
import { ChangeResidentPhone } from './application/use-cases/change-resident-phone'
import { CreateStaffAccount } from './application/use-cases/create-staff-account'
import { DisableStaffAccount } from './application/use-cases/disable-staff-account'
import { EnableStaffAccount } from './application/use-cases/enable-staff-account'
import { EnsureResidentAccount } from './application/use-cases/ensure-resident-account'
import { LockStaffAccount } from './application/use-cases/lock-staff-account'
import { QueueMemberInvitation } from './application/use-cases/queue-member-invitation'
import { RefreshSession } from './application/use-cases/refresh-session'
import { ReportClientError } from './application/use-cases/report-client-error'
import { RequestOtp } from './application/use-cases/request-otp'
import { RequestPasswordReset } from './application/use-cases/request-password-reset'
import { RequestStepUp } from './application/use-cases/request-step-up'
import { ResendStaffInvite } from './application/use-cases/resend-staff-invite'
import { RevokeResidentSession } from './application/use-cases/revoke-resident-session'
import { RevokeStaffSession } from './application/use-cases/revoke-staff-session'
import { SetPassword } from './application/use-cases/set-password'
import { SignInStaff } from './application/use-cases/sign-in-staff'
import { SignOut } from './application/use-cases/sign-out'
import { UnlockStaffAccount } from './application/use-cases/unlock-staff-account'
import { UpdateResidentMe } from './application/use-cases/update-resident-me'
import { UpdateStaffAccount } from './application/use-cases/update-staff-account'
import { UpdateStaffMe } from './application/use-cases/update-staff-me'
import { VerifyOtp } from './application/use-cases/verify-otp'
import { VerifyStepUp } from './application/use-cases/verify-step-up'
import type { AccessTokenVerifier, IdentityApi, OpenTicketsProbe } from './contracts'
import { DatabaseAutonomous } from './infrastructure/persistence/database-autonomous'
import { DrizzleOtpChallengeRepository } from './infrastructure/persistence/drizzle-otp-challenge-repository'
import { DrizzlePasswordTokenRepository } from './infrastructure/persistence/drizzle-password-token-repository'
import { DrizzleResidentAccountRepository } from './infrastructure/persistence/drizzle-resident-account-repository'
import { DrizzleSessionRepository } from './infrastructure/persistence/drizzle-session-repository'
import { DrizzleStaffAccountRepository } from './infrastructure/persistence/drizzle-staff-account-repository'
import { OutboxSmsProviderProbe } from './infrastructure/persistence/outbox-sms-provider-probe'
import { identityInbox, identityOutbox } from './infrastructure/persistence/schema'
import { SqlRateLimiter } from './infrastructure/persistence/sql-rate-limiter'
import { LibphonenumberPhones } from './infrastructure/phone/libphonenumber-phones'
import {
  type Argon2Params,
  Argon2PasswordHasher,
} from './infrastructure/security/argon2-password-hasher'
import { CryptoTokenFactory } from './infrastructure/security/crypto-token-factory'
import { JoseTokens } from './infrastructure/security/jose-tokens'
import { identityManifest } from './manifest'
import { authRoutes } from './presentation/auth-routes'
import { clientErrorRoutes } from './presentation/client-error-routes'
import { residentRoutes } from './presentation/resident-routes'
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
  /** The SMS driver of `SMS_DRIVER`: console, allowlist or the provider adapter (DOC-26 §5.5). */
  sms: SmsSender
  /** `ResidencyApi.listActiveMemberships`, bound by the container; a stand-in until P1-12 (DOC-26 §3.4). */
  memberships: ActiveMemberships
  /** Only the lockout settings of the staff member's building are read (DOC-26 §4.1). */
  building: Pick<BuildingApi, 'getSettings'>
  /** The avatar of E-30 and E-31: verified, attached and removed with the member's update, and presigned for the answer. */
  files: Pick<FilesApi, 'verify' | 'attach' | 'remove' | 'signedUrl'>
  audited: Audited
  guards: Guards
  /** E-40 takes an `Idempotency-Key` (DOC-50 §8.1). */
  idempotent: Idempotent
  /**
   * `tickets` answers it from `integrations/identity` (DOC-26 §2.1); until P3 the container binds a stand-in that finds no ticket.
   */
  tickets: OpenTicketsProbe
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

function createRoutes(
  deps: Parameters<typeof authRoutes>[0] &
    Parameters<typeof staffRoutes>[0] &
    Parameters<typeof residentRoutes>[0] &
    Parameters<typeof clientErrorRoutes>[0],
) {
  return routePlugin()
    .use(authRoutes(deps))
    .use(staffRoutes(deps))
    .use(residentRoutes(deps))
    .use(clientErrorRoutes(deps))
}

/** What the routes call; the test harness and later tasks (P1-14, P1-22) call the same objects. */
export interface IdentityUseCases {
  /** `POST /auth/staff/login`. */
  signInStaff: SignInStaff
  /** `POST /auth/refresh`. */
  refreshSession: RefreshSession
  /** `POST /auth/logout`. */
  signOut: SignOut
  /** `POST /auth/otp`. */
  requestOtp: RequestOtp
  /** `POST /auth/otp/verify`. */
  verifyOtp: VerifyOtp
  /** `POST /client-errors` (E-04). */
  reportClientError: ReportClientError
  /** `DELETE /me/sessions/{id}`. */
  revokeResidentSession: RevokeResidentSession
  /** `PATCH /me` (E-14). */
  updateResidentMe: UpdateResidentMe
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
  /** `PATCH /staff/me` (E-31). */
  updateStaffMe: UpdateStaffMe
  /** `POST /staff/accounts` (E-40). */
  createStaffAccount: CreateStaffAccount
  /** `PATCH /staff/accounts/{id}` (E-42). */
  updateStaffAccount: UpdateStaffAccount
  /** `POST /staff/accounts/{id}/lock` (E-43). */
  lockStaffAccount: LockStaffAccount
  /** `POST /staff/accounts/{id}/unlock` (E-44). */
  unlockStaffAccount: UnlockStaffAccount
  /** `POST /staff/accounts/{id}/disable` (E-45). */
  disableStaffAccount: DisableStaffAccount
  /** `POST /staff/accounts/{id}/enable` (E-46). */
  enableStaffAccount: EnableStaffAccount
}

export interface IdentityModule extends AppModule<'identity'> {
  /** Required, not optional: an optional `routes` would reach the Eden type of `App` as `Routes | undefined` and drop `/auth` and `/staff/me` from the client (P1-16). */
  readonly routes: IdentityRoutes
  readonly api: IdentityApi
  readonly useCases: IdentityUseCases
  /** The reads behind `GET /staff/me`, `GET /staff/sessions` and `GET /me`. */
  readonly queries: { staff: StaffQueries; sessions: SessionQueries; residents: ResidentQueries }
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
  const residents = new DrizzleResidentAccountRepository(database)
  const challenges = new DrizzleOtpChallengeRepository(database)
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
  const sms = new SmsCommands(outbox, deps.secretBox, clock, ids)
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
  const owners = new SessionOwners(sessions, staffAccounts, residents, events, config)
  const refreshSession = new RefreshSession(
    sessions,
    owners,
    events,
    factory,
    tokens,
    database,
    clock,
    ids,
    logger,
    config,
  )
  const requestOtp = new RequestOtp(
    new LibphonenumberPhones(),
    residents,
    challenges,
    limiter,
    new OutboxSmsProviderProbe(database, clock, config.smsDownFailures),
    factory,
    sms,
    database,
    clock,
    ids,
    logger,
    config,
  )
  const verifyOtp = new VerifyOtp(
    challenges,
    residents,
    deps.memberships,
    issuer,
    factory,
    database,
    clock,
    logger,
    config,
  )
  const revokeResidentSession = new RevokeResidentSession(sessions, events, database, clock)
  const updateResidentMe = new UpdateResidentMe(residents, clock)
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

  const safeguards = new StaffSafeguards(staffAccounts, deps.tickets)
  const staffSessions = new StaffSessions(sessions, events)
  const createStaffAccount = new CreateStaffAccount(
    database,
    staffAccounts,
    inviteIssuer,
    verifyStepUp,
    deps.building,
    ids,
    clock,
    deps.audited,
  )
  const updateStaffAccount = new UpdateStaffAccount(
    database,
    staffAccounts,
    safeguards,
    staffSessions,
    verifyStepUp,
    clock,
    deps.audited,
  )
  const updateStaffMe = new UpdateStaffMe(database, staffAccounts, deps.files, clock, deps.audited)
  const lockStaffAccount = new LockStaffAccount(
    database,
    staffAccounts,
    safeguards,
    staffSessions,
    clock,
    deps.audited,
  )
  const unlockStaffAccount = new UnlockStaffAccount(database, staffAccounts, clock, deps.audited)
  const disableStaffAccount = new DisableStaffAccount(
    database,
    staffAccounts,
    safeguards,
    staffSessions,
    clock,
    deps.audited,
  )
  const enableStaffAccount = new EnableStaffAccount(database, staffAccounts, clock, deps.audited)

  const staffQueries = new StaffQueries(staffAccounts, deps.files)
  const residentQueries = new ResidentQueries(residents, deps.memberships)
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
    new SendSmsHandler(residents, deps.secretBox, deps.sms, inbox, clock, logger, {
      brand: config.smsBrand,
      appUrl: config.appDownloadUrl,
    }),
  ]

  const reportClientError = new ReportClientError(limiter, accountLimiter, logger, config)
  const useCases: IdentityUseCases = {
    signInStaff,
    refreshSession,
    signOut,
    requestOtp,
    reportClientError,
    verifyOtp,
    revokeResidentSession,
    updateResidentMe,
    requestPasswordReset,
    setPassword,
    resendStaffInvite,
    requestStepUp,
    revokeStaffSession,
    createStaffAccount,
    updateStaffAccount,
    updateStaffMe,
    lockStaffAccount,
    unlockStaffAccount,
    disableStaffAccount,
    enableStaffAccount,
  }

  return {
    name: 'identity',
    api: new IdentityApiImpl(
      staffQueries,
      residentQueries,
      verifyStepUp,
      new EnsureResidentAccount(new LibphonenumberPhones(), residents, clock, ids),
      new ChangeResidentPhone(new LibphonenumberPhones(), residents, sessions, events, clock),
      new QueueMemberInvitation(residents, limiter, sms, clock, config),
      new ApproveResidentDeletion(residents, clock, deps.audited),
    ),
    useCases,
    queries: { staff: staffQueries, sessions: sessionQueries, residents: residentQueries },
    verifier: tokens,
    inviteIssuer,
    routes: createRoutes({
      ...useCases,
      staffQueries,
      residentQueries,
      sessionQueries,
      guards: deps.guards,
      idempotent: deps.idempotent,
      clock,
      verifier: tokens,
    }),
    handlers,
    outbox: { name: 'identity', table: identityOutbox, inboxTable: identityInbox },
    jobs: [],
  }
}
