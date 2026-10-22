export interface ObjectStat {
  size: number
  contentType: string
}

export interface ObjectStorage {
  /** The `Content-Type` is part of the signature: the store refuses an upload that declares another one. `contentLength` signs the size too (U3). */
  presignPut(
    key: string,
    opts: { contentType: string; expiresInSeconds: number; contentLength?: number },
  ): string
  /** `downloadName` adds `response-content-disposition: attachment; filename*=UTF-8''…`, so a download saves under that name. */
  presignGet(key: string, expiresInSeconds: number, opts?: { downloadName?: string }): string
  stat(key: string): Promise<ObjectStat | null>
  /** The object's bytes, or `null` when it does not exist. */
  read(key: string): Promise<Uint8Array | null>
  /** Bytes `start` up to `endExclusive` (a ranged `GET`, so a large object is not downloaded to read its first 4 KB); `null` when it does not exist. */
  readRange(key: string, start: number, endExclusive: number): Promise<Uint8Array | null>
  /** Creates or overwrites the object. */
  write(key: string, data: Uint8Array, contentType: string): Promise<void>
  /** Creates or overwrites from a stream without holding it in memory (multipart on S3); a failed stream leaves no object. */
  writeStream(key: string, data: ReadableStream<Uint8Array>, contentType: string): Promise<void>
  delete(key: string): Promise<void>
  /** Deletes every object whose key starts with `prefix`; returns how many. Idempotent: nothing to delete is fine. */
  deletePrefix(prefix: string): Promise<number>
}
