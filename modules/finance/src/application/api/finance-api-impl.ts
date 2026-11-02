import type { FinanceApi } from '../../contracts'
import type { IntentReader } from '../../domain/intent-reader'

/** The contract of DOC-09 §7.2, served from the module's readers (DOC-12 §4.5). */
export class FinanceApiImpl implements FinanceApi {
  constructor(private readonly intents: IntentReader) {}

  hasActiveIntent(buildingId: string, provider: string): Promise<boolean> {
    return this.intents.hasActive(buildingId, provider)
  }
}
