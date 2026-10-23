import type { Transition } from '@core/kernel'
import type {
  FileAccountKind,
  FileActor,
  FileModule,
  FileStatus,
  GeneratedPurpose,
  Purpose,
  RegisterInput,
  StoreGeneratedInput,
} from '../contracts'
import { SYSTEM_ACCOUNT_ID } from '../contracts'
import { FilePurposeForbiddenError, FileRejectedError } from './errors'
import { checkContent } from './magic-bytes'
import { objectKeyOf } from './object-key'
import {
  extensionOf,
  type FileLimits,
  maxBytesFor,
  PURPOSE_RULES,
  type PurposeRule,
} from './purposes'

/** A row of `building.file_object` as the repository maps it. */
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

/** The columns a transition of a file may name: the record, and the instants of its moves. */
export type FileColumns = FileRecord & {
  verifiedAt: Date | null
  attachedAt: Date | null
  deletedAt: Date | null
}

export type FileTransition = Transition<FileColumns>

/** What a new row is born with; the repository adds the building and the time. */
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

/** Why the object in the bucket is not the file that was registered (DOC-37 §6.3 steps 3 and 4). */
export type ObjectFailure = 'empty' | 'too_large' | 'wrong_type' | 'bad_content'

const mediaType = (contentType: string) => contentType.split(';')[0]?.trim().toLowerCase() ?? ''

/** What a register produces: the row to insert and the size limit the client is held to. */
export interface Registration {
  file: NewFile
  /** The largest object the client may send for this purpose and type. */
  maxBytes: number
}

/**
 * A file of a building (DOC-37): what it may be, who may register it, whether the object in the bucket is the one that was
 * registered. The database still decides the races (a conditional `UPDATE` per transition, DOC-37 §6); this class holds the
 * rules that need no I/O, so a use case reads like the sequence of DOC-37 §6.
 */
export class FileObject implements FileRecord {
  readonly id: string
  readonly buildingId: string
  readonly module: FileModule
  readonly purpose: Purpose
  readonly objectKey: string
  readonly mime: string
  readonly size: number
  readonly checksum: string | null
  readonly status: FileStatus
  readonly ownerRef: string | null
  readonly accountKind: FileAccountKind
  readonly accountId: string
  readonly createdAt: Date

  constructor(record: FileRecord) {
    this.id = record.id
    this.buildingId = record.buildingId
    this.module = record.module
    this.purpose = record.purpose
    this.objectKey = record.objectKey
    this.mime = record.mime
    this.size = record.size
    this.checksum = record.checksum
    this.status = record.status
    this.ownerRef = record.ownerRef
    this.accountKind = record.accountKind
    this.accountId = record.accountId
    this.createdAt = record.createdAt
  }

  /** The checks of DOC-37 §6.1 steps 1 and 2: the audience, the module, the type and the size. Nothing is written yet. */
  static register(params: {
    id: string
    actor: FileActor
    input: RegisterInput
    env: string
    now: Date
    limits: FileLimits
  }): Registration {
    const { id, actor, input, env, now, limits } = params
    const rule = (PURPOSE_RULES as Record<string, PurposeRule | undefined>)[input.purpose]
    // A purpose that does not exist (a CCCD image, DOC-37 §2) is a bad request; one the system writes is forbidden.
    if (!rule)
      throw new FileRejectedError('purpose', 'unknown_purpose', 'There is no such kind of file')
    authorise(actor, rule)
    if (!rule.modules.includes(input.module))
      throw new FileRejectedError(
        'module',
        'module_not_allowed',
        'This module does not own this kind of file',
      )
    const extension = extensionOf(input.mime)
    if (!rule.mimes.includes(input.mime) || !extension)
      throw new FileRejectedError(
        'mime',
        'file_type_not_allowed',
        'This type of file is not allowed',
      )
    const maxBytes = maxBytesFor(input.purpose, input.mime, limits)
    if (!Number.isInteger(input.size) || input.size < 1)
      throw new FileRejectedError('size', 'file_empty', 'The file is empty')
    if (input.size > maxBytes)
      throw new FileRejectedError('size', 'file_too_large', 'The file is too large')
    return {
      maxBytes,
      file: {
        id,
        module: input.module,
        purpose: input.purpose,
        objectKey: objectKeyOf({
          env,
          buildingId: actor.buildingId,
          module: input.module,
          now,
          fileId: id,
          extension,
        }),
        mime: input.mime,
        size: input.size,
        status: 'pending',
        ownerRef: null,
        accountKind: actor.accountKind,
        accountId: actor.accountId,
      },
    }
  }

  /** A file the worker generates (a receipt, a ZIP, an export): a system purpose, no audience check, no quota (DR-123). */
  static generated(params: {
    id: string
    input: StoreGeneratedInput
    env: string
    now: Date
  }): NewFile {
    const { id, input, env, now } = params
    const rule = PURPOSE_RULES[input.purpose as GeneratedPurpose]
    if (!rule?.audience.system || !rule.modules.includes(input.module))
      throw new FileRejectedError('purpose', 'unknown_purpose', 'Not a generated kind of file')
    const extension = extensionOf(input.mime)
    if (!rule.mimes.includes(input.mime) || !extension)
      throw new FileRejectedError(
        'mime',
        'file_type_not_allowed',
        'This type of file is not allowed',
      )
    return {
      id,
      module: input.module,
      purpose: input.purpose,
      objectKey: objectKeyOf({
        env,
        buildingId: input.buildingId,
        module: input.module,
        now,
        fileId: id,
        extension,
      }),
      mime: input.mime,
      size: 0,
      status: 'pending',
      ownerRef: input.ownerRef,
      accountKind: 'system',
      accountId: SYSTEM_ACCOUNT_ID,
    }
  }

  /** The `thumbnail` row of this original: a WebP, `owner_ref = 'thumb:<id>'` (DOC-37 §10). */
  thumbnail(params: { id: string; env: string; now: Date }): NewFile {
    return {
      id: params.id,
      module: this.module,
      purpose: 'thumbnail',
      objectKey: objectKeyOf({
        env: params.env,
        buildingId: this.buildingId,
        module: this.module,
        now: params.now,
        fileId: params.id,
        extension: 'webp',
      }),
      mime: 'image/webp',
      size: 0,
      status: 'pending',
      ownerRef: `thumb:${this.id}`,
      accountKind: 'system',
      accountId: SYSTEM_ACCOUNT_ID,
    }
  }

  /**
   * `pending → verified` with the real size of the object (DOC-37 §6.3). `null` when the file is not `pending` any more: a double
   * click or the orphan job got there first.
   */
  verify(size: number, now: Date): FileTransition | null {
    if (this.status !== 'pending') return null
    return {
      id: this.id,
      expect: { status: 'pending' },
      set: { status: 'verified', verifiedAt: now, size },
    }
  }

  /**
   * `verified → attached` to the owner `ownerRef`, only for the account that registered the file (DOC-37 §6.4). `null` when the
   * file is not verified, is someone else's, or is attached already.
   */
  attach(
    ownerRef: string,
    actor: Pick<FileActor, 'accountKind' | 'accountId'>,
    now: Date,
  ): FileTransition | null {
    if (this.status !== 'verified' || !this.isOwnedBy(actor)) return null
    return {
      id: this.id,
      expect: { status: 'verified', accountKind: this.accountKind, accountId: this.accountId },
      set: { status: 'attached', attachedAt: now, ownerRef },
    }
  }

  /**
   * Any live status → `deleted` (the object goes with a delete command, DR-122). `null` when it is deleted already. The guard
   * is the status the rule read, so a file that moved on since (a pending upload that was verified) is decided again.
   */
  delete(now: Date): FileTransition | null {
    if (this.isDeleted) return null
    return {
      id: this.id,
      expect: { status: this.status },
      set: { status: 'deleted', deletedAt: now },
    }
  }

  /** A generated file is `pending → attached` at once, with the real size and the SHA-256 (DOC-37 §9 step 3). */
  completeGenerated(result: { size: number; checksum: string }, now: Date): FileTransition | null {
    if (this.status !== 'pending') return null
    return {
      id: this.id,
      expect: { status: 'pending' },
      set: {
        status: 'attached',
        verifiedAt: now,
        attachedAt: now,
        size: result.size,
        checksum: result.checksum,
      },
    }
  }

  /** Only the account that registered a file may verify it (DOC-37 §6.3). */
  isOwnedBy(actor: Pick<FileActor, 'accountKind' | 'accountId'>): boolean {
    return this.accountKind === actor.accountKind && this.accountId === actor.accountId
  }

  maxBytes(limits: FileLimits): number {
    return maxBytesFor(this.purpose, this.mime, limits)
  }

  /** Steps 3 of DOC-37 §6.3: the size and the type of the object. `null` when it is the file that was registered. */
  inspectObject(
    head: { size: number; contentType: string },
    limits: FileLimits,
  ): Exclude<ObjectFailure, 'bad_content'> | null {
    if (head.size < 1) return 'empty'
    if (head.size > this.maxBytes(limits)) return 'too_large'
    // The store may not enforce the signed type (Bun's presigner did not): compare it with what was registered.
    if (mediaType(head.contentType) !== this.mime) return 'wrong_type'
    return null
  }

  /** Step 4: the first bytes against the registered type (magic bytes). */
  inspectContent(head: Uint8Array): Extract<ObjectFailure, 'wrong_type' | 'bad_content'> | null {
    const verdict = checkContent(this.mime, head)
    return verdict === 'ok' ? null : verdict
  }

  /** Only an image gets a thumbnail when it is verified: a video shows a play icon (DOC-37 §10). */
  wantsThumbnailOnVerify(): boolean {
    return PURPOSE_RULES[this.purpose].thumbnail !== null && this.mime.startsWith('image/')
  }

  /** Which width the thumbnail worker uses; `null` for a kind that has none. */
  thumbnailKind(): 'thumb' | 'logo' | null {
    return PURPOSE_RULES[this.purpose].thumbnail
  }

  /** The thumbnail worker works on a verified or attached original only. */
  canHaveThumbnail(): boolean {
    return this.status === 'verified' || this.status === 'attached'
  }

  /** A vehicle paper has the short URL of FR-40.4. */
  hasPaperUrl(): boolean {
    return PURPOSE_RULES[this.purpose].url === 'paper'
  }

  get isDeleted(): boolean {
    return this.status === 'deleted'
  }
}

function authorise(actor: FileActor, rule: PurposeRule): void {
  if (rule.audience.system) throw new FilePurposeForbiddenError()
  const allowed =
    actor.accountKind === 'resident'
      ? rule.audience.resident === true
      : actor.accountKind === 'staff' &&
        actor.role !== undefined &&
        (rule.audience.staff?.includes(actor.role) ?? false)
  if (!allowed) throw new FilePurposeForbiddenError()
}
