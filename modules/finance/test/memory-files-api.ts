/**
 * The in-memory `FilesApi` the finance PDF tests share (DOC-34 §8.1, §8.2; DR-293): the methods a PDF use case calls
 * over an object store a test can inspect, so no bucket and no database are needed. Extracted from
 * `receipt-pdf.integration.test.ts` for the fee-notice test of the same cache (§8.1).
 */
import type { UuidV7Generator } from '@core/kernel'
import type {
  FileActor,
  FileDto,
  FileExpectation,
  FilesApi,
  FindByOwnerRefInput,
  StoreGeneratedInput,
} from '@mod/building/contracts'

/** The `createdAt` a stored row reports; no test asserts it (the DTO is opaque to the use cases). */
const CREATED_AT = '2026-10-19T02:00:00.000Z'

/** One stored row and the sequence that makes `findByOwnerRef` answer the newest attached one. */
export interface StoredFile {
  readonly fileId: string
  readonly buildingId: string
  readonly module: string
  readonly purpose: string
  readonly ownerRef: string | null
  status: 'attached' | 'deleted'
  readonly bytes: Uint8Array
  readonly seq: number
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** The real `FilesApi`'s rules for the methods the PDF use cases call, over an in-memory object store. */
export class MemoryFilesApi
  implements Pick<FilesApi, 'read' | 'attach' | 'remove' | 'storeGenerated' | 'findByOwnerRef'>
{
  private seq = 0

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }
  readonly files = new Map<string, StoredFile>()

  constructor(private readonly ids: UuidV7Generator) {}

  /** Neither PDF path attaches a file by hand: `storeGenerated` writes it `attached`. */
  async attach(): Promise<void> {
    throw new Error('attach is not used by the PDFs')
  }

  async storeGenerated(input: StoreGeneratedInput): Promise<FileDto> {
    const bytes = input.body instanceof Uint8Array ? input.body : await collect(input.body)
    const fileId = this.ids.next()
    this.files.set(fileId, {
      fileId,
      buildingId: input.buildingId,
      module: input.module,
      purpose: input.purpose,
      ownerRef: input.ownerRef,
      status: 'attached',
      bytes,
      seq: this.nextSeq(),
    })
    const dto = this.dto(fileId)
    if (!dto) throw new Error('the stored file vanished')
    return dto
  }

  async findByOwnerRef(buildingId: string, input: FindByOwnerRefInput): Promise<FileDto | null> {
    const match = this.attached(buildingId, input).sort((a, b) => b.seq - a.seq)[0]
    return match ? (this.dto(match.fileId) ?? null) : null
  }

  async read(_actor: FileActor, fileId: string, expect: FileExpectation): Promise<Uint8Array> {
    const file = this.files.get(fileId)
    if (!file || file.status !== 'attached' || file.ownerRef !== expect.ownerRef)
      throw new Error('file_not_verified')
    return file.bytes
  }

  async remove(_actor: FileActor, fileId: string): Promise<void> {
    const file = this.files.get(fileId)
    if (file) file.status = 'deleted'
  }

  /** The `attached` rows of a building, module, purpose and ownerRef, in insert order. */
  attached(
    buildingId: string,
    input: { module: string; purpose: string; ownerRef: string },
  ): StoredFile[] {
    return [...this.files.values()].filter(
      (file) =>
        file.status === 'attached' &&
        file.buildingId === buildingId &&
        file.module === input.module &&
        file.purpose === input.purpose &&
        file.ownerRef === input.ownerRef,
    )
  }

  /** Every row of a key, `attached` or `deleted` (the PD-23 check). */
  all(ownerRef: string, buildingId: string): StoredFile[] {
    return [...this.files.values()].filter(
      (file) => file.ownerRef === ownerRef && file.buildingId === buildingId,
    )
  }

  private dto(fileId: string): FileDto | undefined {
    const file = this.files.get(fileId)
    if (!file) return undefined
    return {
      fileId: file.fileId,
      purpose: file.purpose as FileDto['purpose'],
      mime: 'application/pdf',
      size: file.bytes.byteLength,
      status: file.status,
      createdAt: CREATED_AT,
    }
  }
}
