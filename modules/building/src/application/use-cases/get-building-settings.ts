import type { StaffContext } from '@rms/shared-types'
import { assertAdmin } from '../assert-admin'
import type { BuildingDocument, BuildingDocumentLoader } from '../building-document'

/** `GET /staff/settings` (DOC-36 §4): the building row and the settings in one document, with its `ETag`. */
export class GetBuildingSettings {
  constructor(private readonly documents: BuildingDocumentLoader) {}

  async execute(staff: StaffContext): Promise<BuildingDocument> {
    assertAdmin(staff)
    return this.documents.load(staff.buildingId)
  }
}
