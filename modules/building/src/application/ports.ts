import type { BuildingScope } from '@rms/shared-types'
import type {
  Bilingual,
  FileAccountKind,
  FileModule,
  FileStatus,
  GatewayDriver,
  GatewayProvider,
  Purpose,
  ReceivingAccount,
  TermsKind,
} from '../contracts'
import type { CompanyBlock } from '../domain/building-fields'

/** A building as the repository returns it (a row mapped to plain values). */
export interface BuildingRecord {
  id: string
  code: string
  name: Bilingual
  company: CompanyBlock
  address: string
  hotline: string | null
  workingHours: Bilingual | null
  email: string | null
  logoFile: string | null
  timeZone: string
  isDemo: boolean
  version: number
}

export interface BuildingFieldsUpdate {
  name?: Bilingual
  company?: CompanyBlock
  address?: string
  hotline?: string | null
  workingHours?: Bilingual | null
  email?: string | null
  logoFile?: string | null
}

/** `building.building` is the scope root, so it is on the allow-list and its methods take the id (DOC-14 §5.3). */
export interface BuildingRepository {
  find(id: string): Promise<BuildingRecord | null>
  list(): Promise<BuildingRecord[]>
  /** The conditional update of DOC-36 §4.3: `null` when the version moved on. */
  updateGuarded(
    id: string,
    expectedVersion: number,
    fields: BuildingFieldsUpdate,
  ): Promise<number | null>
}

export interface SettingsRecord {
  data: Record<string, unknown>
  version: number
}

export interface SettingsRepository {
  find(scope: BuildingScope): Promise<SettingsRecord | null>
  /** `data = (data || :set) - :remove`, guarded by the version the client read; `null` when it moved on. */
  mergeGuarded(
    scope: BuildingScope,
    expectedVersion: number,
    set: Record<string, unknown>,
    remove: string[],
  ): Promise<SettingsRecord | null>
}

export interface GatewayConfigRecord {
  id: string
  buildingId: string
  provider: GatewayProvider
  driver: GatewayDriver
  secretsEnc: string
  receivingAccount: ReceivingAccount
  status: 'active' | 'disabled'
  lastCheckAt: Date | null
  lastCheckOk: boolean | null
  version: number
}

export interface GatewayConfigRepository {
  findActive(
    scope: BuildingScope,
    provider: GatewayProvider,
    lock?: 'share' | 'update',
  ): Promise<GatewayConfigRecord | null>
  /** `SELECT … FOR UPDATE` of the row at the version the client read (DOC-36 §7.3 step 3). */
  lockForUpdate(
    scope: BuildingScope,
    id: string,
    expectedVersion: number,
  ): Promise<GatewayConfigRecord | null>
  insert(
    scope: BuildingScope,
    record: Omit<GatewayConfigRecord, 'version' | 'lastCheckAt' | 'lastCheckOk'>,
  ): Promise<void>
  updateGuarded(
    scope: BuildingScope,
    id: string,
    expectedVersion: number,
    fields: Pick<GatewayConfigRecord, 'secretsEnc' | 'receivingAccount' | 'driver' | 'status'>,
  ): Promise<number | null>
  /** The compare-and-set of the key rotation (RB-12): zero rows when someone else wrote first. */
  replaceBlob(scope: BuildingScope, id: string, oldBlob: string, newBlob: string): Promise<boolean>
}

export interface TermsVersionRecord {
  id: string
  kind: TermsKind
  version: number
  text: Bilingual
}

export interface TermsRepository {
  /** The rows of the gate of DOC-35 §9.2: the latest version of each kind that the account has not accepted. */
  missing(
    scope: BuildingScope,
    accountId: string,
  ): Promise<Array<Pick<TermsVersionRecord, 'id' | 'kind' | 'version'>>>
  latest(scope: BuildingScope): Promise<Array<Pick<TermsVersionRecord, 'id' | 'kind' | 'version'>>>
  /** The next number of the kind; a lost race is the unique index, which the caller turns into 409. */
  insertNext(
    scope: BuildingScope,
    row: { id: string; kind: TermsKind; text: Bilingual; publishedBy: string },
  ): Promise<number>
  /** The statement of DOC-35 §9.3: `true` when this call inserted the acceptance. */
  accept(
    scope: BuildingScope,
    row: { accountId: string; versionId: string; ip: string | null; appVersion: string | null },
  ): Promise<boolean>
  /** Whether an acceptance of that version already exists (UC-27 E3). */
  isAccepted(scope: BuildingScope, accountId: string, versionId: string): Promise<boolean>
  exists(scope: BuildingScope, versionId: string): Promise<boolean>
}

export interface FileRecord {
  id: string
  buildingId: string
  module: FileModule
  purpose: Purpose
  objectKey: string
  mime: string
  size: number
  checksum: string | null
  status: FileStatus
  ownerRef: string | null
  accountKind: FileAccountKind
  accountId: string
  createdAt: Date
}

export interface NewFile {
  id: string
  module: FileModule
  purpose: Purpose
  objectKey: string
  mime: string
  size: number
  status: 'pending' | 'attached'
  ownerRef: string | null
  accountKind: FileAccountKind
  accountId: string
}

export interface FileRepository {
  insert(scope: BuildingScope, file: NewFile, now: Date): Promise<FileRecord>
  find(scope: BuildingScope, id: string): Promise<FileRecord | null>
  /**
   * The row by its id alone: `FilesApi.signedUrl(fileId)` has no building argument, because the module that calls it has
   * authorised the file already (DOC-37 §8). The one query of the module that is not confined by a `BuildingScope`.
   */
  findAnyBuilding(id: string): Promise<FileRecord | null>
  /** The thumbnail row of an original (`owner_ref = 'thumb:<id>'`, live), through `ix_file_object_building_owner`. */
  findThumbnail(scope: BuildingScope, originalId: string): Promise<FileRecord | null>
  /** `pending → verified` with the real size and the measured mime; `null` when the row is not `pending` any more. */
  markVerified(
    scope: BuildingScope,
    id: string,
    size: number,
    now: Date,
  ): Promise<FileRecord | null>
  /** Any live status → `deleted`; `null` when it was already deleted. */
  markDeleted(scope: BuildingScope, id: string, now: Date): Promise<FileRecord | null>
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
  ): Promise<FileRecord | null>
  /** Σ size of the rows that are not `deleted` (DOC-37 §11). */
  usedBytes(scope: BuildingScope): Promise<number>
  /** `pending` and `verified` rows created before `cutoff`, oldest first, one batch. */
  unattachedBefore(scope: BuildingScope, cutoff: Date, limit: number): Promise<FileRecord[]>
  /** `deleted` rows older than the cutoff are removed for good (DOC-20 §3). */
  purgeDeleted(scope: BuildingScope, cutoff: Date, limit: number): Promise<number>
}

/** The bucket, as the files service needs it. The adapter wraps `@core/storage` (DOC-37 §5). */
export interface ObjectStore {
  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): string
  presignGet(key: string, opts: { expiresInSeconds: number; downloadName?: string }): string
  head(key: string): Promise<{ size: number; contentType: string } | null>
  /** The first `length` bytes (a ranged `GET`), or `null` when the object is missing. */
  readHead(key: string, length: number): Promise<Uint8Array | null>
  read(key: string): Promise<Uint8Array | null>
  /** Creates or overwrites; returns the SHA-256 of what was written. */
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
  ): Promise<{ size: number; sha256: string }>
  /** Idempotent: a missing key is success (U7). */
  delete(key: string): Promise<void>
}

/** `upload:account:<id>`, 60 per hour (DR-64); throws `RateLimitedError` with `Retry-After` when the bucket is empty. */
export interface UploadRateLimiter {
  take(accountId: string): Promise<void>
}

/** Resizes an image to a WebP of the given width, never enlarging; `null` for bytes that cannot be decoded (FS-22). */
export interface Thumbnailer {
  resize(image: Uint8Array, width: number): Promise<Uint8Array | null>
}

export interface TransactionProbe {
  readonly inTransaction: boolean
}
