import type { Clock, DomainEvent, IdGenerator, UnitOfWork } from '@core/kernel'
import { NotFoundError } from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { BuildingId, BuildingScope } from '@rms/shared-types'
import {
  BUILDING_EVENTS,
  type FileActor,
  type FileDto,
  type FilesApi,
  type GeneratedPurpose,
  type RegisterInput,
  type StoreGeneratedInput,
  SYSTEM_ACCOUNT_ID,
  type UploadTicket,
} from '../contracts'
import {
  FileNotVerifiedError,
  FilePurposeForbiddenError,
  FileRejectedError,
  FilesTransactionError,
  QuotaExceededError,
} from '../domain/errors'
import { checkContent, HEAD_BYTES } from '../domain/magic-bytes'
import { objectKeyOf } from '../domain/object-key'
import {
  extensionOf,
  type FileLimits,
  maxBytesFor,
  PURPOSE_RULES,
  type PurposeRule,
} from '../domain/purposes'
import type { BuildingDirectory } from './directory'
import type {
  FileRecord,
  FileRepository,
  ObjectStore,
  Thumbnailer,
  TransactionProbe,
  UploadRateLimiter,
} from './ports'

export interface FilesConfig {
  /** The profile that starts every object key: `local`, `staging`, `production`, `test`. */
  env: string
  uploadUrlTtlSeconds: number
  downloadUrlTtlSeconds: number
  paperUrlTtlSeconds: number
  limits: FileLimits
  thumbnailWidth: number
  logoWidth: number
  orphanAfterHours: number
  deletedRowRetentionDays: number
}

export interface FilesDeps {
  files: FileRepository
  store: ObjectStore
  uow: UnitOfWork
  transaction: TransactionProbe
  outbox: OutboxWriter
  clock: Clock
  ids: IdGenerator
  directory: BuildingDirectory
  rateLimiter: UploadRateLimiter
  thumbnailer: Thumbnailer
  config: FilesConfig
}

const scopeOf = (buildingId: string): BuildingScope => ({ buildingId: buildingId as BuildingId })
const mediaType = (contentType: string) => contentType.split(';')[0]?.trim().toLowerCase() ?? ''

const toFileDto = (file: FileRecord): FileDto => ({
  fileId: file.id,
  purpose: file.purpose,
  mime: file.mime,
  size: file.size,
  status: file.status,
  createdAt: file.createdAt.toISOString(),
})

/** The command `building` writes in the transaction that moves a file to `deleted` (DR-122). */
export const deleteCommand = (
  file: Pick<FileRecord, 'id' | 'buildingId'>,
  now: Date,
): DomainEvent => ({
  type: BUILDING_EVENTS.fileDeleteRequested,
  aggregateId: file.id,
  payload: { buildingId: file.buildingId, fileId: file.id },
  occurredAt: now,
})

const thumbnailCommand = (file: Pick<FileRecord, 'id' | 'buildingId'>, now: Date): DomainEvent => ({
  type: BUILDING_EVENTS.thumbnailRequested,
  aggregateId: file.id,
  payload: { buildingId: file.buildingId, fileId: file.id },
  occurredAt: now,
})

/**
 * `FilesApi` (DOC-37 §3): the one door to `building.file_object` and to the bucket for every module. No upload byte passes
 * through the API; the database decides what a file is; nothing is trusted until it is verified (DOC-37 §2).
 */
export class FilesService implements FilesApi {
  constructor(private readonly deps: FilesDeps) {}

  // --- register ----------------------------------------------------------------------------------------------------

  private authorise(actor: FileActor, rule: PurposeRule): void {
    if (rule.audience.system) throw new FilePurposeForbiddenError()
    const allowed =
      actor.accountKind === 'resident'
        ? rule.audience.resident === true
        : actor.accountKind === 'staff' &&
          actor.role !== undefined &&
          (rule.audience.staff?.includes(actor.role) ?? false)
    if (!allowed) throw new FilePurposeForbiddenError()
  }

  /** The checks of DOC-37 §6.1 steps 1 and 2: the audience, the module, the type and the size. Nothing is written yet. */
  private validate(actor: FileActor, input: RegisterInput) {
    const { config } = this.deps
    const rule = (PURPOSE_RULES as Record<string, PurposeRule | undefined>)[input.purpose]
    // A purpose that does not exist (a CCCD image, DOC-37 §2) is a bad request; one the system writes is forbidden.
    if (!rule)
      throw new FileRejectedError('purpose', 'unknown_purpose', 'There is no such kind of file')
    this.authorise(actor, rule)
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
    const maxBytes = maxBytesFor(input.purpose, input.mime, config.limits)
    if (!Number.isInteger(input.size) || input.size < 1)
      throw new FileRejectedError('size', 'file_empty', 'The file is empty')
    if (input.size > maxBytes)
      throw new FileRejectedError('size', 'file_too_large', 'The file is too large')
    return { extension, maxBytes }
  }

  async register(actor: FileActor, input: RegisterInput): Promise<UploadTicket> {
    const { config, directory, rateLimiter, files, uow, clock, ids, store } = this.deps
    const { extension, maxBytes } = this.validate(actor, input)

    await rateLimiter.take(actor.accountId)

    const scope = scopeOf(actor.buildingId)
    const settings = await directory.getSettings(actor.buildingId)
    const used = await files.usedBytes(scope)
    // Not atomic with the insert: concurrent registers can overshoot by their number times the size; the hourly job corrects (DOC-37 §11).
    if (used + input.size > settings.storageQuotaBytes)
      throw new QuotaExceededError(used, settings.storageQuotaBytes)

    const now = clock.now()
    const id = ids.next()
    const objectKey = objectKeyOf({
      env: config.env,
      buildingId: actor.buildingId,
      module: input.module,
      now,
      fileId: id,
      extension,
    })
    await uow.run(() =>
      files.insert(
        scope,
        {
          id,
          module: input.module,
          purpose: input.purpose,
          objectKey,
          mime: input.mime,
          size: input.size,
          status: 'pending',
          ownerRef: null,
          accountKind: actor.accountKind,
          accountId: actor.accountId,
        },
        now,
      ),
    )
    const expiresInSeconds = config.uploadUrlTtlSeconds
    return {
      fileId: id,
      method: 'PUT',
      url: store.presignPut(objectKey, { contentType: input.mime, expiresInSeconds }),
      headers: { 'Content-Type': input.mime },
      expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
      maxBytes,
    }
  }

  // --- verify ------------------------------------------------------------------------------------------------------

  async verify(actor: FileActor, fileId: string): Promise<FileDto> {
    const { files, store, uow, outbox, clock, config, transaction } = this.deps
    // It talks to the bucket: no transaction may be open while it does (DOC-12 §8.2).
    if (transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.verify must be called outside a transaction')
    const scope = scopeOf(actor.buildingId)
    const file = await files.find(scope, fileId)
    if (!file || file.accountKind !== actor.accountKind || file.accountId !== actor.accountId)
      throw new NotFoundError()
    // A retry after a lost response answers the same 200 without touching the bucket (DR-146).
    if (file.status === 'verified') return toFileDto(file)
    if (file.status !== 'pending') throw new NotFoundError()

    const rule = PURPOSE_RULES[file.purpose]
    const maxBytes = maxBytesFor(file.purpose, file.mime, config.limits)

    const head = await store.head(file.objectKey)
    // Not there yet: the row stays pending so the client can retry inside the window.
    if (!head) throw new FileNotVerifiedError('missing')

    const failure = await this.inspect(file, head, maxBytes)

    const now = clock.now()
    if (failure) {
      // The object is deleted by the worker, not by this request (DOC-37 §6.3 step 6).
      await uow.run(async () => {
        const deleted = await files.markDeleted(scope, file.id, now)
        if (deleted) await outbox.add([deleteCommand(deleted, now)])
      })
      throw new FileNotVerifiedError(failure)
    }
    const verified = await uow.run(async () => {
      const row = await files.markVerified(scope, file.id, head.size, now)
      // Only an image gets a thumbnail: a video shows a play icon (DOC-37 §10).
      if (row && rule.thumbnail && row.mime.startsWith('image/'))
        await outbox.add([thumbnailCommand(row, now)])
      return row
    })
    // Lost a race with the orphan job or a double click that verified first: read the row again.
    const current = verified ?? (await files.find(scope, file.id))
    if (current?.status !== 'verified') throw new NotFoundError()
    return toFileDto(current)
  }

  /** Steps 3 and 4 of DOC-37 §6.3: the size and type of the object, then the first 4 KB. `null` when the file passes. */
  private async inspect(
    file: FileRecord,
    head: { size: number; contentType: string },
    maxBytes: number,
  ): Promise<'empty' | 'too_large' | 'wrong_type' | 'bad_content' | null> {
    if (head.size < 1) return 'empty'
    if (head.size > maxBytes) return 'too_large'
    // The store may not enforce the signed type (Bun's presigner did not): compare it with what was registered.
    if (mediaType(head.contentType) !== file.mime) return 'wrong_type'
    const bytes = await this.deps.store.readHead(file.objectKey, HEAD_BYTES)
    if (!bytes) throw new FileNotVerifiedError('missing')
    const verdict = checkContent(file.mime, bytes)
    return verdict === 'ok' ? null : verdict
  }

  // --- attach and remove: the owner's transaction ------------------------------------------------------------------

  async attach(actor: FileActor, fileId: string, ownerRef: string): Promise<void> {
    const { files, clock, transaction } = this.deps
    if (!transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.attach must be called inside the owner transaction')
    const done = await files.attach(
      scopeOf(actor.buildingId),
      { id: fileId, ownerRef, accountKind: actor.accountKind, accountId: actor.accountId },
      clock.now(),
    )
    // Not verified, someone else's, or attached already: the owner's transaction rolls back (DOC-37 §6.4).
    if (!done) throw new FileNotVerifiedError('not_verified')
  }

  async remove(actor: FileActor, fileId: string): Promise<void> {
    const { files, outbox, clock, transaction } = this.deps
    if (!transaction.inTransaction)
      throw new FilesTransactionError('FilesApi.remove must be called inside the owner transaction')
    const scope = scopeOf(actor.buildingId)
    const now = clock.now()
    const file = await files.find(scope, fileId)
    if (!file) throw new NotFoundError()
    const targets = [file]
    const thumbnail = await files.findThumbnail(scope, file.id)
    if (thumbnail) targets.push(thumbnail)
    for (const target of targets) {
      const deleted = await files.markDeleted(scope, target.id, now)
      if (deleted) await outbox.add([deleteCommand(deleted, now)])
    }
  }

  // --- reads -------------------------------------------------------------------------------------------------------

  async usage(buildingId: string) {
    const [usedBytes, settings] = await Promise.all([
      this.deps.files.usedBytes(scopeOf(buildingId)),
      this.deps.directory.getSettings(buildingId),
    ])
    const quotaBytes = settings.storageQuotaBytes
    return { usedBytes, quotaBytes, ratio: usedBytes / quotaBytes }
  }

  async signedUrl(
    fileId: string,
    opts: { variant?: 'original' | 'thumb'; downloadName?: string } = {},
  ): Promise<string | null> {
    const { files, store, config } = this.deps
    // The module that builds a DTO has authorised the file already; FilesApi does not authorise (DOC-37 §8).
    const file = await files.findAnyBuilding(fileId)
    if (!file || file.status === 'deleted') return null
    let target = file
    if (opts.variant === 'thumb') {
      const thumb = await files.findThumbnail(scopeOf(file.buildingId), file.id)
      if (thumb) target = thumb
    }
    const rule = PURPOSE_RULES[file.purpose]
    return store.presignGet(target.objectKey, {
      expiresInSeconds:
        rule.url === 'paper' ? config.paperUrlTtlSeconds : config.downloadUrlTtlSeconds,
      downloadName: opts.downloadName,
    })
  }

  // --- generated files ---------------------------------------------------------------------------------------------

  async storeGenerated(input: StoreGeneratedInput): Promise<FileDto> {
    const { files, store, uow, clock, ids, config } = this.deps
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
    const scope = scopeOf(input.buildingId)
    const id = ids.next()
    const objectKey = objectKeyOf({
      env: config.env,
      buildingId: input.buildingId,
      module: input.module,
      now: clock.now(),
      fileId: id,
      extension,
    })
    // Quota is not checked: a receipt must render even when the building is at its limit (DR-123).
    await uow.run(() =>
      files.insert(
        scope,
        {
          id,
          module: input.module,
          purpose: input.purpose,
          objectKey,
          mime: input.mime,
          size: 0,
          status: 'pending',
          ownerRef: input.ownerRef,
          accountKind: 'system',
          accountId: SYSTEM_ACCOUNT_ID,
        },
        clock.now(),
      ),
    )
    // A failure here leaves the row pending; the orphan job removes it after 24 hours (DOC-37 §9 step 4).
    const written = await store.put(objectKey, input.body, input.mime)
    const stored = await uow.run(() =>
      files.completeGenerated(
        scope,
        id,
        { size: written.size, checksum: written.sha256 },
        clock.now(),
      ),
    )
    if (!stored) throw new FileNotVerifiedError('not_verified')
    return toFileDto(stored)
  }
}
