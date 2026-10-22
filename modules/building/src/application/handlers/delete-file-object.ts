import type { Envelope, InboxGuard, IntegrationEventHandler } from '@core/messaging'
import { BUILDING_EVENTS, type FileCommandPayload } from '../../contracts'
import type { FileRepository } from '../../domain/file-repository'
import type { ObjectStore } from '../ports'
import { scopeOf } from '../scope-of'

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
      if (!file?.isDeleted) return
      await this.store.delete(file.objectKey)
    })
  }
}
