import { S3Client } from 'bun'
import type { ObjectStat, ObjectStorage } from './ports'
import { presignPut } from './sigv4-presign'

export interface S3Options {
  endpoint: string
  /** Endpoint reachable from the BROWSER (the presigned signature is bound to this host). */
  publicEndpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

const PART_SIZE = 8 * 1024 * 1024

export class S3ObjectStorage implements ObjectStorage {
  private readonly internal: S3Client
  private readonly signer: S3Client

  constructor(private readonly options: S3Options) {
    const base = {
      region: options.region,
      bucket: options.bucket,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    }
    this.internal = new S3Client({ ...base, endpoint: options.endpoint })
    // Presigning only computes the signature locally, no network call.
    this.signer = new S3Client({ ...base, endpoint: options.publicEndpoint })
  }

  presignPut(
    key: string,
    opts: { contentType: string; expiresInSeconds: number; contentLength?: number },
  ): string {
    // Not Bun's `presign`: it does not sign the Content-Type, so the store would accept any type (see `sigv4-presign.ts`).
    return presignPut({
      endpoint: this.options.publicEndpoint,
      region: this.options.region,
      bucket: this.options.bucket,
      accessKeyId: this.options.accessKeyId,
      secretAccessKey: this.options.secretAccessKey,
      key,
      contentType: opts.contentType,
      contentLength: opts.contentLength,
      expiresInSeconds: opts.expiresInSeconds,
      now: new Date(),
    })
  }

  presignGet(key: string, expiresInSeconds: number, opts: { downloadName?: string } = {}): string {
    return this.signer.file(key).presign({
      method: 'GET',
      expiresIn: expiresInSeconds,
      ...(opts.downloadName
        ? {
            contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.downloadName)}`,
          }
        : {}),
    })
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const s = await this.internal.file(key).stat()
      return { size: s.size, contentType: s.type }
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'NoSuchKey' || code === 'NotFound') return null
      throw err
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return await this.internal.file(key).bytes()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'NoSuchKey' || code === 'NotFound') return null
      throw err
    }
  }

  async readRange(key: string, start: number, endExclusive: number): Promise<Uint8Array | null> {
    try {
      return await this.internal.file(key).slice(start, endExclusive).bytes()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'NoSuchKey' || code === 'NotFound') return null
      throw err
    }
  }

  async write(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await this.internal.file(key).write(data, { type: contentType })
  }

  async writeStream(
    key: string,
    data: ReadableStream<Uint8Array>,
    contentType: string,
  ): Promise<void> {
    // The writer is a multipart upload: a part of 8 MB goes out as it fills, and `end()` completes it (DOC-37 §9). `write` only
    // queues, so without the flush a fast producer is buffered whole (measured 2026-10-22: 132 MB of RSS for a 64 MB stream, 26 MB
    // with a flush per part). If the stream fails, the parts already uploaded are aborted by the bucket's lifecycle rule (DOC-37 §5).
    const writer = this.internal
      .file(key)
      .writer({ type: contentType, partSize: PART_SIZE, queueSize: 2 })
    let buffered = 0
    for await (const chunk of data) {
      writer.write(chunk)
      buffered += chunk.byteLength
      if (buffered >= PART_SIZE) {
        await writer.flush()
        buffered = 0
      }
    }
    await writer.end()
  }

  async delete(key: string): Promise<void> {
    await this.internal.file(key).delete()
  }

  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0
    // Deleted keys drop out of the listing, so asking for the first page again each time walks the whole prefix.
    for (;;) {
      const page = await this.internal.list({ prefix, maxKeys: 500 })
      const keys = (page.contents ?? []).map((object) => object.key)
      if (keys.length === 0) return deleted
      await Promise.all(keys.map((key) => this.internal.file(key).delete()))
      deleted += keys.length
      if (!page.isTruncated) return deleted
    }
  }
}
