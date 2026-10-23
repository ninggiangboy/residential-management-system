import type { Clock, IdGenerator, Log, UnitOfWork } from '@core/kernel'
import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import { BUILDING_EVENTS, type FileCommandPayload } from '../../contracts'
import type { FileRepository } from '../../domain/file-repository'
import type { FilesConfig } from '../files-config'
import type { ObjectStore, Thumbnailer } from '../ports'
import { scopeOf } from '../scope-of'

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
    if (!original?.canHaveThumbnail()) return
    const kind = original.thumbnailKind()
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
    const thumbnail = original.thumbnail({ id, env: this.config.env, now })
    const inserted = await this.uow.run(() => this.files.insert(scope, thumbnail, now))
    const written = await this.store.put(thumbnail.objectKey, resized, 'image/webp')
    await this.uow.run(async () => {
      const done = this.clock.now()
      const change = inserted.completeGenerated(
        { size: written.size, checksum: written.sha256 },
        done,
      )
      if (change) await this.files.apply(scope, change, done)
    })
  }
}
