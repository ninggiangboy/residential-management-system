import { createGaplessCounter, type Database } from '@core/db'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import { DrizzleOutboxWriter } from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { FilesApi } from '@mod/building/contracts'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { ChargeAllocator } from './application/allocation/charge-allocator'
import { FeeImportApiImpl } from './application/api/fee-import-api-impl'
import { FinanceApiImpl } from './application/api/finance-api-impl'
import { FeeImportPlanner } from './application/fee-import-planner'
import { IntentCancellation } from './application/intent-cancellation'
import type {
  BuildingCalendar,
  PayerDirectory,
  ReceiptBuildingSource,
  UnitDirectory,
} from './application/ports'
import { DebtQueries } from './application/queries/debt-queries'
import { FeeBatchQueries } from './application/queries/fee-batch-queries'
import { FeeImportQueries } from './application/queries/fee-import-queries'
import { MoneyLogQueries } from './application/queries/money-log-queries'
import { Settlement } from './application/settle'
import { AddDraftCharge } from './application/use-cases/add-draft-charge'
import { CloseFeeBatch } from './application/use-cases/close-fee-batch'
import { CommitFeeImport } from './application/use-cases/commit-fee-import'
import { CreateFeeBatch } from './application/use-cases/create-fee-batch'
import { DiscardFeeBatch } from './application/use-cases/discard-fee-batch'
import { PublishFeeBatch } from './application/use-cases/publish-fee-batch'
import { RecallFeeBatch } from './application/use-cases/recall-fee-batch'
import { RecordManualPayment } from './application/use-cases/record-manual-payment'
import { ReissueFeeBatch } from './application/use-cases/reissue-fee-batch'
import { RemoveDraftCharge } from './application/use-cases/remove-draft-charge'
import { ReplaceDraftCharge } from './application/use-cases/replace-draft-charge'
import { ReviewMoneyLogRow } from './application/use-cases/review-money-log-row'
import { SendDebtReminders } from './application/use-cases/send-debt-reminders'
import { UpdateFeeBatch } from './application/use-cases/update-fee-batch'
import { ValidateFeeImport } from './application/use-cases/validate-fee-import'
import { VoidCharge } from './application/use-cases/void-charge'
import { VoidPayment } from './application/use-cases/void-payment'
import type { FeeImportApi, FinanceApi } from './contracts'
import { ExceljsFeeTemplateWriter } from './infrastructure/excel/exceljs-fee-template-writer'
import { ExceljsFeeWorkbookReader } from './infrastructure/excel/exceljs-workbook-reader'
import { DrizzleChargeRepository } from './infrastructure/persistence/drizzle-charge-repository'
import { DrizzleDebtRepository } from './infrastructure/persistence/drizzle-debt-repository'
import { DrizzleFeeBatchRepository } from './infrastructure/persistence/drizzle-fee-batch-repository'
import { DrizzleFeeImportRepository } from './infrastructure/persistence/drizzle-fee-import-repository'
import { DrizzleIntentReader } from './infrastructure/persistence/drizzle-intent-reader'
import { DrizzleIntentRepository } from './infrastructure/persistence/drizzle-intent-repository'
import { DrizzleLedgerRepository } from './infrastructure/persistence/drizzle-ledger-repository'
import { DrizzleMoneyLogRepository } from './infrastructure/persistence/drizzle-money-log-repository'
import { DrizzlePaymentRepository } from './infrastructure/persistence/drizzle-payment-repository'
import { DrizzleSettlementRepository } from './infrastructure/persistence/drizzle-settlement-repository'
import { financeOutbox } from './infrastructure/persistence/schema'
import { financeManifest } from './manifest'

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
  /** The building's zone for `buildingToday` (DOC-21 §2.1, DR-09). */
  calendar: BuildingCalendar
  /** The company block and the building name a receipt freezes (DOC-22 §7). */
  receiptBuildings: ReceiptBuildingSource
  /** The payer of an online payment (DOC-23 §2.2). */
  payers: PayerDirectory
  /** `OUTBOX_MAX_PAYLOAD_BYTES` (DOC-41). */
  outboxMaxPayloadBytes: number
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
  publishFeeBatch: PublishFeeBatch
  closeFeeBatch: CloseFeeBatch
  reissueFeeBatch: ReissueFeeBatch
  recallFeeBatch: RecallFeeBatch
  voidCharge: VoidCharge
  recordManualPayment: RecordManualPayment
  voidPayment: VoidPayment
  reviewMoneyLogRow: ReviewMoneyLogRow
  sendDebtReminders: SendDebtReminders
}

export interface FinanceQueries {
  feeBatches: FeeBatchQueries
  feeImports: FeeImportQueries
  debts: DebtQueries
  moneyLog: MoneyLogQueries
}

export interface FinanceModule extends AppModule<'finance'> {
  /** `FinanceApi` (DOC-09 §7.2) for the other modules and `integrations/*`. */
  readonly api: FinanceApi
  /** The fee import behind the host's `/staff/imports` routes (DR-149, `integrations/residency`). */
  readonly feeImports: FeeImportApi
  readonly useCases: FinanceUseCases
  readonly queries: FinanceQueries
  /** `settle()` for the webhook (P2-23), the re-query and cancel handler (P2-24) and the statement path (DOC-23 §6, P2-06). */
  readonly settlement: Settlement
}

/**
 * Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). The batch use cases of
 * DOC-21 §3 (P2-04, P2-05, P2-07), `settle()` (P2-06), the manual payment (P2-08), the payment void and money log (P2-09) and
 * debt and reminders (P2-10) are here; the routes join with P2-15.
 */
export function createFinanceModule(deps: FinanceModuleDeps): FinanceModule {
  const { database, ids, audited, clock, logger } = deps
  const metrics = deps.metrics ?? NO_METRICS
  const counter = createGaplessCounter(database, 'finance')
  const batches = new DrizzleFeeBatchRepository(database)
  const charges = new DrizzleChargeRepository(database)
  const imports = new DrizzleFeeImportRepository(database)
  const ledger = new DrizzleLedgerRepository(database)
  const intents = new DrizzleIntentRepository(database)
  const payments = new DrizzlePaymentRepository(database)
  const debts = new DrizzleDebtRepository(database)
  const moneyLog = new DrizzleMoneyLogRepository(database)
  const outbox = new DrizzleOutboxWriter(database, financeOutbox, () => ids.next(), {
    source: 'finance',
    types: new Set(Object.keys(financeManifest.outboxPolicies)),
    maxPayloadBytes: deps.outboxMaxPayloadBytes,
  })
  const allocator = new ChargeAllocator(ledger, counter, outbox, clock, ids)
  const cancellation = new IntentCancellation(intents, outbox, clock)
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
      updateFeeBatch: new UpdateFeeBatch(database, batches, audited, outbox, clock, logger),
      discardFeeBatch: new DiscardFeeBatch(database, batches, audited),
      replaceDraftCharge: new ReplaceDraftCharge(database, charges, batches, audited, ids),
      addDraftCharge: new AddDraftCharge(database, charges, batches, deps.units, audited, ids),
      removeDraftCharge: new RemoveDraftCharge(database, charges, batches, audited),
      validateFeeImport,
      commitFeeImport,
      publishFeeBatch: new PublishFeeBatch(
        database,
        batches,
        deps.calendar,
        outbox,
        audited,
        clock,
        logger,
      ),
      closeFeeBatch: new CloseFeeBatch(database, batches, audited, logger),
      reissueFeeBatch: new ReissueFeeBatch(database, batches, counter, audited, ids, logger),
      recallFeeBatch: new RecallFeeBatch(
        database,
        batches,
        cancellation,
        outbox,
        audited,
        clock,
        logger,
      ),
      voidCharge: new VoidCharge(
        database,
        charges,
        batches,
        cancellation,
        outbox,
        audited,
        clock,
        logger,
      ),
      recordManualPayment: new RecordManualPayment(
        database,
        payments,
        ledger,
        allocator,
        cancellation,
        deps.calendar,
        deps.receiptBuildings,
        outbox,
        audited,
        clock,
        ids,
        logger,
      ),
      voidPayment: new VoidPayment(database, payments, outbox, audited, clock, logger),
      reviewMoneyLogRow: new ReviewMoneyLogRow(database, moneyLog, audited, logger),
      sendDebtReminders: new SendDebtReminders(
        database,
        debts,
        deps.calendar,
        outbox,
        clock,
        ids,
        logger,
      ),
    },
    queries: {
      feeBatches: new FeeBatchQueries(batches),
      feeImports: feeImportQueries,
      debts: new DebtQueries(debts, deps.calendar, clock),
      moneyLog: new MoneyLogQueries(moneyLog),
    },
    settlement: new Settlement(
      database,
      new DrizzleSettlementRepository(database),
      intents,
      ledger,
      allocator,
      cancellation,
      deps.receiptBuildings,
      deps.payers,
      outbox,
      audited,
      clock,
      ids,
      logger,
    ),
  }
}
