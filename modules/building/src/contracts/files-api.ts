import type { BuildingScope, StaffRole } from '@rms/shared-types'
import type {
  FileAccountKind,
  FileModule,
  FileStatus,
  GeneratedPurpose,
  Purpose,
  UploadPurpose,
} from './purposes'

/** Who is acting; built from `StaffContext`, `UnitContext` or the system (DOC-37 §3). */
export interface FileActor {
  accountKind: FileAccountKind
  accountId: string
  buildingId: string
  scope: BuildingScope
  /** Present for a staff account: several purposes are for some roles only (DOC-37 §4). */
  role?: StaffRole
}

export interface RegisterInput {
  module: FileModule
  purpose: UploadPurpose
  mime: string
  /** Bytes the client says it will send; the real size is read back at `verify`. */
  size: number
}

/** The presigned `PUT`: `headers` must be sent exactly (DOC-37 §6.1). */
export interface UploadTicket {
  fileId: string
  method: 'PUT'
  url: string
  headers: { 'Content-Type': string }
  expiresAt: string
  maxBytes: number
}

export interface FileDto {
  fileId: string
  purpose: Purpose
  mime: string
  size: number
  status: FileStatus
  createdAt: string
}

export interface StoreGeneratedInput {
  buildingId: string
  module: FileModule
  purpose: GeneratedPurpose
  /** The logical key of the cache (DR-86), e.g. `batch/<id>/unit/<unit>.pdf`. */
  ownerRef: string
  mime: string
  body: Uint8Array | ReadableStream<Uint8Array>
}

/** What the caller of `read` expects the file to be; anything else is `file_not_verified`. */
export interface FileExpectation {
  module: FileModule
  purpose: Purpose
  /** For a file already `attached`: the owner it must be attached to. A `verified` file has none and must be the caller's. */
  ownerRef?: string
}

export interface FilesApi {
  /** Checks the audience, the purpose, the mime, the size, the rate bucket and the quota; inserts a `pending` row; presigns the `PUT`. */
  register(actor: FileActor, input: RegisterInput): Promise<UploadTicket>
  /** Must be called OUTSIDE any transaction: it talks to the bucket (DOC-12 §8.2). */
  verify(actor: FileActor, fileId: string): Promise<FileDto>
  /** Requires the caller's open transaction: one conditional `UPDATE`; zero rows is `file_not_verified` (DOC-37 §6.4). */
  attach(actor: FileActor, fileId: string, ownerRef: string): Promise<void>
  /** Requires the caller's open transaction: the file and its thumbnail become `deleted` and a delete command per object is written. */
  remove(actor: FileActor, fileId: string): Promise<void>
  /**
   * The bytes of a file of the caller's building: a `verified` one registered by the caller, or an `attached` one whose owner is
   * `expect.ownerRef` (the import reads its upload twice, at the preview and at the commit; DOC-18 §1.6). Unknown, another
   * building's or another account's file is 404; any other state, purpose or module is 422 `file_not_verified`. Talks to the
   * bucket, so it is called outside a transaction (DOC-12 §8.2).
   */
  read(actor: FileActor, fileId: string, expect: FileExpectation): Promise<Uint8Array>
  usage(buildingId: string): Promise<{ usedBytes: number; quotaBytes: number; ratio: number }>
  /** Presigns a `GET` locally; `null` for an unknown or `deleted` file. The module authorises first (DOC-37 §8). */
  signedUrl(
    fileId: string,
    opts?: { variant?: 'original' | 'thumb'; downloadName?: string },
  ): Promise<string | null>
  /** The worker stores a PDF, a ZIP or an export; it bypasses the quota (DR-123). */
  storeGenerated(input: StoreGeneratedInput): Promise<FileDto>
}
