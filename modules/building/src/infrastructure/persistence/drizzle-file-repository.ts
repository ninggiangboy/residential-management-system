import { applyTransition, type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, asc, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm'
import type { FindByOwnerRefInput } from '../../contracts'
import {
  FileObject,
  type FileRecord,
  type FileTransition,
  type NewFile,
} from '../../domain/file-object'
import type { FileRepository } from '../../domain/file-repository'
import { fileObject } from './schema'

type Row = typeof fileObject.$inferSelect

const toRecord = (row: Row): FileObject =>
  new FileObject({
    id: row.id,
    buildingId: row.buildingId,
    module: row.module as FileRecord['module'],
    purpose: row.purpose as FileRecord['purpose'],
    objectKey: row.objectKey,
    mime: row.mime,
    size: row.size,
    checksum: row.checksum,
    status: row.status as FileRecord['status'],
    ownerRef: row.ownerRef,
    accountKind: row.accountKind as FileRecord['accountKind'],
    accountId: row.accountId,
    createdAt: row.createdAt,
  })

/** Every timestamp comes from the `Clock` the use case was given, so a test with a fake clock moves them all (FS-10). */
export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly database: Database) {}

  async insert(scope: BuildingScope, file: NewFile, now: Date): Promise<FileObject> {
    const [row] = await this.database.executor
      .insert(fileObject)
      .values({
        id: file.id,
        buildingId: scope.buildingId,
        module: file.module,
        purpose: file.purpose,
        objectKey: file.objectKey,
        mime: file.mime,
        size: file.size,
        status: file.status,
        ownerRef: file.ownerRef,
        accountKind: file.accountKind,
        accountId: file.accountId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return toRecord(row as Row)
  }

  async find(scope: BuildingScope, id: string): Promise<FileObject | null> {
    const [row] = await this.database.executor
      .select()
      .from(fileObject)
      .where(and(inBuilding(fileObject, scope), eq(fileObject.id, id)))
    return row ? toRecord(row) : null
  }

  // scope-ok: FilesApi.signedUrl(fileId) has no building argument; the calling module authorised the file (DOC-37 §8)
  async findAnyBuilding(id: string): Promise<FileObject | null> {
    // scope-ok: the same lookup by primary key
    const [row] = await this.database.executor
      .select()
      .from(fileObject)
      .where(eq(fileObject.id, id))
    return row ? toRecord(row) : null
  }

  async findThumbnail(scope: BuildingScope, originalId: string): Promise<FileObject | null> {
    const [row] = await this.database.executor
      .select()
      .from(fileObject)
      .where(
        and(
          inBuilding(fileObject, scope),
          eq(fileObject.ownerRef, `thumb:${originalId}`),
          eq(fileObject.purpose, 'thumbnail'),
          ne(fileObject.status, 'deleted'),
        ),
      )
    return row ? toRecord(row) : null
  }

  /**
   * `ix_file_object_building_owner` of DOC-37 §3: the `attached` row of that module, purpose and owner, newest first (DR-293).
   */
  async findByOwnerRef(scope: BuildingScope, key: FindByOwnerRefInput): Promise<FileObject | null> {
    const [row] = await this.database.executor
      .select()
      .from(fileObject)
      .where(
        and(
          inBuilding(fileObject, scope),
          eq(fileObject.module, key.module),
          eq(fileObject.purpose, key.purpose),
          eq(fileObject.ownerRef, key.ownerRef),
          eq(fileObject.status, 'attached'),
        ),
      )
      .orderBy(desc(fileObject.createdAt), desc(fileObject.id))
      .limit(1)
    return row ? toRecord(row) : null
  }

  async apply(
    scope: BuildingScope,
    transition: FileTransition,
    now: Date,
  ): Promise<FileObject | null> {
    const row = await applyTransition(this.database, fileObject, transition, {
      stamp: { updatedAt: now },
      also: inBuilding(fileObject, scope),
    })
    return row ? toRecord(row) : null
  }

  /** `ix_file_object_building_live` makes this an index-only scan after a VACUUM (DOC-37 §11). */
  async usedBytes(scope: BuildingScope): Promise<number> {
    const [row] = await this.database.executor
      .select({ used: sql<string>`coalesce(sum(${fileObject.size}), 0)::text` })
      .from(fileObject)
      .where(and(inBuilding(fileObject, scope), ne(fileObject.status, 'deleted')))
    return Number(row?.used ?? 0)
  }

  async unattachedBefore(scope: BuildingScope, cutoff: Date, limit: number): Promise<FileObject[]> {
    const rows = await this.database.executor
      .select()
      .from(fileObject)
      .where(
        and(
          inBuilding(fileObject, scope),
          inArray(fileObject.status, ['pending', 'verified']),
          lt(fileObject.createdAt, cutoff),
        ),
      )
      .orderBy(asc(fileObject.createdAt))
      .limit(limit)
    return rows.map(toRecord)
  }

  async listLive(scope: BuildingScope, limit: number): Promise<FileObject[]> {
    const rows = await this.database.executor
      .select()
      .from(fileObject)
      .where(and(inBuilding(fileObject, scope), ne(fileObject.status, 'deleted')))
      .orderBy(asc(fileObject.createdAt))
      .limit(limit)
    return rows.map(toRecord)
  }

  async purgeDeleted(scope: BuildingScope, cutoff: Date, limit: number): Promise<number> {
    const doomed = this.database.executor
      .select({ id: fileObject.id })
      .from(fileObject)
      .where(
        and(
          inBuilding(fileObject, scope),
          eq(fileObject.status, 'deleted'),
          lt(fileObject.deletedAt, cutoff),
        ),
      )
      .limit(limit)
    const rows = await this.database.executor
      .delete(fileObject)
      .where(and(inBuilding(fileObject, scope), inArray(fileObject.id, doomed)))
      .returning({ id: fileObject.id })
    return rows.length
  }
}
