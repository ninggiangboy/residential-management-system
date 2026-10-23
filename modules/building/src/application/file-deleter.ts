import { decide } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { BuildingScope } from '@rms/shared-types'
import type { FileObject } from '../domain/file-object'
import type { FileRepository } from '../domain/file-repository'
import { deleteCommand } from './file-commands'

/**
 * Moves a file to `deleted` and writes its delete command, in the caller's transaction (DOC-37 §6.3, §14; DR-122). The file
 * decides (`FileObject.delete`) and one guarded statement applies it; when the file moved on since it was loaded (a pending
 * upload that was verified a moment ago) it is read again and decided again, so a delete is never lost to a verify (DR-255).
 */
export class FileDeleter {
  constructor(
    private readonly files: FileRepository,
    private readonly outbox: OutboxWriter,
  ) {}

  /** The file as it was deleted, or `null` when it was gone already. */
  delete(scope: BuildingScope, loaded: FileObject, now: Date): Promise<FileObject | null> {
    let current: FileObject | null = loaded
    return decide<FileObject | null>(async () => {
      const file = current ?? (await this.files.find(scope, loaded.id))
      current = null
      const change = file?.delete(now)
      if (!file || !change) return { done: true, value: null }
      const deleted = await this.files.apply(scope, change, now)
      if (!deleted) return { done: false }
      await this.outbox.add([deleteCommand(deleted, now)])
      return { done: true, value: deleted }
    })
  }
}
