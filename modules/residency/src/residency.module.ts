import type { Database } from '@core/db'
import { routePlugin } from '@core/http'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi } from '@mod/building/contracts'
import { ResidencyApiImpl } from './application/api/residency-api-impl'
import { ClearProfileOnAccountDeletionHandler } from './application/handlers/clear-profile-on-account-deletion'
import { MembershipQueries } from './application/queries/membership-queries'
import { ChangeMembership } from './application/use-cases/change-membership'
import { UpdateProfile } from './application/use-cases/update-profile'
import type { ResidencyApi } from './contracts'
import { DrizzleAccountDeletionRepository } from './infrastructure/persistence/drizzle-account-deletion-repository'
import { DrizzleMembershipReader } from './infrastructure/persistence/drizzle-membership-reader'
import { DrizzleMembershipRepository } from './infrastructure/persistence/drizzle-membership-repository'
import { DrizzleResidentProfileRepository } from './infrastructure/persistence/drizzle-resident-profile-repository'
import { DrizzleUnitHistoryRepository } from './infrastructure/persistence/drizzle-unit-history-repository'
import { residencyInbox, residencyOutbox } from './infrastructure/persistence/schema'
import { residencyManifest } from './manifest'

export interface ResidencyDeps {
  /** The time zone of the building for "today" (DR-09). */
  building: Pick<BuildingApi, 'getBuilding'>
  /**
   * The PII key ring of DR-65 as a box, read on first use: a `worker` holds no ring and never seals (it only clears profiles).
   */
  pii: () => SecretBox
  audited: Audited
  /** `OUTBOX_MAX_PAYLOAD_BYTES`. */
  outboxMaxPayloadBytes: number
}

export interface ResidencyModuleDeps extends ResidencyDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

/** What the staff routes of P1-14 call (DOC-12 §4.5). */
export interface ResidencyUseCases {
  /** `PATCH /staff/memberships/{id}` (DOC-27 §6). */
  changeMembership: ChangeMembership
  /** `PATCH /staff/residents/{accountId}` (DOC-27 §5.3). */
  updateProfile: UpdateProfile
}

export interface ResidencyModule extends AppModule<'residency'> {
  readonly api: ResidencyApi
  readonly useCases: ResidencyUseCases
  readonly routes: ResidencyRoutes
}

/** No route yet: the staff and household endpoints are P1-14 and P4-10, and the guard they use is built by `apps/api`. */
export type ResidencyRoutes = ReturnType<typeof routePlugin>

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createResidencyModule(deps: ResidencyModuleDeps): ResidencyModule {
  const { database, clock, ids, logger } = deps

  const memberships = new DrizzleMembershipRepository(database)
  const profiles = new DrizzleResidentProfileRepository(database)
  const history = new DrizzleUnitHistoryRepository(database)

  const outbox = new DrizzleOutboxWriter(database, residencyOutbox, () => ids.next(), {
    source: 'residency',
    types: new Set(Object.keys(residencyManifest.outboxPolicies)),
    maxPayloadBytes: deps.outboxMaxPayloadBytes,
  })
  const inbox = new DrizzleInboxGuard(database, residencyInbox)

  const queries = new MembershipQueries(new DrizzleMembershipReader(database))

  return {
    name: 'residency',
    api: new ResidencyApiImpl(queries),
    useCases: {
      changeMembership: new ChangeMembership(
        database,
        memberships,
        history,
        outbox,
        deps.audited,
        clock,
        ids,
      ),
      updateProfile: new UpdateProfile(
        database,
        profiles,
        deps.building,
        deps.pii,
        deps.audited,
        clock,
      ),
    },
    routes: routePlugin(),
    handlers: [
      new ClearProfileOnAccountDeletionHandler(
        new DrizzleAccountDeletionRepository(database),
        history,
        outbox,
        inbox,
        clock,
        ids,
        logger,
      ),
    ],
    outbox: { name: 'residency', table: residencyOutbox, inboxTable: residencyInbox },
    jobs: [],
  }
}
