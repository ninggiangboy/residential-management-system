import { createHash, createHmac } from 'node:crypto'

/**
 * A presigned `PUT` whose `Content-Type` (and, if asked, `Content-Length`) is part of the signature (AWS Signature Version 4,
 * query string authentication). Bun's `S3File.presign({ type })` does not sign the header, so a client could upload another type
 * than it registered; this one makes the store refuse it with 403 `SignatureDoesNotMatch` (DOC-37 §6.2, U2, measured on
 * SeaweedFS 4.48 on 2026-10-22). Path-style addressing, `UNSIGNED-PAYLOAD`, no dependency: it is local arithmetic, so it is
 * synchronous and may run inside a transaction (DOC-37 §2 rule 4).
 */

export interface PresignPutOptions {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  key: string
  contentType: string
  /** When set, the exact size is signed too, and a store that honors it refuses a body of another size (U3). */
  contentLength?: number
  expiresInSeconds: number
  now: Date
}

const sha256 = (data: string) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest()

/** RFC 3986 percent-encoding as SigV4 wants it: only unreserved characters stay. */
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

export function presignPut(options: PresignPutOptions): string {
  const { endpoint, region, bucket, key, contentType, contentLength } = options
  const url = new URL(endpoint)
  const amzDate = options.now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const scope = `${date}/${region}/s3/aws4_request`

  const headers: Array<[string, string]> = [['content-type', contentType]]
  if (contentLength !== undefined) headers.push(['content-length', String(contentLength)])
  headers.push(['host', url.host])
  headers.sort(([a], [b]) => (a < b ? -1 : 1))
  const signedHeaders = headers.map(([name]) => name).join(';')

  const query: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${options.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(options.expiresInSeconds)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ]
  query.sort(([a], [b]) => (a < b ? -1 : 1))
  const canonicalQuery = query.map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&')

  const path = `${url.pathname.replace(/\/$/, '')}/${bucket}/${key.split('/').map(encode).join('/')}`
  const canonicalRequest = [
    'PUT',
    path,
    canonicalQuery,
    `${headers.map(([name, value]) => `${name}:${value.trim()}`).join('\n')}\n`,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, date), region), 's3'),
    'aws4_request',
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}
