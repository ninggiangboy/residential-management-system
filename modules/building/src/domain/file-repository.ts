import type { BuildingScope } from '@rms/shared-types'
import type { FileAccountKind } from '../contracts'
import type { FileObject, NewFile } from './file-object'

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
  /** `pending → verified` with the real size and the measured mime; `null` when the row is not `pending` any more. */
  markVerified(
    scope: BuildingScope,
    id: string,
    size: number,
    now: Date,
  ): Promise<FileObject | null>
  /** Any live status → `deleted`; `null` when it was already deleted. */
  markDeleted(scope: BuildingScope, id: string, now: Date): Promise<FileObject | null>
  /** The conditional `UPDATE` of DOC-37 §6.4: one row or none. */
  attach(
    scope: BuildingScope,
    row: { id: string; ownerRef: string; accountKind: FileAccountKind; accountId: string },
    now: Date,
  ): Promise<boolean>
  /** A generated file is `attached` at once, with the real size and the SHA-256 (DOC-37 §9 step 3); `null` when the row is gone. */
  completeGenerated(
    scope: BuildingScope,
    id: string,
    result: { size: number; checksum: string },
    now: Date,
  ): Promise<FileObject | null>
  /** Σ size of the rows that are not `deleted` (DOC-37 §11). */
  usedBytes(scope: BuildingScope): Promise<number>
  /** `pending` and `verified` rows created before `cutoff`, oldest first, one batch. */
  unattachedBefore(scope: BuildingScope, cutoff: Date, limit: number): Promise<FileObject[]>
  /** `deleted` rows older than the cutoff are removed for good (DOC-20 §3). */
  purgeDeleted(scope: BuildingScope, cutoff: Date, limit: number): Promise<number>
}
