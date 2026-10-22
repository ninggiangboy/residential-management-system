import type { ObjectStorage } from '@core/storage'
import type { ObjectStore } from '../../application/ports'

/** The bucket as `FilesService` sees it, over the `ObjectStorage` of `@core/storage` (S3 on R2 or SeaweedFS, the disk, or a fake). */
export class CoreObjectStore implements ObjectStore {
  constructor(private readonly storage: ObjectStorage) {}

  presignPut(key: string, opts: { contentType: string; expiresInSeconds: number }): string {
    return this.storage.presignPut(key, opts)
  }

  presignGet(key: string, opts: { expiresInSeconds: number; downloadName?: string }): string {
    return this.storage.presignGet(key, opts.expiresInSeconds, { downloadName: opts.downloadName })
  }

  head(key: string) {
    return this.storage.stat(key)
  }

  readHead(key: string, length: number) {
    return this.storage.readRange(key, 0, length)
  }

  read(key: string) {
    return this.storage.read(key)
  }

  /** The SHA-256 is computed while the bytes go through, so a large stream is never held in memory (DOC-37 §9). */
  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    contentType: string,
  ): Promise<{ size: number; sha256: string }> {
    const hasher = new Bun.CryptoHasher('sha256')
    if (body instanceof Uint8Array) {
      hasher.update(body)
      await this.storage.write(key, body, contentType)
      return { size: body.byteLength, sha256: hasher.digest('hex') }
    }
    let size = 0
    const counted = body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength
          hasher.update(chunk)
          controller.enqueue(chunk)
        },
      }),
    )
    await this.storage.writeStream(key, counted, contentType)
    return { size, sha256: hasher.digest('hex') }
  }

  delete(key: string) {
    return this.storage.delete(key)
  }
}
