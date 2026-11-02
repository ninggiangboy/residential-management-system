import type { ModuleHost } from '@core/runtime'
import { createFinanceModule } from './finance.module'

/** The host narrowed to what `finance` needs: it states its dependencies in its signature (DOC-12 §4.2). */
export type FinanceHost = Pick<ModuleHost, 'logger' | 'clock' | 'ids' | 'database'>

export function installFinance(host: FinanceHost) {
  return createFinanceModule({
    database: host.database,
    clock: host.clock,
    ids: host.ids,
    logger: host.logger,
  })
}
