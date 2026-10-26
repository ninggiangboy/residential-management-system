import { describe, expect, test } from 'bun:test'
import { S3ObjectStorage } from '@core/storage'
import sharp from 'sharp'

/**
 * DOC-37 §12 and DOC-11 §10 row 13: the upload checks that decide whether the design of ADR-0016 holds on the object store:
 * a presigned `PUT` with a signed `Content-Type`, whether a signed `Content-Length` is honored, `HEAD` and a ranged `GET`, a
 * presigned `GET` with a download name, the CORS preflight, a stream through the multipart writer, and `sharp` on Bun.
 *
 * They run against whatever `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` name: SeaweedFS locally
 * (`bun --env-file=.env.local test tools/compat/uploads.test.ts`), the staging SeaweedFS behind the files host (`files-staging.<domain>`, DR-268) when its
 * credentials are given (set `UPLOAD_CHECK_ORIGIN` to the CMS origin that the bucket's CORS allows); R2 is the `global` profile only. Without a reachable store they skip.
 * Each check prints its measured result as `UPLOAD-CHECK U<n>: …`, which is what DOC-37 §12 records.
 */

const { S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET } = process.env
const reachable = await (async () => {
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) return false
  try {
    await fetch(S3_ENDPOINT, { signal: AbortSignal.timeout(1500) })
    return true
  } catch {
    return false
  }
})()

const say = (check: string, result: string) =>
  process.stdout.write(`UPLOAD-CHECK ${check}: ${result}\n`)
const ORIGIN = process.env.UPLOAD_CHECK_ORIGIN ?? 'http://localhost:5173'

describe.skipIf(!reachable)('uploads on the object store (DOC-37 §12)', () => {
  const storage = new S3ObjectStorage({
    endpoint: S3_ENDPOINT as string,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? (S3_ENDPOINT as string),
    region: process.env.S3_REGION ?? 'auto',
    bucket: S3_BUCKET as string,
    accessKeyId: S3_ACCESS_KEY_ID as string,
    secretAccessKey: S3_SECRET_ACCESS_KEY as string,
  })
  const prefix = `compat/${crypto.randomUUID()}/`
  const jpegBytes = (size: number) => {
    const bytes = new Uint8Array(size).fill(7)
    bytes.set([0xff, 0xd8, 0xff, 0xe0])
    return bytes
  }

  test('U1 a PUT to a presigned URL with the signed Content-Type is accepted', async () => {
    const key = `${prefix}u1.jpg`
    const url = storage.presignPut(key, { contentType: 'image/jpeg', expiresInSeconds: 900 })
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host')
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: jpegBytes(5000),
    })
    say('U1', `PUT with the signed Content-Type → ${response.status}`)
    expect(response.status).toBe(200)
    expect((await storage.stat(key))?.size).toBe(5000)
  })

  test('U2 a PUT that declares another Content-Type than the one signed is refused', async () => {
    const key = `${prefix}u2.jpg`
    const url = storage.presignPut(key, { contentType: 'image/jpeg', expiresInSeconds: 900 })
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: jpegBytes(100),
    })
    const body = await response.text()
    say(
      'U2',
      `PUT with another Content-Type → ${response.status} ${/SignatureDoesNotMatch/.test(body) ? 'SignatureDoesNotMatch' : body.slice(0, 80)}`,
    )
    expect(response.status).toBe(403)
    expect(await storage.stat(key)).toBeNull()
  })

  test('U3 whether a signed Content-Length is honored (the design does not depend on it)', async () => {
    const key = `${prefix}u3.jpg`
    const url = storage.presignPut(key, {
      contentType: 'image/jpeg',
      expiresInSeconds: 900,
      contentLength: 100,
    })
    const signed = new URL(url).searchParams.get('X-Amz-SignedHeaders')
    expect(signed).toBe('content-length;content-type;host')
    const exact = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: jpegBytes(100),
    })
    const bigger = await fetch(
      storage.presignPut(`${key}.big`, {
        contentType: 'image/jpeg',
        expiresInSeconds: 900,
        contentLength: 100,
      }),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: jpegBytes(5000),
      },
    )
    say(
      'U3',
      `signed 100 bytes: a body of 100 → ${exact.status}; a body of 5000 → ${bigger.status} (${bigger.status === 403 ? 'honored' : 'not honored'})`,
    )
    expect(exact.status).toBe(200)
    expect([200, 403]).toContain(bigger.status)
  })

  test('U4 HEAD returns the size and the type, and a ranged GET returns 206 with exactly 4,096 bytes', async () => {
    const key = `${prefix}u4.jpg`
    await storage.write(key, jpegBytes(20_000), 'image/jpeg')
    const stat = await storage.stat(key)
    expect(stat).toEqual({ size: 20_000, contentType: 'image/jpeg' })
    const head = await storage.readRange(key, 0, 4096)
    expect(head?.byteLength).toBe(4096)
    const raw = await fetch(storage.presignGet(key, 60), { headers: { Range: 'bytes=0-4095' } })
    say(
      'U4',
      `HEAD ${stat?.size} ${stat?.contentType}; GET Range 0-4095 → ${raw.status}, ${(await raw.arrayBuffer()).byteLength} bytes`,
    )
    expect(raw.status).toBe(206)
  })

  test('U5 a client that registers 5 MB and uploads 11 MB: the object is there until verify deletes it', async () => {
    // The verify, the 422 and the worker's delete are FS-04 (modules/building); here only that the store takes the oversize body.
    const key = `${prefix}u5.jpg`
    const url = storage.presignPut(key, { contentType: 'image/jpeg', expiresInSeconds: 900 })
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: jpegBytes(11 * 1_048_576),
    })
    say(
      'U5',
      `PUT of 11 MB after registering 5 MB → ${response.status}; HEAD size ${(await storage.stat(key))?.size}`,
    )
    expect(response.status).toBe(200)
    await storage.delete(key)
    expect(await storage.stat(key)).toBeNull()
  })

  test('U6 a second PUT to the same key with If-None-Match: * is not signed by the presigner: not run, the residual risk stays accepted', () => {
    say(
      'U6',
      'not run: the presigner signs content-type (and optionally content-length) only; DOC-37 §12 keeps the residual risk',
    )
    expect(true).toBe(true)
  })

  test('U7 DeleteObject on a missing key is a success', async () => {
    await storage.delete(`${prefix}never-existed.jpg`)
    await storage.delete(`${prefix}never-existed.jpg`)
    say('U7', 'DeleteObject of a missing key twice → no error')
  })

  test('U8 sharp on Bun makes a 480 px WebP from a 1,920 px JPEG in under 150 ms, and 100 of them stay under 200 MB of RSS growth', async () => {
    const noise = Buffer.alloc(1920 * 1080 * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 31 + (i >> 8)) & 0xff
    const source = await sharp(noise, { raw: { width: 1920, height: 1080, channels: 3 } })
      .jpeg({ quality: 80 })
      .toBuffer()
    const resize = () =>
      sharp(source)
        .rotate()
        .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer()
    const first = performance.now()
    const out = await resize()
    const firstMs = performance.now() - first
    expect((await sharp(out).metadata()).width).toBe(480)
    const rss0 = process.memoryUsage().rss
    const started = performance.now()
    for (let i = 0; i < 100; i++) await resize()
    const meanMs = (performance.now() - started) / 100
    const growthMb = (process.memoryUsage().rss - rss0) / 1_048_576
    say(
      'U8',
      `${source.length} bytes JPEG → ${out.length} bytes WebP; first ${firstMs.toFixed(0)} ms, mean of 100 ${meanMs.toFixed(0)} ms, RSS growth ${growthMb.toFixed(0)} MB, sharp ${sharp.versions.sharp}`,
    )
    expect(meanMs).toBeLessThan(150)
    expect(growthMb).toBeLessThan(200)
  })

  // 64 MB locally: the dev store has 8 volumes of 512 MB, and deleted data waits for a vacuum. DOC-37 §12 asks for 200 MB on staging.
  const streamMb = Number(process.env.UPLOAD_CHECK_STREAM_MB ?? 64)
  test(`U9 a ${streamMb} MB stream goes through the multipart writer without holding it in memory`, async () => {
    const key = `${prefix}u9.zip`
    const chunk = new Uint8Array(1_048_576).fill(9)
    let sent = 0
    const rss0 = process.memoryUsage().rss
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === streamMb) return controller.close()
        sent++
        controller.enqueue(chunk)
      },
    })
    const started = performance.now()
    await storage.writeStream(key, stream, 'application/zip')
    const seconds = (performance.now() - started) / 1000
    const growthMb = (process.memoryUsage().rss - rss0) / 1_048_576
    say(
      'U9',
      `${streamMb} MB stream → ${(await storage.stat(key))?.size} bytes in ${seconds.toFixed(1)} s, RSS growth ${growthMb.toFixed(0)} MB (the bucket's lifecycle rule for aborted parts is not tested here)`,
    )
    expect((await storage.stat(key))?.size).toBe(streamMb * 1_048_576)
    expect(growthMb).toBeLessThan(100)
    await storage.delete(key)
  }, 120_000)

  test('U10 a presigned GET with a download name is served with Content-Disposition', async () => {
    const key = `${prefix}u10.pdf`
    await storage.write(key, new TextEncoder().encode('%PDF-1.7 test'), 'application/pdf')
    const response = await fetch(
      storage.presignGet(key, 60, { downloadName: 'Biên lai 10-2026.pdf' }),
    )
    say(
      'U10',
      `GET → ${response.status}, Content-Disposition: ${response.headers.get('content-disposition')}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''Bi%C3%AAn%20lai%2010-2026.pdf",
    )
  })

  test('U11 the CORS preflight is allowed for PUT and content-type from the CMS origin and refused from another origin', async () => {
    const url = storage.presignPut(`${prefix}u11.jpg`, {
      contentType: 'image/jpeg',
      expiresInSeconds: 900,
    })
    const preflight = (origin: string) =>
      fetch(url, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'PUT',
          'Access-Control-Request-Headers': 'content-type',
        },
      })
    const allowed = await preflight(ORIGIN)
    const refused = await preflight('https://evil.example')
    say(
      'U11',
      `from ${ORIGIN} → ${allowed.status}, allow-origin ${allowed.headers.get('access-control-allow-origin')}, methods ${allowed.headers.get('access-control-allow-methods')}; from evil.example → ${refused.status}, allow-origin ${refused.headers.get('access-control-allow-origin')}`,
    )
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(allowed.headers.get('access-control-allow-methods')).toContain('PUT')
    expect(refused.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('cleanup', async () => {
    await storage.deletePrefix(prefix)
  })
})
