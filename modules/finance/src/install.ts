import type { ModuleHost } from '@core/runtime'
import { createFinanceModule, type FinanceModuleDeps } from './finance.module'

/** The host narrowed to what `finance` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type FinanceHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'> &
  Pick<
    FinanceModuleDeps,
    | 'audited'
    | 'units'
    | 'files'
    | 'metrics'
    | 'calendar'
    | 'receiptBuildings'
    | 'payers'
    | 'outboxMaxPayloadBytes'
    | 'ledgerCheckBuildings'
    | 'invariantCheckGraceMinutes'
    | 'pdfRenderer'
    | 'pdf'
    | 'noticeLanguage'
    | 'noticeContext'
    | 'debtUnits'
  > & {
    // The routes need both (DOC-12 §5.3, DOC-50 §8): required here, optional only for a test of the use cases.
    guards: NonNullable<FinanceModuleDeps['guards']>
    idempotent: NonNullable<FinanceModuleDeps['idempotent']>
    reminderRatePerHour: number
  }

export function installFinance(host: FinanceHost) {
  return createFinanceModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
    audited: host.audited,
    units: host.units,
    files: host.files,
    metrics: host.metrics,
    calendar: host.calendar,
    receiptBuildings: host.receiptBuildings,
    payers: host.payers,
    outboxMaxPayloadBytes: host.outboxMaxPayloadBytes,
    ledgerCheckBuildings: host.ledgerCheckBuildings,
    invariantCheckGraceMinutes: host.invariantCheckGraceMinutes,
    pdfRenderer: host.pdfRenderer,
    pdf: host.pdf,
    noticeLanguage: host.noticeLanguage,
    noticeContext: host.noticeContext,
    debtUnits: host.debtUnits,
    guards: host.guards,
    idempotent: host.idempotent,
    reminderRatePerHour: host.reminderRatePerHour,
  })
}
