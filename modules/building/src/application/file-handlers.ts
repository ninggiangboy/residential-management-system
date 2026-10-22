import type { Clock, IdGenerator, Log, UnitOfWork } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import type { BuildingId, BuildingScope } from '@rms/shared-types'
import { BUILDING_EVENTS, type FileCommandPayload, SYSTEM_ACCOUNT_ID } from '../contracts'
import { objectKeyOf } from '../domain/object-key'
import { PURPOSE_RULES } from '../domain/purposes'
import type { FilesConfig } from './files-service'
import type { FileRepository, ObjectStore, Thumbnailer } from './ports'

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })

/**
 * `building.delete_file_object` (DOC-09 §6.9, DOC-37 §14): removes the object of a file that is `deleted`. It never deletes
 * the object of a live file, so a stray or replayed command is harmless; `DeleteObject` of a missing key is success, so a
 * second run changes nothing (FS-14). The inbox is `afterSideEffect`: the bucket cannot be rolled back.
 */
export class DeleteFileObjectHandler implements IntegrationEventHandler {
  readonly name = 'building.delete_file_object'
  readonly eventType = BUILDING_EVENTS.fileDeleteRequested

  constructor(
    private readonly files: FileRepository,
    private readonly store: ObjectStore,
    private readonly inbox: InboxGuard,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { buildingId, fileId } = message.payload as unknown as FileCommandPayload
    await this.inbox.afterSideEffect(message.id, this.name, async () => {
      const file = await this.files.find(scopeOf(buildingId), fileId)
      if (file?.status !== 'deleted') return
      await this.store.delete(file.objectKey)
    })
  }
}

/**
 * `building.make_thumbnail` (DOC-37 §10, DR-122): a 480 px WebP (512 px for the logo) of a verified or attached image, as a
 * `thumbnail` row with `owner_ref = 'thumb:<id>'`. It skips an original that is gone, one that already has a thumbnail, and an
 * image that cannot be decoded (a truncated JPEG that passed the magic check): the row then falls back to the original.
 */
export class MakeThumbnailHandler implements IntegrationEventHandler {
  readonly name = 'building.make_thumbnail'
  readonly eventType = BUILDING_EVENTS.thumbnailRequested

  constructor(
    private readonly files: FileRepository,
    private readonly store: ObjectStore,
    private readonly thumbnailer: Thumbnailer,
    private readonly inbox: InboxGuard,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly config: Pick<FilesConfig, 'env' | 'thumbnailWidth' | 'logoWidth'>,
    private readonly logger: Log,
  ) {}

  async handle(message: Envelope): Promise<void> {
    const { buildingId, fileId } = message.payload as unknown as FileCommandPayload
    await this.inbox.afterSideEffect(message.id, this.name, () => this.make(buildingId, fileId))
  }

  private async make(buildingId: string, fileId: string): Promise<void> {
    const scope = scopeOf(buildingId)
    const original = await this.files.find(scope, fileId)
    if (!original || (original.status !== 'verified' && original.status !== 'attached')) return
    const kind = PURPOSE_RULES[original.purpose].thumbnail
    if (!kind) return
    if (await this.files.findThumbnail(scope, original.id)) return

    const bytes = await this.store.read(original.objectKey)
    if (!bytes) return
    const width = kind === 'logo' ? this.config.logoWidth : this.config.thumbnailWidth
    const resized = await this.thumbnailer.resize(bytes, width)
    if (!resized) {
      this.logger.warn({ buildingId, fileId }, 'thumbnail_undecodable')
      return
    }

    const id = this.ids.next()
    const now = this.clock.now()
    const objectKey = objectKeyOf({
      env: this.config.env,
      buildingId,
      module: original.module,
      now,
      fileId: id,
      extension: 'webp',
    })
    await this.uow.run(() =>
      this.files.insert(
        scope,
        {
          id,
          module: original.module,
          purpose: 'thumbnail',
          objectKey,
          mime: 'image/webp',
          size: 0,
          status: 'pending',
          ownerRef: `thumb:${original.id}`,
          accountKind: 'system',
          accountId: SYSTEM_ACCOUNT_ID,
        },
        now,
      ),
    )
    const written = await this.store.put(objectKey, resized, 'image/webp')
    await this.uow.run(() =>
      this.files.completeGenerated(
        scope,
        id,
        { size: written.size, checksum: written.sha256 },
        this.clock.now(),
      ),
    )
  }
}
