import type { BuildingScope } from '@rms/shared-types'

export type UnitHistoryKind =
  | 'owner_changed'
  | 'moved_in'
  | 'moved_out'
  | 'member_added'
  | 'member_removed'

export type HistoryActor = { kind: 'staff' | 'resident'; id: string } | { kind: 'system'; id: null }

export interface UnitHistoryEntry {
  id: string
  unitId: string
  kind: UnitHistoryKind
  actor: HistoryActor
  details: Record<string, unknown>
}

/** The append-only history of a unit (DOC-16 §5.4). */
export interface UnitHistoryRepository {
  add(scope: BuildingScope, entry: UnitHistoryEntry, at: Date): Promise<void>
}
