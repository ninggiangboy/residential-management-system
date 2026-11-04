import { createGaplessCounter, type Database } from '@core/db'
import { type Idempotent, routePlugin } from '@core/http'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import {
  DrizzleInboxGuard,
  DrizzleOutboxWriter,
  type IntegrationEventHandler,
} from '@core/messaging'
import type { AppModule } from '@core/runtime'
import type { Audited } from '@mod/audit/contracts'
import type { FilesApi } from '@mod/building/contracts'
import { type Guards, type MetricsPort, NO_METRICS } from '@rms/shared-types'
import { ChargeAllocator } from './application/allocation/charge-allocator'
import { FeeImportApiImpl } from './application/api/fee-import-api-impl'
import { FinanceApiImpl } from './application/api/finance-api-impl'
import { FeeImportPlanner } from './application/fee-import-planner'
import { FeeNoticeCache } from './application/fee-notice-cache'
import { RenderReceiptPdfHandler } from './application/handlers/render-receipt-pdf'
import { IntentCancellation } from './application/intent-cancellation'
import type { PdfRenderer } from './application/pdf-renderer'
import type {
  BuildingCalendar,
  NoticeContextSource,
  NoticeLanguageSource,
  PayerDirectory,
  ReceiptBuildingSource,
  UnitDirectory,
} from './application/ports'
import { DebtQueries } from './application/queries/debt-queries'
import { FeeBatchQueries } from './application/queries/fee-batch-queries'
import { FeeImportQueries } from './application/queries/fee-import-queries'
import { FeeNoticeQueries } from './application/queries/fee-notice-queries'
import { MoneyLogQueries } from './application/queries/money-log-queries'
import { ReceiptPdfQueries } from './application/queries/receipt-pdf-queries'
import { ResidentFeeQueries } from './application/queries/resident-fee-queries'
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
import { RenderFeeNoticePdf } from './application/use-cases/render-fee-notice-pdf'
import { RenderReceiptPdf } from './application/use-cases/render-receipt-pdf'
import { ReplaceDraftCharge } from './application/use-cases/replace-draft-charge'
import { RequestFeeNoticeZip } from './application/use-cases/request-fee-notice-zip'
import { ReviewMoneyLogRow } from './application/use-cases/review-money-log-row'
import { RunFeeNoticeJob } from './application/use-cases/run-fee-notice-job'
import { SendDebtReminders } from './application/use-cases/send-debt-reminders'
import { UpdateFeeBatch } from './application/use-cases/update-fee-batch'
import { ValidateFeeImport } from './application/use-cases/validate-fee-import'
import { VoidCharge } from './application/use-cases/void-charge'
import { VoidPayment } from './application/use-cases/void-payment'
import type { FeeImportApi, FinanceApi } from './contracts'
import { ExceljsFeeTemplateWriter } from './infrastructure/excel/exceljs-fee-template-writer'
import { ExceljsFeeWorkbookReader } from './infrastructure/excel/exceljs-workbook-reader'
import { FilesLogoSource } from './infrastructure/files-logo-source'
import { feeNoticeRunJob } from './infrastructure/jobs/fee-notice-run'
import { invariantCheckJob, type LedgerCheckBuildings } from './infrastructure/jobs/invariant-check'
import { HostPdfRenderer } from './infrastructure/pdf/host-pdf-renderer'
import { DrizzleChargeRepository } from './infrastructure/persistence/drizzle-charge-repository'
import { DrizzleDebtRepository } from './infrastructure/persistence/drizzle-debt-repository'
import { DrizzleFeeBatchRepository } from './infrastructure/persistence/drizzle-fee-batch-repository'
import { DrizzleFeeImportRepository } from './infrastructure/persistence/drizzle-fee-import-repository'
import { DrizzleFeeNoticeJobRepository } from './infrastructure/persistence/drizzle-fee-notice-job-repository'
import { DrizzleIntentReader } from './infrastructure/persistence/drizzle-intent-reader'
import { DrizzleIntentRepository } from './infrastructure/persistence/drizzle-intent-repository'
import { DrizzleInvariantReader } from './infrastructure/persistence/drizzle-invariant-reader'
import { DrizzleLedgerRepository } from './infrastructure/persistence/drizzle-ledger-repository'
import { DrizzleMoneyLogRepository } from './infrastructure/persistence/drizzle-money-log-repository'
import { DrizzlePaymentRepository } from './infrastructure/persistence/drizzle-payment-repository'
import { DrizzleReceiptPdfRepository } from './infrastructure/persistence/drizzle-receipt-pdf-repository'
import { DrizzleResidentFeeReader } from './infrastructure/persistence/drizzle-resident-fee-reader'
import { DrizzleSettlementRepository } from './infrastructure/persistence/drizzle-settlement-repository'
import { financeInbox, financeOutbox } from './infrastructure/persistence/schema'
import { financeManifest } from './manifest'
import { financeRoutes } from './presentation/finance-routes'

export interface FinanceModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
  /** The audit wrapper of `audit` (DOC-35 §3.2). */
  audited: Audited
  /** `ResidencyApi.findUnitsByCodes` (DOC-21 §2.1, DR-265). */
  units: UnitDirectory
  /**
   * The import file (DOC-21 §2.1) and, for the receipt PDF handler, the rendered PDFs, their removal and the logo
   * (DOC-34 §8.2, §8.4; DR-295).
   */
  files: Pick<FilesApi, 'read' | 'attach' | 'remove' | 'storeGenerated' | 'findByOwnerRef'> & {
    /** The signed GET of E-177's ready ZIP (DOC-37 §8, DR-123); a unit test may leave it out. */
    signedUrl?: FilesApi['signedUrl']
  }
  /** The building's zone for `buildingToday` (DOC-21 §2.1, DR-09). */
  calendar: BuildingCalendar
  /** The company block and the building name a receipt freezes (DOC-22 §7). */
  receiptBuildings: ReceiptBuildingSource
  /** The payer of an online payment (DOC-23 §2.2). */
  payers: PayerDirectory
  /** `OUTBOX_MAX_PAYLOAD_BYTES` (DOC-41). */
  outboxMaxPayloadBytes: number
  /**
   * The buildings `invariant_check` covers: real ones only, from `BuildingApi.listBuildings` (DOC-22 §12, DR-244). Optional here so
   * a test builds the module without the job; `install.ts` requires both of the host, so the app cannot forget them.
   */
  ledgerCheckBuildings?: LedgerCheckBuildings
  /** `JOB_INVARIANT_CHECK_GRACE_MINUTES` (DOC-41 §11). */
  invariantCheckGraceMinutes?: number
  /** DOC-40: `import_validate_duration_seconds`, `import_commits_total` (DOC-21 §7). */
  metrics?: MetricsPort
  /** The PDF renderer of DOC-34 §2 (P2-13): built by the container over the render host pool, or a test's fake. */
  pdfRenderer?: PdfRenderer
  /**
   * The render host pool of DOC-34 §4 (DR-291) the module builds when no `pdfRenderer` is injected: the process role and
   * the `PDF_*` values of DOC-41 §12, §14. The container passes it; a test injects its own `pdfRenderer` instead.
   */
  pdf?: {
    role: 'api' | 'worker'
    concurrency: number
    maxDocuments?: number
    maxRssMb?: number
  }
  /** The building's fee-notice language at a receipt's first render (DOC-34 §7.3, DOC-36 §5.2). */
  noticeLanguage?: NoticeLanguageSource
  /** The building block and the owner names a fee notice prints (DOC-34 §6.1, §8.1; DR-292); a test injects its own. */
  noticeContext?: NoticeContextSource
  /**
   * The guards of the routes (DOC-12 §5.3): the token, the role and the membership. Optional here so a test builds the module
   * and calls its use cases without mounting the routes (as `residency`'s tests do); `install.ts` requires both of the host, so
   * the app cannot forget them.
   */
  guards?: Guards
  /** The `Idempotency-Key` wrapper of the `R` routes (DOC-50 §8); see `guards`. */
  idempotent?: Idempotent
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
  /** The worker handler and the on-demand route E-84/E-106 render one receipt's PDF (DOC-34 §8.2, P2-13). */
  renderReceiptPdf: RenderReceiptPdf
  /** The staff route E-176 and the bulk job E-99 render one fee notice (DOC-34 §6.3, §8.1; P2-13). */
  renderFeeNoticePdf: RenderFeeNoticePdf
  /** The bulk request E-99 over a batch's open and paid charges (DOC-34 §9.1, DR-293; P2-13). */
  requestFeeNoticeZip: RequestFeeNoticeZip
}

export interface FinanceQueries {
  feeBatches: FeeBatchQueries
  feeImports: FeeImportQueries
  debts: DebtQueries
  moneyLog: MoneyLogQueries
  /** The resident reads of E-80…E-83 (DOC-22 §8.4, DR-40; P2-15). */
  residentFees: ResidentFeeQueries
  /** The latest bulk job of a batch (E-177, DOC-34 §9.1; P2-13) and one charge's notice (E-176). */
  feeNotice: FeeNoticeQueries
  /** The receipt PDF downloads E-84 and E-106 (DOC-34 §8.2; P2-15). */
  receiptPdf: ReceiptPdfQueries
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
  /** `HostPdfRenderer` over the render host pool (DOC-34 §4, DR-291); the container wires it when the routes land (8b). */
  readonly pdfRenderer?: PdfRenderer
  /** The routes of `finance` (DOC-51 §2.2, P2-15), mounted by `apps/api` with one static `.use()`. */
  readonly routes: ReturnType<typeof financeRoutes>
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
  const receiptPdf = new DrizzleReceiptPdfRepository(database)
  const logo = new FilesLogoSource(deps.files, logger)
  const inbox = new DrizzleInboxGuard(database, financeInbox)
  // DOC-34 §4, §13 (DR-291): a test injects a fake; otherwise the module owns the render host pool and closes it in `close`.
  const hostRenderer = deps.pdfRenderer
    ? null
    : new HostPdfRenderer({
        role: deps.pdf?.role ?? 'worker',
        size: deps.pdf?.concurrency ?? 1,
        maxDocuments: deps.pdf?.maxDocuments,
        maxRssMb: deps.pdf?.maxRssMb,
        metrics,
        logger,
      })
  const pdfRenderer: PdfRenderer = deps.pdfRenderer ?? (hostRenderer as HostPdfRenderer)
  const ownedRenderer = hostRenderer
  // DOC-34 §7.3: the language of a receipt's first render; its default matches DOC-36 §5.2's `feeNoticeLanguage`.
  const noticeLanguage: NoticeLanguageSource = deps.noticeLanguage ?? {
    language: async () => 'vi',
  }
  // DOC-34 §6.1, §8.1: the building block and the owner names a fee notice prints; a test injects its own (DR-292).
  const noticeContext: NoticeContextSource = deps.noticeContext ?? {
    building: async () => ({
      name: { vi: '' },
      company: { name: { vi: '' }, address: null },
      address: '',
      hotline: null,
      email: null,
      workingHours: null,
      logoFile: null,
      gatewayActive: false,
    }),
    ownerNames: async (_buildingId, unitIds) =>
      new Map(unitIds.map((unitId) => [unitId, null] as const)),
  }
  // DOC-34 §8.1 (DR-293): the fee-notice cache shared by E-176 and the bulk job E-99 (§9.2 phase 1).
  const feeNoticeCache = new FeeNoticeCache(deps.files, logo, pdfRenderer, metrics)
  const renderFeeNoticePdf = new RenderFeeNoticePdf(
    charges,
    feeNoticeCache,
    noticeContext,
    deps.calendar,
    clock,
    logger,
  )
  // DOC-34 §9.1, §9.2 (DR-293, DR-294): the bulk job E-99's persistence, its work loop (P2-13) and the E-177 read.
  const feeNoticeJobs = new DrizzleFeeNoticeJobRepository(database)
  const runFeeNoticeJob = new RunFeeNoticeJob(
    charges,
    feeNoticeJobs,
    feeNoticeCache,
    deps.files,
    noticeContext,
    deps.calendar,
    clock,
    logger,
    deps.pdf?.concurrency ?? 1,
  )
  const requestFeeNoticeZip = new RequestFeeNoticeZip(batches, feeNoticeJobs, noticeLanguage, ids)
  const feeNoticeQueries = new FeeNoticeQueries(
    feeNoticeJobs,
    batches,
    {
      signedUrl: deps.files.signedUrl ?? (async () => null),
      findByOwnerRef: deps.files.findByOwnerRef,
    },
    clock,
    renderFeeNoticePdf,
    noticeLanguage,
  )
  const renderReceiptPdf = new RenderReceiptPdf(
    database,
    receiptPdf,
    deps.files,
    logo,
    pdfRenderer,
    noticeLanguage,
    logger,
    metrics,
  )
  const handlers: IntegrationEventHandler[] = [new RenderReceiptPdfHandler(renderReceiptPdf, inbox)]
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
  const useCases: FinanceUseCases = {
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
    renderReceiptPdf,
    renderFeeNoticePdf,
    requestFeeNoticeZip,
  }
  const queries: FinanceQueries = {
    feeBatches: new FeeBatchQueries(batches, noticeContext),
    feeImports: feeImportQueries,
    debts: new DebtQueries(debts, deps.calendar, clock),
    moneyLog: new MoneyLogQueries(moneyLog),
    residentFees: new ResidentFeeQueries(
      new DrizzleResidentFeeReader(database),
      deps.calendar,
      clock,
    ),
    feeNotice: feeNoticeQueries,
    receiptPdf: new ReceiptPdfQueries(receiptPdf, deps.files, renderReceiptPdf),
  }
  // `install.ts` requires the guards and the key wrapper of the host; a test that builds the module to call its use cases leaves
  // them out and gets no routes, never unguarded ones (see `guards`).
  const { guards, idempotent } = deps
  const routes = (
    guards && idempotent
      ? financeRoutes({
          ...useCases,
          moneyLog: queries.moneyLog,
          residentFees: queries.residentFees,
          feeBatches: queries.feeBatches,
          feeNotice: queries.feeNotice,
          receiptPdf: queries.receiptPdf,
          guards,
          idempotent,
        })
      : routePlugin()
  ) as ReturnType<typeof financeRoutes>
  return {
    name: 'finance',
    docs: [
      {
        name: 'finance',
        description:
          'Fee batches and charges, manual payments, voids, receipts, debts, the money log and the resident fee views (DOC-21, DOC-22).',
      },
    ],
    api: new FinanceApiImpl(new DrizzleIntentReader(database)),
    feeImports: new FeeImportApiImpl(validateFeeImport, commitFeeImport, feeImportQueries),
    useCases,
    queries,
    routes,
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
    pdfRenderer,
    // DOC-09 §6.1 (DOC-34 §8.2): the command `finance.render_receipt_pdf` renders one receipt's PDF (P2-13).
    handlers,
    outbox: { name: 'finance', table: financeOutbox, inboxTable: financeInbox },
    // DOC-38 §4.1: the nightly ledger check (P2-11); the gauge `ledger_invariant_violations` reads its `job_run` row.
    jobs: deps.ledgerCheckBuildings
      ? [
          invariantCheckJob(
            new DrizzleInvariantReader(database),
            deps.ledgerCheckBuildings,
            deps.invariantCheckGraceMinutes ?? 0,
          ),
          // DOC-34 §9.2 (DR-294): the bulk fee notices, every 5 s in `claim` mode.
          feeNoticeRunJob(runFeeNoticeJob, deps.ledgerCheckBuildings),
        ]
      : [],
    // DOC-34 §4.1 (DR-291): the module releases its own render host pool at shutdown; an injected fake is the caller's.
    close: ownedRenderer ? () => ownedRenderer.close() : undefined,
  }
}
