import type { Database } from '@core/db'
import type { Idempotent } from '@core/http'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi, FilesApi } from '@mod/building/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import type { Guards } from '@rms/shared-types'
import { ResidencyApiImpl } from './application/api/residency-api-impl'
import { ClearProfileOnAccountDeletionHandler } from './application/handlers/clear-profile-on-account-deletion'
import { ImportPlanner } from './application/import-planner'
import { ImportQueries } from './application/queries/import-queries'
import { MembershipQueries } from './application/queries/membership-queries'
import { ChangeMembership } from './application/use-cases/change-membership'
import { CommitUnitOwnerImport } from './application/use-cases/commit-unit-owner-import'
import { ExpireImports } from './application/use-cases/expire-imports'
import { PurgeImports } from './application/use-cases/purge-imports'
import { UpdateProfile } from './application/use-cases/update-profile'
import { ValidateUnitOwnerImport } from './application/use-cases/validate-unit-owner-import'
import type { ResidencyApi } from './contracts'
import {
  ExceljsTemplateWriter,
  ExceljsWorkbookReader,
} from './infrastructure/excel/exceljs-workbook'
import { importExpireJob, importPurgeJob } from './infrastructure/jobs/import-jobs'
import { DrizzleAccountDeletionRepository } from './infrastructure/persistence/drizzle-account-deletion-repository'
import { DrizzleImportJobRepository } from './infrastructure/persistence/drizzle-import-job-repository'
import { DrizzleMembershipReader } from './infrastructure/persistence/drizzle-membership-reader'
import { DrizzleMembershipRepository } from './infrastructure/persistence/drizzle-membership-repository'
import { DrizzleResidentProfileRepository } from './infrastructure/persistence/drizzle-resident-profile-repository'
import { DrizzleUnitHistoryRepository } from './infrastructure/persistence/drizzle-unit-history-repository'
import { DrizzleUnitImportRepository } from './infrastructure/persistence/drizzle-unit-import-repository'
import { residencyInbox, residencyOutbox } from './infrastructure/persistence/schema'
import { LibphonenumberPhoneParser } from './infrastructure/phone/libphonenumber-phone-parser'
import { residencyManifest } from './manifest'
import { importRoutes } from './presentation/import-routes'

export interface ResidencyDeps {
  /** The time zone of the building for "today" (DR-09). */
  building: Pick<BuildingApi, 'getBuilding'>
  /** The files of an import: the upload is read, attached to its job and removed at the commit (DOC-37 §3). */
  files: Pick<FilesApi, 'read' | 'attach' | 'remove'>
  /** The accounts of the import: looked up by phone for the preview, created at the commit (DOC-18 §1.5, DOC-27 §9.2). */
  identity: Pick<
    IdentityApi,
    'findResidentAccountsByPhones' | 'findOrCreateResidentAccount' | 'getStaff'
  >
  guards: Guards
  /** E-72 takes an `Idempotency-Key` (DOC-50 §8.1). */
  idempotent: Idempotent
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
  /** `POST /staff/imports` with `kind = unit_owner` (E-72). */
  validateUnitOwnerImport: ValidateUnitOwnerImport
  /** `POST /staff/imports/{id}/commit` (E-74). */
  commitUnitOwnerImport: CommitUnitOwnerImport
  /** The batches of the jobs `import_expire` and `import_purge` (DOC-38 §4). */
  expireImports: ExpireImports
  purgeImports: PurgeImports
}

export interface ResidencyModule extends AppModule<'residency'> {
  readonly api: ResidencyApi
  readonly useCases: ResidencyUseCases
  /** The reads behind the import routes (E-71, E-73, E-169). */
  readonly queries: { imports: ImportQueries }
  readonly routes: ResidencyRoutes
}

/** The import routes; the other staff and household endpoints are P1-14 and P4-10. */
export type ResidencyRoutes = ReturnType<typeof importRoutes>

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

  const importJobs = new DrizzleImportJobRepository(database)
  const unitImports = new DrizzleUnitImportRepository(database)
  const planner = new ImportPlanner(
    new ExceljsWorkbookReader(),
    new LibphonenumberPhoneParser(),
    unitImports,
    deps.identity,
  )
  const validateUnitOwnerImport = new ValidateUnitOwnerImport(
    deps.files,
    planner,
    importJobs,
    deps.building,
    database,
    clock,
    ids,
  )
  const commitUnitOwnerImport = new CommitUnitOwnerImport(
    deps.files,
    planner,
    importJobs,
    unitImports,
    memberships,
    history,
    outbox,
    deps.identity,
    deps.building,
    deps.pii,
    deps.audited,
    database,
    clock,
    ids,
  )
  const expireImports = new ExpireImports(deps.files, importJobs, database, clock)
  const purgeImports = new PurgeImports(deps.files, importJobs, database, clock)
  const importQueries = new ImportQueries(
    importJobs,
    new ExceljsTemplateWriter(),
    deps.identity,
    clock,
  )

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
      validateUnitOwnerImport,
      commitUnitOwnerImport,
      expireImports,
      purgeImports,
    },
    queries: { imports: importQueries },
    routes: importRoutes({
      queries: importQueries,
      validate: validateUnitOwnerImport,
      commit: commitUnitOwnerImport,
      guards: deps.guards,
      idempotent: deps.idempotent,
    }),
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
    jobs: [importExpireJob(expireImports), importPurgeJob(purgeImports)],
  }
}
