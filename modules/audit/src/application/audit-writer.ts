import type { IdGenerator, Log } from '@core/kernel'
import type { AuditApi, AuditEntry } from '../contracts'
import { assertActionShape, checkedReason, preparePayload } from '../domain/entry'
import { NoTransactionError, UndeclaredAuditActionError } from '../domain/errors'
import { assertMasked } from '../domain/masking'
import type {
  AuditActionCatalog,
  AuditLogRepository,
  AuditMetrics,
  RequestInfoProvider,
  TransactionProbe,
} from './ports'

export interface AuditWriterDeps {
  repository: AuditLogRepository
  transaction: TransactionProbe
  ids: IdGenerator
  actions: AuditActionCatalog
  requestInfo: RequestInfoProvider
  logger: Log
  metrics?: AuditMetrics
}

/**
 * `AuditApi.record` (DOC-35 §3.1, ADR-0018): joins the caller's transaction, never opens one, and throws when none is open.
 * A failed insert propagates, so the mutation rolls back with it (FR-37.1); a rolled-back mutation takes the row with it.
 */
export class AuditWriter implements AuditApi {
  constructor(private readonly deps: AuditWriterDeps) {}

  async record(entry: AuditEntry): Promise<void> {
    const { transaction, actions, ids, repository, requestInfo, logger, metrics } = this.deps
    if (!transaction.inTransaction) throw new NoTransactionError()
    assertActionShape(entry.action)
    if (!actions.isDeclared(entry.action)) throw new UndeclaredAuditActionError(entry.action)
    const reason = checkedReason(entry.action, entry.reason)
    assertMasked(entry.changes)
    const payload = preparePayload(entry.changes, entry.details)

    const info = requestInfo()
    const { actor } = entry
    const system = 'kind' in actor
    try {
      await repository.insert(
        { buildingId: actor.buildingId },
        {
          id: ids.next(),
          actorKind: system ? 'system' : 'staff',
          actorId: system ? null : actor.staffId,
          actorRole: system ? null : actor.role,
          ip: info.ip,
          userAgent: info.userAgent,
          requestId: info.requestId,
          action: entry.action,
          objectType: entry.object.type,
          objectId: entry.object.id,
          changes: payload.changes,
          details: payload.details,
          reason: reason ?? null,
        },
      )
    } catch (err) {
      metrics?.writeFailed()
      logger.error({ action: entry.action, requestId: info.requestId, err }, 'audit.record_failed')
      throw err
    }
    // No `changes` in the line: the log never repeats what the row masks (DOC-35 §11).
    logger.info(
      { action: entry.action, objectType: entry.object.type, requestId: info.requestId },
      'audit.record',
    )
  }
}
