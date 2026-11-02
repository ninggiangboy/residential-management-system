import { createGaplessCounter, type Database } from '@core/db'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { FilesApi } from '@mod/building/contracts'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { FeeImportApiImpl } from './application/api/fee-import-api-impl'
import { FinanceApiImpl } from './application/api/finance-api-impl'
import { FeeImportPlanner } from './application/fee-import-planner'
import type { UnitDirectory } from './application/ports'
import { FeeBatchQueries } from './application/queries/fee-batch-queries'
import { FeeImportQueries } from './application/queries/fee-import-queries'
import { AddDraftCharge } from './application/use-cases/add-draft-charge'
import { CommitFeeImport } from './application/use-cases/commit-fee-import'
import { CreateFeeBatch } from './application/use-cases/create-fee-batch'
import { DiscardFeeBatch } from './application/use-cases/discard-fee-batch'
import { RemoveDraftCharge } from './application/use-cases/remove-draft-charge'
import { ReplaceDraftCharge } from './application/use-cases/replace-draft-charge'
import { UpdateFeeBatch } from './application/use-cases/update-fee-batch'
import { ValidateFeeImport } from './application/use-cases/validate-fee-import'
import type { FeeImportApi, FinanceApi } from './contracts'
import { ExceljsFeeTemplateWriter } from './infrastructure/excel/exceljs-fee-template-writer'
import { ExceljsFeeWorkbookReader } from './infrastructure/excel/exceljs-workbook-reader'
import { DrizzleChargeRepository } from './infrastructure/persistence/drizzle-charge-repository'
import { DrizzleFeeBatchRepository } from './infrastructure/persistence/drizzle-fee-batch-repository'
import { DrizzleFeeImportRepository } from './infrastructure/persistence/drizzle-fee-import-repository'
import { DrizzleIntentReader } from './infrastructure/persistence/drizzle-intent-reader'

export interface FinanceModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
  /** The audit wrapper of `audit` (DOC-35 §3.2). */
  audited: Audited
  /** `ResidencyApi.findUnitsByCodes` (DOC-21 §2.1, DR-265). */
  units: UnitDirectory
  /** The import file: bytes at validation and commit, attached to its job (DOC-21 §2.1, DOC-37 §3). */
  files: Pick<FilesApi, 'read' | 'attach'>
  /** DOC-40: `import_validate_duration_seconds`, `import_commits_total` (DOC-21 §7). */
  metrics?: MetricsPort
}

/** What the routes of P2-15 call (DOC-12 §4.5). */
export interface FinanceUseCases {
  createFeeBatch: CreateFeeBatch
  updateFeeBatch: UpdateFeeBatch
  discardFeeBatch: DiscardFeeBatch
  replaceDraftCharge: ReplaceDraftCharge
  addDraftCharge: AddDraftCharge
  removeDraftCharge: RemoveDraftCharge
  validateFeeImport: ValidateFeeImport
  commitFeeImport: CommitFeeImport
}

export interface FinanceQueries {
  feeBatches: FeeBatchQueries
  feeImports: FeeImportQueries
}

export interface FinanceModule extends AppModule<'finance'> {
  /** `FinanceApi` (DOC-09 §7.2) for the other modules and `integrations/*`. */
  readonly api: FinanceApi
  /** The fee import behind the host's `/staff/imports` routes (DR-149, `integrations/residency`). */
  readonly feeImports: FeeImportApi
  readonly useCases: FinanceUseCases
  readonly queries: FinanceQueries
}

/**
 * Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). The draft use cases of
 * DOC-21 §3 are here (P2-04); the routes join with P2-15, the payment use cases with P2-06…P2-09.
 */
export function createFinanceModule(deps: FinanceModuleDeps): FinanceModule {
  const { database, ids, audited, clock, logger } = deps
  const metrics = deps.metrics ?? NO_METRICS
  const counter = createGaplessCounter(database, 'finance')
  const batches = new DrizzleFeeBatchRepository(database)
  const charges = new DrizzleChargeRepository(database)
  const imports = new DrizzleFeeImportRepository(database)
  const planner = new FeeImportPlanner(new ExceljsFeeWorkbookReader(), deps.units)
  const validateFeeImport = new ValidateFeeImport(
    deps.files,
    planner,
    imports,
    batches,
    database,
    clock,
    ids,
    logger,
    metrics,
  )
  const commitFeeImport = new CommitFeeImport(
    deps.files,
    planner,
    imports,
    batches,
    audited,
    database,
    clock,
    ids,
    logger,
    metrics,
  )
  const feeImportQueries = new FeeImportQueries(imports, new ExceljsFeeTemplateWriter(), clock)
  return {
    name: 'finance',
    api: new FinanceApiImpl(new DrizzleIntentReader(database)),
    feeImports: new FeeImportApiImpl(validateFeeImport, commitFeeImport, feeImportQueries),
    useCases: {
      createFeeBatch: new CreateFeeBatch(database, batches, counter, audited, ids),
      updateFeeBatch: new UpdateFeeBatch(database, batches, audited),
      discardFeeBatch: new DiscardFeeBatch(database, batches, audited),
      replaceDraftCharge: new ReplaceDraftCharge(database, charges, batches, audited, ids),
      addDraftCharge: new AddDraftCharge(database, charges, batches, deps.units, audited, ids),
      removeDraftCharge: new RemoveDraftCharge(database, charges, batches, audited),
      validateFeeImport,
      commitFeeImport,
    },
    queries: {
      feeBatches: new FeeBatchQueries(batches),
      feeImports: feeImportQueries,
    },
  }
}
