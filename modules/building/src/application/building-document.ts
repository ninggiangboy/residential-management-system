import { NotFoundError } from '@core/kernel'
import type { BuildingId } from '@rms/shared-types'
import type { Bilingual, BuildingSettings, FilesApi } from '../contracts'
import type { BuildingRecord, BuildingRepository } from '../domain/building-repository'
import { resolveSettings } from '../domain/settings'
import type { SettingsRepository } from '../domain/settings-repository'

/** `GET /staff/settings`: the building row and the settings in one document (DOC-36 §4). */
export interface BuildingDocument {
  building: {
    id: string
    code: string
    name: Bilingual
    company: BuildingRecord['company']
    address: string
    hotline: string | null
    workingHours: Bilingual | null
    email: string | null
    logoFileId: string | null
    logoUrl: string | null
    timeZone: string
    isDemo: boolean
  }
  settings: BuildingSettings
  /** The keys an Admin saved; the others are defaults. */
  saved: string[]
  /** `"<building.version>.<building_setting.version>"`, the `ETag` of the document. */
  etag: string
}

const etagOf = (building: number, settings: number) => `${building}.${settings}`

/** `3.8` → `[3, 8]`; quotes are the route's, but are tolerated here. */
export function parseEtag(etag: string): { building: number; settings: number } | null {
  const match = /^"?(\d+)\.(\d+)"?$/.exec(etag.trim())
  return match ? { building: Number(match[1]), settings: Number(match[2]) } : null
}

/** Builds the document of DOC-36 §4 from the two rows and the signed URL of the logo; shared by the read and the update. */
export class BuildingDocumentLoader {
  constructor(
    private readonly buildings: BuildingRepository,
    private readonly settings: SettingsRepository,
    private readonly filesApi: FilesApi,
  ) {}

  async load(buildingId: string): Promise<BuildingDocument> {
    const { buildings, settings, filesApi } = this
    const record = await buildings.find(buildingId)
    if (!record) throw new NotFoundError()
    const saved = await settings.find({ buildingId: buildingId as BuildingId })
    const data = saved?.data ?? {}
    return {
      building: {
        id: record.id,
        code: record.code,
        name: record.name,
        company: record.company,
        address: record.address,
        hotline: record.hotline,
        workingHours: record.workingHours,
        email: record.email,
        logoFileId: record.logoFile,
        logoUrl: record.logoFile ? await filesApi.signedUrl(record.logoFile) : null,
        timeZone: record.timeZone,
        isDemo: record.isDemo,
      },
      settings: resolveSettings(data),
      saved: Object.keys(data),
      etag: etagOf(record.version, saved?.version ?? 0),
    }
  }
}
