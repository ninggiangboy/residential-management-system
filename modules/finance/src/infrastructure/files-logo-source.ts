import type { Log } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import type { LogoSource } from '../application/logo-source'
import { systemFileActor } from '../application/system-file-actor'

/**
 * `LogoSource` over `FilesApi` (DOC-34 §8.4, DR-296): it reads the 512 px thumbnail of the logo named by the snapshot
 * (`owner_ref = 'thumb:<logoFileId>'`, purpose `thumbnail`) with the system actor. A missing or unreadable file logs
 * `pdf.logo_missing` and answers `null`, so a receipt still renders; it never throws. A replaced logo is not removed
 * (DR-296), so an old snapshot's key stays readable — there is nothing to do for that here.
 */
export class FilesLogoSource implements LogoSource {
  constructor(
    private readonly files: Pick<FilesApi, 'read'>,
    private readonly logger: Log,
  ) {}

  async load(buildingId: string, logoKey: string | null): Promise<Uint8Array | null> {
    if (!logoKey) return null
    try {
      return await this.files.read(systemFileActor(buildingId), logoKey, {
        module: 'building',
        purpose: 'thumbnail',
        ownerRef: `thumb:${logoKey}`,
      })
    } catch {
      this.logger.warn({ buildingId, logoKey }, 'pdf.logo_missing')
      return null
    }
  }
}
