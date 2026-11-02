import type { Database } from '@core/db'
import type { Clock, IdGenerator, Log } from '@core/kernel'
import type { AppModule } from '@core/runtime'
import { FinanceApiImpl } from './application/api/finance-api-impl'
import type { FinanceApi } from './contracts'
import { DrizzleIntentReader } from './infrastructure/persistence/drizzle-intent-reader'

export interface FinanceModuleDeps {
  database: Database
  clock: Clock
  ids: IdGenerator
  logger: Log
}

export interface FinanceModule extends AppModule<'finance'> {
  /** `FinanceApi` (DOC-09 §7.2) for the other modules and `integrations/*`. */
  readonly api: FinanceApi
}

/**
 * Builds the module from what it needs; `install.ts` narrows the host to this (DOC-12 §4.2, §4.3). P2-01 installs the schema and
 * the contract; the use cases, routes and jobs join with P2-02…P2-15.
 */
export function createFinanceModule(deps: FinanceModuleDeps): FinanceModule {
  return {
    name: 'finance',
    api: new FinanceApiImpl(new DrizzleIntentReader(deps.database)),
  }
}
