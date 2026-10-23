import type { BuildingScope } from '@rms/shared-types'
import type { Occupancy } from '../contracts'
import type { UnitRecord } from './unit'
import type { UnitHistoryKind } from './unit-history-repository'

export interface UnitListFilter {
  occupancy?: Occupancy
  floor?: number
  bedrooms?: number
}

/** Keyset position in code order (DOC-27 §4.2): `A-100` sorts before `A-20`, as `unit_code_key` orders. */
export interface UnitCursor {
  code: string
  id: string
}

/** A unit with its active owner's row and the number of its non-removed memberships, owner included (DR-212). */
export interface UnitRow {
  unit: UnitRecord
  ownerMembershipId: string | null
  ownerAccountId: string | null
  memberCount: number
}

export interface UnitSummary {
  total: number
  occupied: number
  rented: number
  vacant: number
}

export interface HistoryRow {
  id: string
  kind: UnitHistoryKind
  actorKind: 'staff' | 'resident' | 'system'
  actorId: string | null
  details: Record<string, unknown>
  at: Date
}

export interface HistoryCursor {
  at: Date
  id: string
}

/** The reads behind the unit routes and `lookup`. Every query carries the building (DOC-12 §7); no state change. */
export interface UnitReader {
  /** One more than `limit` is read by the caller to know whether a next page exists. */
  list(
    scope: BuildingScope,
    filter: UnitListFilter,
    after: UnitCursor | undefined,
    limit: number,
  ): Promise<UnitRow[]>
  /** The code-prefix search of DOC-27 §11.1: the exact match first, then code order; the caller bounds `limit` at 20. */
  searchByCode(scope: BuildingScope, q: string, limit: number): Promise<UnitRow[]>
  /** One `GROUP BY occupancy` over the building, whatever the filters (DR-212). */
  summary(scope: BuildingScope): Promise<UnitSummary>
  /** Newest first, keyset on `(at, id)` through `unit_history_unit_idx`. */
  history(
    scope: BuildingScope,
    unitId: string,
    after: HistoryCursor | undefined,
    limit: number,
  ): Promise<HistoryRow[]>
}
