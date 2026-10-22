import type { AuditApi, AuditEntry } from '../../contracts'
import type { RecordAuditEntry } from '../use-cases/record-audit-entry'

/** `AuditApi` (DOC-35 §3.1): the one door for every module; the rules are in `RecordAuditEntry`. */
export class AuditApiImpl implements AuditApi {
  constructor(private readonly recordEntry: RecordAuditEntry) {}

  record(entry: AuditEntry): Promise<void> {
    return this.recordEntry.execute(entry)
  }
}
