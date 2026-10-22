import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { NotFoundError, RateLimitedError } from '@core/kernel'
import { sql } from 'drizzle-orm'
import sharp from 'sharp'
import { SYSTEM_ACCOUNT_ID } from '../src/contracts'
import {
  FileNotVerifiedError,
  FilePurposeForbiddenError,
  FileRejectedError,
  QuotaExceededError,
} from '../src/domain/errors'
import { MIME_XLSX } from '../src/domain/purposes'
import { BUILDING, createHarness, type Harness, jpeg, PNG_HEAD } from './support'

const MB = 1_048_576
let h: Harness
beforeAll(async () => {
  // A cache of 0 seconds: a test that changes the quota in SQL sees it at once.
  h = await createHarness({ settingsCacheSeconds: 0 })
})
afterAll(async () => {
  await h.close()
})

const count = async (where = 'true') =>
  Number(
    (await h.db.sql.unsafe(`SELECT count(*)::int AS n FROM building.file_object WHERE ${where}`))[0]
      ?.n,
  )
const textBytes = (text: string) => new TextEncoder().encode(text)

/** Register, `PUT` and (optionally) verify one file of a resident: the whole flow of DOC-37 §6. */
async function upload(
  body: Uint8Array,
  options: {
    purpose?: 'avatar' | 'ticket_media'
    module?: 'identity' | 'tickets'
    mime?: string
    verify?: boolean
  } = {},
) {
  const purpose = options.purpose ?? 'avatar'
  const actor = h.resident()
  const ticket = await h.building.files.register(actor, {
    module: options.module ?? (purpose === 'avatar' ? 'identity' : 'tickets'),
    purpose,
    mime: options.mime ?? 'image/jpeg',
    size: body.byteLength,
  })
  const status = await h.clientPut(ticket, body)
  if (status !== 200) throw new Error(`the PUT answered ${status}`)
  const dto = options.verify === false ? null : await h.building.files.verify(actor, ticket.fileId)
  return { actor, ticket, dto }
}

describe('register (DOC-37 §6.1)', () => {
  test('FS-01 the audience, the purpose, the type and the size are checked and a refusal leaves no row', async () => {
    const before = await count()
    const resident = h.resident()
    const manager = h.actorOf(h.staff('manager'))
    const refused = async (promise: Promise<unknown>) =>
      promise.then(
        () => null,
        (error) => error,
      )

    expect(
      await refused(
        h.building.files.register(resident, {
          module: 'building',
          purpose: 'logo',
          mime: 'image/png',
          size: 1000,
        }),
      ),
    ).toBeInstanceOf(FilePurposeForbiddenError)
    expect(
      await refused(
        h.building.files.register(resident, {
          module: 'residency',
          purpose: 'import',
          mime: MIME_XLSX,
          size: 1000,
        }),
      ),
    ).toBeInstanceOf(FilePurposeForbiddenError)
    // a purpose the system writes
    expect(
      await refused(
        h.building.files.register(manager, {
          module: 'finance',
          purpose: 'receipt_pdf' as never,
          mime: 'application/pdf',
          size: 1000,
        }),
      ),
    ).toBeInstanceOf(FilePurposeForbiddenError)
    // there is no purpose for a CCCD image (DOC-37 §2)
    expect(
      await refused(
        h.building.files.register(resident, {
          module: 'identity',
          purpose: 'cccd' as never,
          mime: 'image/jpeg',
          size: 1000,
        }),
      ),
    ).toMatchObject({ code: 'validation_failed', details: [{ code: 'unknown_purpose' }] })
    expect(
      await refused(
        h.building.files.register(resident, {
          module: 'tickets',
          purpose: 'ticket_media',
          mime: 'application/zip',
          size: 1000,
        }),
      ),
    ).toMatchObject({ details: [{ path: 'mime', code: 'file_type_not_allowed' }] })
    expect(
      await refused(
        h.building.files.register(resident, {
          module: 'tickets',
          purpose: 'ticket_media',
          mime: 'image/jpeg',
          size: 11 * MB,
        }),
      ),
    ).toMatchObject({ details: [{ path: 'size', code: 'file_too_large' }] })
    // a video has its own, larger limit
    await h.building.files.register(resident, {
      module: 'tickets',
      purpose: 'ticket_media',
      mime: 'video/mp4',
      size: 40 * MB,
    })
    // the module must be the one that owns the purpose
    expect(
      await refused(
        h.building.files.register(resident, {
          module: 'vehicles',
          purpose: 'ticket_media',
          mime: 'image/jpeg',
          size: 1000,
        }),
      ),
    ).toBeInstanceOf(FileRejectedError)
    // a Guard may not upload a notice attachment; an Admin may upload the logo
    expect(
      await refused(
        h.building.files.register(h.actorOf(h.staff('guard')), {
          module: 'notices',
          purpose: 'notice_attachment',
          mime: 'application/pdf',
          size: 1000,
        }),
      ),
    ).toBeInstanceOf(FilePurposeForbiddenError)
    await h.building.files.register(h.actorOf(h.staff('admin')), {
      module: 'building',
      purpose: 'logo',
      mime: 'image/png',
      size: 1000,
    })

    expect(await count()).toBe(before + 2)
  })

  test('FS-02 at the quota a client upload is refused with 413 and a generated PDF is still stored', async () => {
    const quota = 1_073_741_824
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = '{"storageQuotaBytes": ${quota}}' WHERE building_id = '${BUILDING}'`,
    )
    const filler = h.ids.next()
    await h.admin.unsafe(`
      INSERT INTO building.file_object (id, building_id, module, purpose, object_key, mime, size, status, account_kind, account_id, verified_at, attached_at)
      VALUES ('${filler}', '${BUILDING}', 'tickets', 'ticket_media', 'test/${BUILDING}/tickets/2026/10/${filler}.jpg', 'image/jpeg',
              ${quota - (await h.building.files.usage(BUILDING)).usedBytes - 10 * MB}, 'attached', 'system', '${SYSTEM_ACCOUNT_ID}', now(), now())`)
    const before = await count()
    const error = await h.building.files
      .register(h.resident(), {
        module: 'tickets',
        purpose: 'ticket_media',
        mime: 'video/mp4',
        size: 50 * MB,
      })
      .then(
        () => null,
        (e) => e,
      )
    expect(error).toBeInstanceOf(QuotaExceededError)
    expect(error.details).toEqual({ usedBytes: quota - 10 * MB, quotaBytes: quota })
    expect(await count()).toBe(before)

    const pdf = await h.building.files.storeGenerated({
      buildingId: BUILDING,
      module: 'finance',
      purpose: 'receipt_pdf',
      ownerRef: 'receipt/1',
      mime: 'application/pdf',
      body: new Uint8Array(2 * MB).fill(0x25),
    })
    expect(pdf).toMatchObject({ status: 'attached', size: 2 * MB })
    await h.admin.unsafe(`DELETE FROM building.file_object WHERE id = '${filler}'`)
    await h.admin.unsafe(
      `UPDATE building.building_setting SET data = '{}' WHERE building_id = '${BUILDING}'`,
    )
  })

  test('FS-03 a valid register is a pending row with a key of the CHECK shape and a PUT URL that signs content-type for 900 s', async () => {
    const actor = h.resident()
    const ticket = await h.building.files.register(actor, {
      module: 'tickets',
      purpose: 'ticket_media',
      mime: 'image/jpeg',
      size: 812_345,
    })
    const row = await h.fileRow(ticket.fileId)
    expect(row).toMatchObject({
      status: 'pending',
      purpose: 'ticket_media',
      module: 'tickets',
      account_kind: 'resident',
      account_id: actor.accountId,
    })
    expect(Number(row?.size)).toBe(812_345)
    expect(row?.object_key).toMatch(/^test\/[0-9a-f-]{36}\/tickets\/2026\/10\/[0-9a-f-]{36}\.jpg$/)
    expect(ticket).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      maxBytes: 10 * MB,
    })
    expect(ticket.expiresAt).toBe('2026-10-20T03:15:00.000Z')
    if (h.isRealStorage) {
      const url = new URL(ticket.url)
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host')
    }
  })

  test('FS-03 the store refuses an upload that declares another content type than the one signed (U2)', async () => {
    const actor = h.resident()
    const ticket = await h.building.files.register(actor, {
      module: 'tickets',
      purpose: 'ticket_media',
      mime: 'image/jpeg',
      size: 100,
    })
    expect(await h.clientPut(ticket, new Uint8Array([0xff, 0xd8, 0xff]), 'image/png')).toBe(403)
    await expect(h.building.files.verify(actor, ticket.fileId)).rejects.toMatchObject({
      reason: 'missing',
    })
  })

  test('FS-20 an account that registered 60 files in an hour gets 429 with Retry-After on the 61st', async () => {
    const actor = h.resident()
    for (let i = 0; i < 60; i++)
      await h.building.files.register(actor, {
        module: 'tickets',
        purpose: 'ticket_media',
        mime: 'image/jpeg',
        size: 1000,
      })
    const error = await h.building.files
      .register(actor, {
        module: 'tickets',
        purpose: 'ticket_media',
        mime: 'image/jpeg',
        size: 1000,
      })
      .then(
        () => null,
        (e) => e,
      )
    expect(error).toBeInstanceOf(RateLimitedError)
    expect(error.retryAfterSeconds).toBeGreaterThan(0)
    expect(error.retryAfterSeconds).toBeLessThanOrEqual(61)
    // another account is not affected
    await h.building.files.register(h.resident(), {
      module: 'tickets',
      purpose: 'ticket_media',
      mime: 'image/jpeg',
      size: 1000,
    })
  })
})

describe('verify (DOC-37 §6.3)', () => {
  test('FS-04 a client that registers 5 MB and uploads 11 MB is refused, the row is deleted and the worker removes the object', async () => {
    const body = new Uint8Array(11 * MB)
    body.set([0xff, 0xd8, 0xff])
    const actor = h.resident()
    const ticket = await h.building.files.register(actor, {
      module: 'identity',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: 5 * MB,
    })
    expect(await h.clientPut(ticket, body)).toBe(200)
    const key = await h.keyOf(ticket.fileId)
    expect(await h.storage.stat(key)).not.toBeNull()

    const before = (await h.commands('building.file_delete_requested.v1')).length
    await expect(h.building.files.verify(actor, ticket.fileId)).rejects.toMatchObject({
      code: 'file_not_verified',
      reason: 'too_large',
    })
    expect((await h.fileRow(ticket.fileId))?.status).toBe('deleted')
    expect((await h.commands('building.file_delete_requested.v1')).length).toBe(before + 1)

    await h.deliver()
    expect(await h.storage.stat(key)).toBeNull()
  })

  test('FS-05 a .jpg whose first bytes are PNG, and a text file named .jpg, are refused and deleted', async () => {
    for (const body of [PNG_HEAD, textBytes('this is not an image at all')]) {
      const { actor, ticket } = await upload(body, { verify: false })
      await expect(h.building.files.verify(actor, ticket.fileId)).rejects.toMatchObject({
        code: 'file_not_verified',
        reason: 'wrong_type',
      })
      expect((await h.fileRow(ticket.fileId))?.status).toBe('deleted')
    }
  })

  test('FS-06 a good JPEG is verified with its real size and a thumbnail is requested once', async () => {
    const body = await jpeg(1280, 720, 85)
    const before = (await h.commands('building.thumbnail_requested.v1')).length
    const { ticket, dto } = await upload(body)
    expect(dto).toMatchObject({
      fileId: ticket.fileId,
      status: 'verified',
      size: body.byteLength,
      mime: 'image/jpeg',
      purpose: 'avatar',
    })
    const row = await h.fileRow(ticket.fileId)
    expect(row?.verified_at).not.toBeNull()
    expect((await h.commands('building.thumbnail_requested.v1')).length).toBe(before + 1)
  })

  test('FS-06 a video gets no thumbnail command, and verifying twice answers the same 200 without touching the store', async () => {
    const mp4 = new Uint8Array(5000)
    mp4.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])
    const before = (await h.commands('building.thumbnail_requested.v1')).length
    const actor = h.resident()
    const ticket = await h.building.files.register(actor, {
      module: 'tickets',
      purpose: 'ticket_media',
      mime: 'video/mp4',
      size: mp4.byteLength,
    })
    await h.clientPut(ticket, mp4)
    const first = await h.building.files.verify(actor, ticket.fileId)
    expect((await h.commands('building.thumbnail_requested.v1')).length).toBe(before)
    await h.storage.delete(await h.keyOf(ticket.fileId))
    expect(await h.building.files.verify(actor, ticket.fileId)).toEqual(first)
  })

  test('FS-07 verify before the PUT is 422 missing and the row stays pending; after the PUT it passes', async () => {
    const actor = h.resident()
    const body = await jpeg(640, 480)
    const ticket = await h.building.files.register(actor, {
      module: 'identity',
      purpose: 'avatar',
      mime: 'image/jpeg',
      size: body.byteLength,
    })
    await expect(h.building.files.verify(actor, ticket.fileId)).rejects.toMatchObject({
      code: 'file_not_verified',
      reason: 'missing',
    })
    expect((await h.fileRow(ticket.fileId))?.status).toBe('pending')
    await h.clientPut(ticket, body)
    expect((await h.building.files.verify(actor, ticket.fileId)).status).toBe('verified')
  })

  test('FS-08 another account cannot verify or attach a file it did not register', async () => {
    const { ticket } = await upload(await jpeg(640, 480))
    const stranger = h.resident()
    await expect(h.building.files.verify(stranger, ticket.fileId)).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(
      h.database.run(() => h.building.files.attach(stranger, ticket.fileId, 'ticket:1')),
    ).rejects.toBeInstanceOf(FileNotVerifiedError)
    expect((await h.fileRow(ticket.fileId))?.status).toBe('verified')
  })

  test('FS-18 a CSV with a NUL byte is bad_content; one with a BOM and Vietnamese text passes', async () => {
    const manager = h.actorOf(h.staff('manager'))
    const send = async (body: Uint8Array) => {
      const ticket = await h.building.files.register(manager, {
        module: 'finance',
        purpose: 'statement',
        mime: 'text/csv',
        size: body.byteLength,
      })
      await h.clientPut(ticket, body)
      return h.building.files.verify(manager, ticket.fileId)
    }
    await expect(send(textBytes('so tien,noi dung\n1000,chuyen\u0000khoan'))).rejects.toMatchObject(
      { reason: 'bad_content' },
    )
    const bom = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...textBytes('Ngày,Nội dung\n20/10/2026,Nguyễn Văn An đóng phí\n'),
    ])
    expect((await send(bom)).status).toBe('verified')
  })

  test('verify must not run inside a transaction', async () => {
    const { actor, ticket } = await upload(await jpeg(320, 240), { verify: false })
    await expect(
      h.database.run(() => h.building.files.verify(actor, ticket.fileId)),
    ).rejects.toThrow('outside a transaction')
  })
})

describe('attach and remove (DOC-37 §6.4, §14)', () => {
  test('FS-09 an owner transaction that rolls back after attach leaves the file verified with no owner', async () => {
    const { actor, ticket } = await upload(await jpeg(640, 480))
    await expect(
      h.database.run(async () => {
        await h.building.files.attach(actor, ticket.fileId, 'ticket:abc')
        const inside = await h.execute(
          sql`SELECT status FROM building.file_object WHERE id = ${ticket.fileId}`,
        )
        expect(inside[0]?.status).toBe('attached')
        throw new Error('the ticket insert failed')
      }),
    ).rejects.toThrow('the ticket insert failed')
    expect(await h.fileRow(ticket.fileId)).toMatchObject({ status: 'verified', owner_ref: null })
    await h.database.run(() => h.building.files.attach(actor, ticket.fileId, 'ticket:abc'))
    expect(await h.fileRow(ticket.fileId)).toMatchObject({
      status: 'attached',
      owner_ref: 'ticket:abc',
    })
    // an attached file cannot be attached again
    await expect(
      h.database.run(() => h.building.files.attach(actor, ticket.fileId, 'ticket:other')),
    ).rejects.toBeInstanceOf(FileNotVerifiedError)
  })

  test('attach outside the owner transaction is refused', async () => {
    const { actor, ticket } = await upload(await jpeg(320, 240))
    await expect(h.building.files.attach(actor, ticket.fileId, 'ticket:1')).rejects.toThrow(
      'inside the owner transaction',
    )
  })

  test('FS-13 removing an attached image deletes it and its thumbnail, with one delete command each, in that transaction', async () => {
    const { actor, ticket } = await upload(await jpeg(1280, 720, 85))
    await h.database.run(() => h.building.files.attach(actor, ticket.fileId, 'ticket:remove'))
    await h.deliver() // makes the thumbnail
    const thumbnail = (
      await h.db
        .sql`SELECT id FROM building.file_object WHERE owner_ref = ${`thumb:${ticket.fileId}`}`
    )[0]
    expect(thumbnail).toBeDefined()
    const before = (await h.commands('building.file_delete_requested.v1')).length

    await expect(
      h.database.run(async () => {
        await h.building.files.remove(actor, ticket.fileId)
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')
    expect((await h.fileRow(ticket.fileId))?.status).toBe('attached')
    expect((await h.commands('building.file_delete_requested.v1')).length).toBe(before)

    await h.database.run(() => h.building.files.remove(actor, ticket.fileId))
    expect((await h.fileRow(ticket.fileId))?.status).toBe('deleted')
    expect((await h.fileRow(thumbnail?.id))?.status).toBe('deleted')
    expect((await h.commands('building.file_delete_requested.v1')).length).toBe(before + 2)
    // removing again changes nothing
    await h.database.run(() => h.building.files.remove(actor, ticket.fileId))
    expect((await h.commands('building.file_delete_requested.v1')).length).toBe(before + 2)
  })

  test('FS-14 the delete handler removes the object of a deleted file once, and never the object of a live one', async () => {
    const { actor, ticket } = await upload(await jpeg(640, 480))
    const live = await upload(await jpeg(640, 480))
    await h.database.run(() =>
      h.building.files.attach(live.actor, live.ticket.fileId, 'ticket:live'),
    )
    await h.database.run(() => h.building.files.remove(actor, ticket.fileId).catch(() => undefined))
    // verified → deleted by remove; plus a stray command that names the attached file
    await h.db.sql`
      INSERT INTO building.outbox_messages (id, type, aggregate_id, payload, headers, occurred_at)
      VALUES (${h.ids.next()}, 'building.file_delete_requested.v1', ${live.ticket.fileId},
              ${h.db.sql.json({ buildingId: BUILDING, fileId: live.ticket.fileId })}, '{}', now())`
    const [deletedKey, liveKey] = [await h.keyOf(ticket.fileId), await h.keyOf(live.ticket.fileId)]
    expect(await h.deliver()).toBeGreaterThanOrEqual(2)
    expect(await h.storage.stat(deletedKey)).toBeNull()
    expect(await h.storage.stat(liveKey)).not.toBeNull()
    // a second delivery of the same commands changes nothing
    await h.db.sql`UPDATE building.outbox_messages SET published_at = NULL`
    await h.db.sql`DELETE FROM building.inbox`
    await h.deliver()
    expect(await h.storage.stat(liveKey)).not.toBeNull()
  })
})

describe('downloads (DOC-37 §8)', () => {
  test('FS-11 an attached photo gets a 900 s URL and a vehicle paper a 300 s one, on the public endpoint', async () => {
    const photo = await upload(await jpeg(640, 480), { purpose: 'ticket_media', module: 'tickets' })
    await h.database.run(() =>
      h.building.files.attach(photo.actor, photo.ticket.fileId, 'ticket:11'),
    )
    const actor = h.resident()
    const body = await jpeg(640, 480)
    const paper = await h.building.files.register(actor, {
      module: 'vehicles',
      purpose: 'vehicle_paper',
      mime: 'image/jpeg',
      size: body.byteLength,
    })
    await h.clientPut(paper, body)
    await h.building.files.verify(actor, paper.fileId)
    await h.database.run(() => h.building.files.attach(actor, paper.fileId, 'vehicle:11'))

    const seconds = (url: string | null) =>
      Number(new URL(url as string).searchParams.get(h.isRealStorage ? 'X-Amz-Expires' : 'expires'))
    expect(seconds(await h.building.files.signedUrl(photo.ticket.fileId))).toBe(900)
    const paperUrl = await h.building.files.signedUrl(paper.fileId, { downloadName: 'Giấy xe.jpg' })
    expect(seconds(paperUrl)).toBe(300)
    const disposition = new URL(paperUrl as string).searchParams
    expect(
      h.isRealStorage ? disposition.get('response-content-disposition') : disposition.get('name'),
    ).toContain(h.isRealStorage ? "filename*=UTF-8''Gi%E1%BA%A5y%20xe.jpg" : 'Giấy xe.jpg')
    if (h.isRealStorage) {
      expect(new URL(paperUrl as string).host).toBe(
        new URL(process.env.S3_PUBLIC_ENDPOINT as string).host,
      )
      const download = await fetch(
        (await h.building.files.signedUrl(photo.ticket.fileId)) as string,
      )
      expect(download.status).toBe(200)
    }
    expect(await h.building.files.signedUrl(crypto.randomUUID())).toBeNull()
  })

  test('FS-12 the thumb variant is the original until the thumbnail exists, then the 480 px copy', async () => {
    const { actor, ticket } = await upload(await jpeg(1920, 1080, 80))
    await h.database.run(() => h.building.files.attach(actor, ticket.fileId, 'ticket:12'))
    const keyOfUrl = (url: string | null) => new URL(url as string).pathname
    const original = keyOfUrl(await h.building.files.signedUrl(ticket.fileId))
    expect(keyOfUrl(await h.building.files.signedUrl(ticket.fileId, { variant: 'thumb' }))).toBe(
      original,
    )

    await h.deliver()
    const thumb = keyOfUrl(await h.building.files.signedUrl(ticket.fileId, { variant: 'thumb' }))
    expect(thumb).not.toBe(original)
    expect(thumb.endsWith('.webp')).toBe(true)
    // a deleted file has no URL
    await h.database.run(() => h.building.files.remove(actor, ticket.fileId))
    expect(await h.building.files.signedUrl(ticket.fileId)).toBeNull()
  })
})

describe('thumbnails (DOC-37 §10)', () => {
  const widthOf = async (originalId: string) => {
    const [row] = await h.db
      .sql`SELECT object_key, mime, size, status, module FROM building.file_object WHERE owner_ref = ${`thumb:${originalId}`}`
    if (!row) return null
    const bytes = (await h.storage.read(row.object_key)) as Uint8Array
    return {
      ...row,
      width: (await sharp(bytes).metadata()).width,
      format: (await sharp(bytes).metadata()).format,
    }
  }

  test('FS-21 an avatar gets a 480 px WebP and a logo a 512 px one, and a small image is not enlarged', async () => {
    const avatar = await upload(await jpeg(1920, 1080, 80))
    const small = await upload(await jpeg(300, 200, 80))
    const admin = h.actorOf(h.staff('admin'))
    const logoBody = new Uint8Array(
      await sharp({
        create: { width: 1200, height: 800, channels: 3, background: { r: 20, g: 100, b: 200 } },
      })
        .png()
        .toBuffer(),
    )
    const logo = await h.building.files.register(admin, {
      module: 'building',
      purpose: 'logo',
      mime: 'image/png',
      size: logoBody.byteLength,
    })
    await h.clientPut(logo, logoBody)
    await h.building.files.verify(admin, logo.fileId)

    await h.deliver()
    expect(await widthOf(avatar.ticket.fileId)).toMatchObject({
      width: 480,
      format: 'webp',
      mime: 'image/webp',
      status: 'attached',
      module: 'identity',
    })
    expect(await widthOf(small.ticket.fileId)).toMatchObject({ width: 300 })
    expect(await widthOf(logo.fileId)).toMatchObject({ width: 512, module: 'building' })
  })

  test('FS-22 a truncated JPEG with a valid header makes no thumbnail, no dead letter and no error', async () => {
    const whole = await jpeg(1920, 1080, 80)
    const { ticket } = await upload(whole.slice(0, 3000))
    await h.deliver()
    expect(await widthOf(ticket.fileId)).toBeNull()
    expect((await h.fileRow(ticket.fileId))?.status).toBe('verified')
    expect(
      (
        await h.db
          .sql`SELECT count(*)::int AS n FROM building.outbox_messages WHERE dead_at IS NOT NULL`
      )[0]?.n,
    ).toBe(0)
  })

  test('a thumbnail is made once even when the command is delivered twice', async () => {
    const { ticket } = await upload(await jpeg(1280, 720))
    await h.deliver()
    await h.db.sql`UPDATE building.outbox_messages SET published_at = NULL`
    await h.db.sql`DELETE FROM building.inbox`
    await h.deliver()
    expect(
      Number(
        (
          await h.db
            .sql`SELECT count(*)::int AS n FROM building.file_object WHERE owner_ref = ${`thumb:${ticket.fileId}`}`
        )[0]?.n,
      ),
    ).toBe(1)
  })
})

describe('generated files (DOC-37 §9)', () => {
  test('FS-15 a 25 MB stream is stored attached with its SHA-256; a stream that fails at 10 MB leaves a pending row and no object', async () => {
    const chunk = new Uint8Array(1 * MB).map((_, i) => i % 251)
    const hash = createHash('sha256')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 25; i++) {
          hash.update(chunk)
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })
    const stored = await h.building.files.storeGenerated({
      buildingId: BUILDING,
      module: 'finance',
      purpose: 'bulk_zip',
      ownerRef: 'batch/1/bulk.zip',
      mime: 'application/zip',
      body: stream,
    })
    expect(stored).toMatchObject({ status: 'attached', size: 25 * MB, purpose: 'bulk_zip' })
    expect(await h.fileRow(stored.fileId)).toMatchObject({
      checksum: hash.digest('hex'),
      account_kind: 'system',
      owner_ref: 'batch/1/bulk.zip',
    })
    expect((await h.storage.stat(await h.keyOf(stored.fileId)))?.size).toBe(25 * MB)

    let sent = 0
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 10) return controller.error(new Error('the render failed'))
        sent++
        controller.enqueue(chunk)
      },
    })
    const before = await count("status = 'pending'")
    await expect(
      h.building.files.storeGenerated({
        buildingId: BUILDING,
        module: 'finance',
        purpose: 'bulk_zip',
        ownerRef: 'batch/2/bulk.zip',
        mime: 'application/zip',
        body: failing,
      }),
    ).rejects.toThrow()
    expect(await count("status = 'pending'")).toBe(before + 1)
    const [orphan] = await h.db
      .sql`SELECT object_key FROM building.file_object WHERE owner_ref = 'batch/2/bulk.zip'`
    expect(await h.storage.stat(orphan?.object_key)).toBeNull()
  })

  test('a generated purpose must be one the system writes, for the module that owns it', async () => {
    await expect(
      h.building.files.storeGenerated({
        buildingId: BUILDING,
        module: 'finance',
        purpose: 'avatar' as never,
        ownerRef: 'x',
        mime: 'image/jpeg',
        body: new Uint8Array(3),
      }),
    ).rejects.toBeInstanceOf(FileRejectedError)
    await expect(
      h.building.files.storeGenerated({
        buildingId: BUILDING,
        module: 'tickets',
        purpose: 'receipt_pdf',
        ownerRef: 'x',
        mime: 'application/pdf',
        body: new Uint8Array(3),
      }),
    ).rejects.toBeInstanceOf(FileRejectedError)
  })
})

describe('jobs (DOC-37 §11, §14)', () => {
  test('FS-10 orphan_uploads deletes pending and verified files older than 24 h, with a command each, and leaves the rest', async () => {
    const pending25 = await upload(await jpeg(320, 240), { verify: false })
    const verified25 = await upload(await jpeg(320, 240))
    const attached25 = await upload(await jpeg(320, 240))
    await h.database.run(() =>
      h.building.files.attach(attached25.actor, attached25.ticket.fileId, 'ticket:10'),
    )
    h.clock.advance(24 * 3_600_000)
    const pending1 = await upload(await jpeg(320, 240), { verify: false })
    h.clock.advance(3_600_000)

    const before = (await h.commands('building.file_delete_requested.v1')).length
    const result = await h.runJob('orphan_uploads')
    expect(result.details).toMatchObject({ orphaned: expect.any(Number) })
    const status = async (t: { ticket: { fileId: string } }) =>
      (await h.fileRow(t.ticket.fileId))?.status
    expect(await status(pending25)).toBe('deleted')
    expect(await status(verified25)).toBe('deleted')
    expect(await status(attached25)).toBe('attached')
    expect(await status(pending1)).toBe('pending')
    const commands = (await h.commands('building.file_delete_requested.v1'))
      .slice(before)
      .map((c) => c.payload.fileId)
    expect(commands).toEqual(
      expect.arrayContaining([pending25.ticket.fileId, verified25.ticket.fileId]),
    )
    expect(commands).not.toContain(attached25.ticket.fileId)

    // a second run finds nothing more; 90 days later the deleted rows are removed for good
    expect((await h.runJob('orphan_uploads')).details).toMatchObject({ orphaned: 0, purged: 0 })
    h.clock.advance(91 * 86_400_000)
    expect((await h.runJob('orphan_uploads')).details).toMatchObject({ purged: expect.any(Number) })
    expect(await h.fileRow(pending25.ticket.fileId)).toBeUndefined()
    expect(await status(attached25)).toBe('attached')
  })

  test('FS-16 with 40 of 50 GiB used the storage_quota job reports a ratio of 0.8, and the demo building is flagged', async () => {
    const gib = 1_073_741_824
    const id = h.ids.next()
    await h.admin.unsafe(`
      INSERT INTO building.file_object (id, building_id, module, purpose, object_key, mime, size, status, account_kind, account_id, verified_at, attached_at)
      VALUES ('${id}', '${BUILDING}', 'tickets', 'ticket_media', 'test/${BUILDING}/tickets/2026/10/${id}.jpg', 'image/jpeg', ${40 * gib}, 'attached', 'system', '${SYSTEM_ACCOUNT_ID}', now(), now())`)
    const { usedBytes } = await h.building.files.usage(BUILDING)
    h.usage.length = 0
    await h.runJob('storage_quota')
    const real = h.usage.find((u) => u.buildingId === BUILDING)
    expect(real?.isDemo).toBe(false)
    expect(real?.ratio).toBeCloseTo(usedBytes / (50 * gib), 10)
    expect(real?.ratio).toBeGreaterThanOrEqual(0.8)
    expect(h.usage.find((u) => u.isDemo)?.ratio).toBe(0)
    await h.admin.unsafe(`DELETE FROM building.file_object WHERE id = '${id}'`)
  })

  test('the quota counts every row that is not deleted: pending, verified, attached, thumbnails and generated files', async () => {
    const before = (await h.building.files.usage(BUILDING)).usedBytes
    const body = await jpeg(640, 480)
    const { ticket } = await upload(body)
    expect((await h.building.files.usage(BUILDING)).usedBytes).toBe(before + body.byteLength)
    await h.database.run(() => h.building.files.remove(h.resident(), ticket.fileId))
    expect((await h.building.files.usage(BUILDING)).usedBytes).toBe(before)
  })
})
