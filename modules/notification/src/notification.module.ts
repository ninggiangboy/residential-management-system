import type { Database } from '@core/db'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { BuildingApi } from '@mod/building/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import type { ResidencyApi } from '@mod/residency/contracts'
import type { DemoResettable } from '@rms/shared-types'
import { type Guards, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { NotificationDemo } from './application/demo-notification'
import { CreateInboxEntries } from './application/handlers/create-inbox-entries'
import { DropDeviceTokenOnSessionRevokedHandler } from './application/handlers/drop-device-token-on-session-revoked'
import { DropTokensOnAccountDeletionHandler } from './application/handlers/drop-tokens-on-account-deletion'
import { MarkReadOnNoticeReadHandler } from './application/handlers/mark-read-on-notice-read'
import { SendExpoPush } from './application/handlers/send-expo-push'
import { assertIntegrations } from './application/install-rules'
import type { PushConfig } from './application/push-config'
import type { PushSender } from './application/push-sender'
import { InboxQueries } from './application/queries/inbox-queries'
import { RecipientResolver } from './application/recipient-resolver'
import { MarkInboxEntryRead } from './application/use-cases/mark-inbox-entry-read'
import { ReadAllInbox } from './application/use-cases/read-all-inbox'
import { RegisterDevice } from './application/use-cases/register-device'
import { RemoveDevice } from './application/use-cases/remove-device'
import type { NotificationIntegration } from './contracts'
import { inboxPurgeJob } from './infrastructure/jobs/inbox-purge'
import { pushReceiptsJob } from './infrastructure/jobs/push-receipts'
import { DrizzleDeviceTokenRepository } from './infrastructure/persistence/drizzle-device-token-repository'
import { DrizzleInboxEntryRepository } from './infrastructure/persistence/drizzle-inbox-entry-repository'
import { DrizzlePushTicketRepository } from './infrastructure/persistence/drizzle-push-ticket-repository'
import { notificationInbox, notificationOutbox } from './infrastructure/persistence/schema'
import { ConsolePushSender } from './infrastructure/push/console-push-sender'
import { ExpoPushSender } from './infrastructure/push/expo-push-sender'
import { notificationManifest } from './manifest'
import { residentNotificationRoutes } from './presentation/resident-routes'
import { staffNotificationRoutes } from './presentation/staff-routes'

/** The keys of DOC-31 §9 that the module reads, resolved by `apps/api` (DOC-41 §6, §14). */
export interface NotificationConfig extends PushConfig {
  /** `PUSH_DRIVER`: `console` logs the rendered text without the token (`local`, `test`), `expo` sends. */
  pushDriver: 'expo' | 'console'
  /** `EXPO_PUSH_BASE_URL`. */
  expoPushBaseUrl: string
  /** `EXPO_ACCESS_TOKEN`: required in staging and production (DR-52). */
  expoAccessToken: string | null
  /** `JOB_INBOX_PURGE_GRACE_MINUTES` (DOC-41 §11). */
  inboxPurgeGraceMinutes: number
  /** `OUTBOX_MAX_PAYLOAD_BYTES`. */
  outboxMaxPayloadBytes: number
}

export interface NotificationDeps {
  /** The producers' `integrations/notification` objects, handed in by `apps/api` (DOC-12 §4.4). */
  integrations: readonly NotificationIntegration[]
  residency: Pick<ResidencyApi, 'listRecipients' | 'getMembership' | 'activeUnitIds'>
  identity: Pick<
    IdentityApi,
    'listActiveStaff' | 'getStaff' | 'getResidentAccounts' | 'liveSessionIds'
  >
  /** The demo reset asserts that a building is a demo one first (DOC-36 §10.2). */
  building: Pick<BuildingApi, 'assertDemo'>
  guards: Guards
  config: NotificationConfig
  metrics?: MetricsPort
  /** A sender for a test; the driver of the config builds the real one. */
  sender?: PushSender
  /** The `fetch` the Expo client uses; `globalThis.fetch` when absent. */
  fetch?: typeof globalThis.fetch
}

export interface NotificationModuleDeps extends NotificationDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

export interface NotificationModule extends AppModule<'notification'> {
  readonly useCases: {
    registerDevice: RegisterDevice
    removeDevice: RemoveDevice
    readAllInbox: ReadAllInbox
    markInboxEntryRead: MarkInboxEntryRead
  }
  readonly queries: { inbox: InboxQueries }
  /** The demo reset and seed of DOC-31 §12 read the repository through this. */
  readonly inboxEntries: DrizzleInboxEntryRepository
  /** `notification`'s part of the demo reset, which the host hands to `building` (DOC-31 §12, DOC-36 §10.2). */
  readonly demo: DemoResettable
  readonly residentRoutes: ReturnType<typeof residentNotificationRoutes>
  readonly staffRoutes: ReturnType<typeof staffNotificationRoutes>
}

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createNotificationModule(deps: NotificationModuleDeps): NotificationModule {
  const { database, clock, ids, logger, config } = deps
  const metrics = deps.metrics ?? NO_METRICS
  assertIntegrations(deps.integrations)

  const entries = new DrizzleInboxEntryRepository(database)
  const devices = new DrizzleDeviceTokenRepository(database)
  const tickets = new DrizzlePushTicketRepository(database)
  const inbox = new DrizzleInboxGuard(database, notificationInbox)
  const outbox = new DrizzleOutboxWriter(database, notificationOutbox, () => ids.next(), {
    source: 'notification',
    types: new Set(Object.keys(notificationManifest.outboxPolicies)),
    maxPayloadBytes: config.outboxMaxPayloadBytes,
  })
  const resolver = new RecipientResolver({ residency: deps.residency, identity: deps.identity })
  const sender: PushSender =
    deps.sender ??
    (config.pushDriver === 'expo'
      ? new ExpoPushSender(
          deps.fetch ?? globalThis.fetch,
          config.expoPushBaseUrl,
          config.expoAccessToken,
          config.requestTimeoutMs,
          (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          logger,
          metrics,
        )
      : new ConsolePushSender(logger))

  const registerDevice = new RegisterDevice(devices, ids)
  const removeDevice = new RemoveDevice(devices)
  const readAllInbox = new ReadAllInbox(entries, deps.residency)
  const markInboxEntryRead = new MarkInboxEntryRead(entries, deps.residency)
  const inboxQueries = new InboxQueries(entries, deps.residency)

  const createEntries = deps.integrations.flatMap((integration) =>
    integration.rules.map(
      (rule) =>
        new CreateInboxEntries(
          rule,
          resolver,
          entries,
          outbox,
          inbox,
          ids,
          clock,
          metrics,
          config.chunkSize,
        ),
    ),
  )

  return {
    name: 'notification',
    docs: [
      {
        name: 'notification',
        description:
          'The inbox of residents and staff and the registration of push tokens. Entries carry a template key and params; the client renders the text.',
      },
    ],
    useCases: { registerDevice, removeDevice, readAllInbox, markInboxEntryRead },
    queries: { inbox: inboxQueries },
    inboxEntries: entries,
    demo: new NotificationDemo(deps.building, entries, ids),
    residentRoutes: residentNotificationRoutes({
      registerDevice,
      removeDevice,
      inboxQueries,
      readAllInbox,
      markInboxEntryRead,
      guards: deps.guards,
    }),
    staffRoutes: staffNotificationRoutes({
      registerDevice,
      removeDevice,
      inboxQueries,
      readAllInbox,
      markInboxEntryRead,
      guards: deps.guards,
    }),
    handlers: [
      ...createEntries,
      new MarkReadOnNoticeReadHandler(entries, inbox),
      new DropDeviceTokenOnSessionRevokedHandler(devices, inbox, logger),
      new DropTokensOnAccountDeletionHandler(devices, inbox, logger),
      new SendExpoPush(
        devices,
        tickets,
        deps.identity,
        sender,
        inbox,
        { run: (fn) => database.transaction(fn) },
        clock,
        ids,
        logger,
        metrics,
        config,
      ),
    ],
    outbox: { name: 'notification', table: notificationOutbox, inboxTable: notificationInbox },
    jobs: [
      pushReceiptsJob(tickets, devices, sender, config, metrics),
      inboxPurgeJob(entries, config, config.inboxPurgeGraceMinutes),
    ],
  }
}
