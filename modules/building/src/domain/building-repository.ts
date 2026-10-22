import type { Bilingual } from '../contracts'
import type { CompanyBlock } from './building-fields'

/** A building as the repository returns it (a row mapped to plain values). */
export interface BuildingRecord {
  id: string
  code: string
  name: Bilingual
  company: CompanyBlock
  address: string
  hotline: string | null
  workingHours: Bilingual | null
  email: string | null
  logoFile: string | null
  timeZone: string
  isDemo: boolean
  version: number
}

export interface BuildingFieldsUpdate {
  name?: Bilingual
  company?: CompanyBlock
  address?: string
  hotline?: string | null
  workingHours?: Bilingual | null
  email?: string | null
  logoFile?: string | null
}

/** `building.building` is the scope root, so it is on the allow-list and its methods take the id (DOC-14 §5.3). */
export interface BuildingRepository {
  find(id: string): Promise<BuildingRecord | null>
  list(): Promise<BuildingRecord[]>
  /** The conditional update of DOC-36 §4.3: `null` when the version moved on. */
  updateGuarded(
    id: string,
    expectedVersion: number,
    fields: BuildingFieldsUpdate,
  ): Promise<number | null>
}
