/** Ports to the outside only; the repositories are interfaces of the domain (DOC-12 §4.5 rule 5). */

/** The bucket, as the file use cases need it. The adapter wraps `@core/storage` (DOC-37 §5). */
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

/** Where `storage_usage_ratio` goes (DOC-40); wired with the metrics endpoint in P1-18. A demo building is left out of the system-wide gauge (DOC-36 §9.3). */
export interface UsageReporter {
  report(buildingId: string, ratio: number, isDemo: boolean): void
}
