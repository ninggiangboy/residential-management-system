import type { Database } from '@core/db'
import type { Idempotent } from '@core/http'
import type { Clock, IdGenerator, Log, SecretBox } from '@core/kernel'
import { DrizzleInboxGuard, DrizzleOutboxWriter } from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi, FilesApi } from '@mod/building/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import { type DemoResettable, type Guards, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import { ResidencyApiImpl } from './application/api/residency-api-impl'
import { ResidencyDemo } from './application/demo-residency'
import { ClearProfileOnAccountDeletionHandler } from './application/handlers/clear-profile-on-account-deletion'
import { ImportPlanner } from './application/import-planner'
import { ImportQueries } from './application/queries/import-queries'
import { LookupQueries } from './application/queries/lookup-queries'
import { MembershipQueries } from './application/queries/membership-queries'
import { PiiKeyQueries } from './application/queries/pii-key-queries'
import { ResidentQueries } from './application/queries/resident-queries'
import { UnitQueries } from './application/queries/unit-queries'
import { UnitTypeQueries } from './application/queries/unit-type-queries'
import { ApproveAccountDeletion } from './application/use-cases/approve-account-deletion'
import { ChangeLoginPhone } from './application/use-cases/change-login-phone'
import { ChangeMembership } from './application/use-cases/change-membership'
import { CommitUnitOwnerImport } from './application/use-cases/commit-unit-owner-import'
import { CreateResident } from './application/use-cases/create-resident'
import { CreateUnit } from './application/use-cases/create-unit'
import { CreateUnitType } from './application/use-cases/create-unit-type'
import { ExpireImports } from './application/use-cases/expire-imports'
import { PurgeImports } from './application/use-cases/purge-imports'
import { TransferOwnership } from './application/use-cases/transfer-ownership'
import { UpdateProfile } from './application/use-cases/update-profile'
import { UpdateUnit } from './application/use-cases/update-unit'
import { UpdateUnitType } from './application/use-cases/update-unit-type'
import { ValidateUnitOwnerImport } from './application/use-cases/validate-unit-owner-import'
import type { ResidencyApi } from './contracts'
import {
  ExceljsTemplateWriter,
  ExceljsWorkbookReader,
} from './infrastructure/excel/exceljs-workbook'
import { importExpireJob, importPurgeJob } from './infrastructure/jobs/import-jobs'
import { DrizzleAccountDeletionRepository } from './infrastructure/persistence/drizzle-account-deletion-repository'
import { DrizzleDemoRepository } from './infrastructure/persistence/drizzle-demo-repository'
import { DrizzleImportJobRepository } from './infrastructure/persistence/drizzle-import-job-repository'
import { DrizzleMembershipReader } from './infrastructure/persistence/drizzle-membership-reader'
import { DrizzleMembershipRepository } from './infrastructure/persistence/drizzle-membership-repository'
import { DrizzlePiiKeyReader } from './infrastructure/persistence/drizzle-pii-key-reader'
import { DrizzleResidentProfileRepository } from './infrastructure/persistence/drizzle-resident-profile-repository'
import { DrizzleResidentReader } from './infrastructure/persistence/drizzle-resident-reader'
import { DrizzleUnitHistoryRepository } from './infrastructure/persistence/drizzle-unit-history-repository'
import { DrizzleUnitImportRepository } from './infrastructure/persistence/drizzle-unit-import-repository'
import { DrizzleUnitReader } from './infrastructure/persistence/drizzle-unit-reader'
import { DrizzleUnitRepository } from './infrastructure/persistence/drizzle-unit-repository'
import { DrizzleUnitTypeReader } from './infrastructure/persistence/drizzle-unit-type-reader'
import { DrizzleUnitTypeRepository } from './infrastructure/persistence/drizzle-unit-type-repository'
import { residencyInbox, residencyOutbox } from './infrastructure/persistence/schema'
import { LibphonenumberPhoneParser } from './infrastructure/phone/libphonenumber-phone-parser'
import { residencyManifest } from './manifest'
import { residencyRoutes } from './presentation/residency-routes'

export interface ResidencyDeps {
  /** The time zone of the building for "today" (DR-09). */
  building: Pick<BuildingApi, 'getBuilding' | 'getSettings' | 'assertDemo'>
  /** The files of an import: the upload is read, attached to its job and removed at the commit (DOC-37 §3). */
  files: Pick<FilesApi, 'read' | 'attach' | 'remove'>
  /**
   * The accounts the module reads and writes: looked up by phone for the import preview and created at the commit (DOC-18 §1.5,
   * DOC-27 §9.2), named and phoned in the staff lists, searched by phone fragment, moved to a new login phone (DOC-27 §2.2).
   */
  identity: Pick<
    IdentityApi,
    | 'findResidentAccountsByPhones'
    | 'findOrCreateResidentAccount'
    | 'getStaff'
    | 'getResidentAccounts'
    | 'changeResidentPhone'
    | 'findResidentAccountsByPhoneFragment'
    | 'listDeletionRequests'
    | 'approveResidentDeletion'
  >
  guards: Guards
  /** `MetricsPort` of the host (DOC-40 §4.3). */
  metrics?: MetricsPort
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

/** What the staff routes call (DOC-12 §4.5). */
export interface ResidencyUseCases {
  /** `PATCH /staff/memberships/{id}` (E-69, DOC-27 §6). */
  changeMembership: ChangeMembership
  /** `PATCH /staff/residents/{accountId}` (E-66, DOC-27 §5.3). */
  updateProfile: UpdateProfile
  /** `POST /staff/units` (E-58) and `PATCH /staff/units/{id}` (E-60), DOC-27 §4. */
  createUnit: CreateUnit
  updateUnit: UpdateUnit
  /** `POST /staff/unit-types` (E-181) and `PATCH /staff/unit-types/{id}` (E-182), DOC-27 §4.3. */
  createUnitType: CreateUnitType
  updateUnitType: UpdateUnitType
  /** `POST /staff/residents` (E-64, DOC-27 §5.1). */
  createResident: CreateResident
  /** `POST /staff/units/{id}/owner` (E-61, DOC-27 §7). */
  transferOwnership: TransferOwnership
  /** `PATCH /staff/residents/{accountId}/phone` (E-67, DOC-27 §8). */
  changeLoginPhone: ChangeLoginPhone
  approveAccountDeletion: ApproveAccountDeletion
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
  /** `residency`'s part of the demo reset, which the host hands to `building` (DOC-36 §10.2). */
  readonly demo: DemoResettable
  readonly useCases: ResidencyUseCases
  /** The reads behind the staff routes: the imports (E-71, E-73, E-169), the units, the residents and the lookup. */
  readonly queries: {
    imports: ImportQueries
    units: UnitQueries
    unitTypes: UnitTypeQueries
    residents: ResidentQueries
    lookups: LookupQueries
  }
  readonly routes: ResidencyRoutes
}

/** The staff routes; the household endpoints of the owner are P4-10. */
export type ResidencyRoutes = ReturnType<typeof residencyRoutes>

/** Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). */
export function createResidencyModule(deps: ResidencyModuleDeps): ResidencyModule {
  const { database, clock, ids, logger } = deps
  const metrics = deps.metrics ?? NO_METRICS

  const memberships = new DrizzleMembershipRepository(database)
  const profiles = new DrizzleResidentProfileRepository(database)
  const history = new DrizzleUnitHistoryRepository(database)

  const outbox = new DrizzleOutboxWriter(database, residencyOutbox, () => ids.next(), {
    source: 'residency',
    types: new Set(Object.keys(residencyManifest.outboxPolicies)),
    maxPayloadBytes: deps.outboxMaxPayloadBytes,
  })
  const inbox = new DrizzleInboxGuard(database, residencyInbox)

  const membershipReader = new DrizzleMembershipReader(database)
  const queries = new MembershipQueries(membershipReader)
  const units = new DrizzleUnitRepository(database)
  const unitReader = new DrizzleUnitReader(database)
  const unitTypes = new DrizzleUnitTypeRepository(database)
  const unitTypeReader = new DrizzleUnitTypeReader(database)
  const unitTypeQueries = new UnitTypeQueries(unitTypeReader)
  const residentReader = new DrizzleResidentReader(database)
  const phones = new LibphonenumberPhoneParser()
  const lookups = new LookupQueries(unitReader, residentReader, deps.identity)
  const unitQueries = new UnitQueries(units, unitReader, memberships, residentReader, deps.identity)
  const residentQueries = new ResidentQueries(
    database,
    residentReader,
    lookups,
    deps.identity,
    deps.building,
    deps.pii,
    deps.audited,
  )

  const importJobs = new DrizzleImportJobRepository(database)
  const unitImports = new DrizzleUnitImportRepository(database)
  const planner = new ImportPlanner(new ExceljsWorkbookReader(), phones, unitImports, deps.identity)
  const validateUnitOwnerImport = new ValidateUnitOwnerImport(
    deps.files,
    planner,
    importJobs,
    deps.building,
    database,
    clock,
    ids,
    metrics,
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
    metrics,
  )
  const expireImports = new ExpireImports(deps.files, importJobs, database, clock)
  const purgeImports = new PurgeImports(deps.files, importJobs, database, clock)
  const importQueries = new ImportQueries(
    importJobs,
    new ExceljsTemplateWriter(),
    deps.identity,
    clock,
  )

  const changeMembership = new ChangeMembership(
    database,
    memberships,
    history,
    outbox,
    deps.audited,
    clock,
    ids,
    metrics,
  )
  const updateProfile = new UpdateProfile(
    database,
    profiles,
    deps.building,
    deps.pii,
    deps.audited,
    clock,
  )
  const createUnit = new CreateUnit(database, units, unitTypes, deps.audited, clock, ids)
  const updateUnit = new UpdateUnit(database, units, unitTypes, history, deps.audited, clock, ids)
  const createUnitType = new CreateUnitType(database, unitTypes, deps.audited, clock, ids)
  const updateUnitType = new UpdateUnitType(
    database,
    unitTypes,
    unitTypeReader,
    deps.audited,
    clock,
  )
  const createResident = new CreateResident(
    database,
    units,
    memberships,
    profiles,
    history,
    outbox,
    deps.identity,
    deps.audited,
    clock,
    ids,
    metrics,
  )
  const transferOwnership = new TransferOwnership(
    database,
    units,
    memberships,
    profiles,
    history,
    outbox,
    deps.identity,
    deps.audited,
    clock,
    ids,
    metrics,
  )
  const changeLoginPhone = new ChangeLoginPhone(
    database,
    profiles,
    phones,
    deps.identity,
    deps.audited,
  )
  const approveAccountDeletion = new ApproveAccountDeletion(
    database,
    profiles,
    membershipReader,
    deps.building,
    deps.identity,
  )

  return {
    name: 'residency',
    docs: [
      {
        name: 'residency',
        description:
          'Staff-side management of units, residents, memberships and the Excel import of units and owners.',
      },
    ],
    api: new ResidencyApiImpl(
      queries,
      lookups,
      new PiiKeyQueries(new DrizzlePiiKeyReader(database)),
    ),
    demo: new ResidencyDemo(deps.building, new DrizzleDemoRepository(database)),
    useCases: {
      changeMembership,
      updateProfile,
      createUnit,
      updateUnit,
      createUnitType,
      updateUnitType,
      createResident,
      transferOwnership,
      changeLoginPhone,
      approveAccountDeletion,
      validateUnitOwnerImport,
      commitUnitOwnerImport,
      expireImports,
      purgeImports,
    },
    queries: {
      imports: importQueries,
      units: unitQueries,
      unitTypes: unitTypeQueries,
      residents: residentQueries,
      lookups,
    },
    routes: residencyRoutes({
      queries: importQueries,
      validate: validateUnitOwnerImport,
      commit: commitUnitOwnerImport,
      unitQueries,
      createUnit,
      updateUnit,
      unitTypeQueries,
      createUnitType,
      updateUnitType,
      transferOwnership,
      residentQueries,
      createResident,
      updateProfile,
      changeLoginPhone,
      approveAccountDeletion,
      changeMembership,
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
    gauges: [
      {
        name: 'units_without_owner',
        help: 'Units that are not vacant and have no owner (informational, DOC-27 §15).',
        read: async () => {
          // scope-ok: system-wide by design, like the other business gauges of DOC-40 §4 (one deployment, one building)
          const [row] = await database.db.execute<{ n: number }>(sql`
            SELECT count(*)::int AS n FROM residency.unit u
             WHERE u.occupancy <> 'vacant'
               AND NOT EXISTS (SELECT 1 FROM residency.membership m
                                WHERE m.unit_id = u.id AND m.member_type = 'owner' AND m.status <> 'removed')`)
          return [{ value: row?.n ?? 0 }]
        },
      },
    ],
  }
}
