import type { BuildingScope } from '@rms/shared-types'
import type { FileObject, FileTransition, NewFile } from './file-object'

export interface FileRepository {
  insert(scope: BuildingScope, file: NewFile, now: Date): Promise<FileObject>
  find(scope: BuildingScope, id: string): Promise<FileObject | null>
  /**
   * The row by its id alone: `FilesApi.signedUrl(fileId)` has no building argument, because the module that calls it has
   * authorised the file already (DOC-37 §8). The one query of the module that is not confined by a `BuildingScope`.
   */
  findAnyBuilding(id: string): Promise<FileObject | null>
  /** The thumbnail row of an original (`owner_ref = 'thumb:<id>'`, live), through `ix_file_object_building_owner`. */
  findThumbnail(scope: BuildingScope, originalId: string): Promise<FileObject | null>
  /**
   * Applies the change the aggregate decided (DR-255): one conditional `UPDATE` inside the building, the row after it, or `null`
   * when the state moved since the file was loaded (DOC-37 §6).
   */
  apply(scope: BuildingScope, transition: FileTransition, now: Date): Promise<FileObject | null>
  /** Σ size of the rows that are not `deleted` (DOC-37 §11). */
  usedBytes(scope: BuildingScope): Promise<number>
  /** `pending` and `verified` rows created before `cutoff`, oldest first, one batch. */
  unattachedBefore(scope: BuildingScope, cutoff: Date, limit: number): Promise<FileObject[]>
  /** The rows that are not `deleted`, oldest first, one batch: what the demo reset removes (DOC-36 §10.2). */
  listLive(scope: BuildingScope, limit: number): Promise<FileObject[]>
  /** `deleted` rows older than the cutoff are removed for good (DOC-20 §3). */
  purgeDeleted(scope: BuildingScope, cutoff: Date, limit: number): Promise<number>
}
