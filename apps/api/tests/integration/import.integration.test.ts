import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import ExcelJS from 'exceljs'
import { containerFor } from './support'

/**
 * The import routes over HTTP (DOC-51 E-71…E-74, E-169): the staff guard in front of each, the upload flow of E-36 and E-37
 * that precedes E-72, the rendered messages, the cursor and the building scope. The rules and the commit are proved against
 * PostgreSQL in `modules/residency/test` (IM-). Here: IM-30 over the route, IM-41, IM-42, IM-43.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000001'
const OTHER_BUILDING = '018f0000-0000-7000-8000-000000000002'
const PASSWORD = 'Sunrise2026!'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const HEADER = [
  'Mã căn hộ',
  'Tầng',
  'Số phòng ngủ',
  'Diện tích (m²)',
  'Tình trạng',
  'Họ tên chủ hộ',
  'SĐT chủ hộ',
]

let db: TestDb
let app: ReturnType<typeof containerFor>['app']
let close: () => Promise<void>
const storage = new FakeStorage()
let manager: string
let admin: string
let technician: string
let guard: string
let strangerManager: string

const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
  const { token, json, headers, ...rest } = init
  return app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; details?: unknown } }).error

async function signIn(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'app' },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { accessToken: string }).accessToken
}

async function workbook(rows: readonly (readonly unknown[])[]): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Căn hộ')
  for (const row of [HEADER, ...rows]) sheet.addRow([...row])
  return new Uint8Array(await book.xlsx.writeBuffer())
}

/** E-36, the `PUT` to the bucket, E-37: what the browser does before `POST /staff/imports`. */
async function upload(token: string, body: Uint8Array, verify = true): Promise<string> {
  const registered = await call('/staff/uploads', {
    method: 'POST',
    token,
    json: { purpose: 'import', module: 'residency', mime: XLSX, size: body.byteLength },
  })
  expect(registered.status).toBe(201)
  const ticket = (await registered.json()) as { fileId: string; url: string }
  await storage.write(new URL(ticket.url).pathname.replace(/^\/put\//, ''), body, XLSX)
  if (verify) {
    const verified = await call(`/staff/uploads/${ticket.fileId}/verify`, { method: 'POST', token })
    expect(verified.status).toBe(200)
  }
  return ticket.fileId
}

const create = (token: string, fileId: string, headers: Record<string, string> = {}) =>
  call('/staff/imports', { method: 'POST', token, headers, json: { kind: 'unit_owner', fileId } })

const phone = (i: number) => `0903${String(i).padStart(6, '0')}`

beforeAll(async () => {
  db = await cloneTemplate('empty')
  for (const [id, code] of [
    [BUILDING, 'SUNRISE-A'],
    [OTHER_BUILDING, 'SUNRISE-B'],
  ] as const) {
    await db.sql`
      INSERT INTO building.building (id, code, name, company, address, hotline, is_demo)
      VALUES (${id}, ${code}, '{"vi":"Chung cư","en":"Apartments"}',
              '{"name":{"vi":"Công ty"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234', false)`
    await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${id})`
  }
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  const staff: ReadonlyArray<readonly [string, string, string, string]> = [
    ['admin@sunrise.example', 'admin', 'Phạm Thu Hà', BUILDING],
    ['manager@sunrise.example', 'manager', 'Lê Văn Quản', BUILDING],
    ['tech@sunrise.example', 'technician', 'Trần Kỹ Thuật', BUILDING],
    ['guard@sunrise.example', 'guard', 'Võ Bảo Vệ', BUILDING],
    ['manager@other.example', 'manager', 'Quản Lý B', OTHER_BUILDING],
  ]
  for (const [email, role, name, building] of staff)
    await db.sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (gen_random_uuid(), ${building}, ${email}, ${name}, ${role}, 'active', ${hash}, 'en')`
  const built = containerFor(db.url, { storage })
  app = built.app
  close = () => built.container.close()
  admin = await signIn('admin@sunrise.example')
  manager = await signIn('manager@sunrise.example')
  technician = await signIn('tech@sunrise.example')
  guard = await signIn('guard@sunrise.example')
  strangerManager = await signIn('manager@other.example')
})
afterAll(async () => {
  await close()
  await db.drop()
})

describe('IM-41 the guard of every route', () => {
  test('no token is 401; a Technician and a Guard are 403', async () => {
    const id = '0192f3c4-c001-7000-8000-000000000b01'
    for (const [method, path] of [
      ['GET', '/staff/imports/templates/unit_owner'],
      ['POST', '/staff/imports'],
      ['GET', '/staff/imports'],
      ['GET', `/staff/imports/${id}`],
      ['POST', `/staff/imports/${id}/commit`],
    ] as const) {
      expect((await call(path, { method })).status).toBe(401)
      for (const token of [technician, guard])
        expect(
          (await call(path, { method, token, json: method === 'POST' ? {} : undefined })).status,
        ).toBe(403)
    }
  })
})

describe('the template (E-71)', () => {
  test('a workbook in the language of the request, never cached', async () => {
    const vi = await call('/staff/imports/templates/unit_owner', { token: manager })
    expect(vi.status).toBe(200)
    expect(vi.headers.get('content-type')).toBe(XLSX)
    expect(vi.headers.get('content-disposition')).toBe(
      'attachment; filename="unit-owner-template-vi.xlsx"',
    )
    expect(vi.headers.get('cache-control')).toBe('no-store')
    const en = await call('/staff/imports/templates/unit_owner', {
      token: admin,
      headers: { 'accept-language': 'en' },
    })
    expect(en.headers.get('content-disposition')).toContain('unit-owner-template-en.xlsx')
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await en.arrayBuffer())
    expect(book.worksheets[0]?.name).toBe('Units')
    expect(book.worksheets[0]?.getRow(1).getCell(1).value).toBe('Unit code')
  })

  test('an unknown kind, and the fee template that finance owns, are 404', async () => {
    for (const kind of ['nothing', 'fee_batch'])
      expect((await call(`/staff/imports/templates/${kind}`, { token: manager })).status).toBe(404)
  })
})

describe('validate, read and commit (E-72, E-73, E-74)', () => {
  const rows = (prefix: string) => [
    [`${prefix}-1`, 3, 2, '68,5', 'occupied', 'Nguyễn Văn An', phone(1)],
    [`${prefix}-2`, '', '', '', '', 'Lê Thị Cúc', phone(2)],
    [`${prefix}-3`, '', '', '', '', 'Phạm Dung', 'not a phone'],
    [`${prefix}-1`, '', '', '', '', '', ''],
  ]

  test('E-72 answers 201 with Location and the preview, messages in the language of the request', async () => {
    const fileId = await upload(manager, await workbook(rows('V1')))
    const res = await create(manager, fileId, { 'accept-language': 'en' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      importId: string
      status: string
      expiresAt: string
      createdAt: string
      preview: {
        counts: Record<string, number>
        validRows: { notes: { code: string; message: string; params: unknown }[] }[]
        issues: { code: string; message: string; unitCode: string | null; params: unknown }[]
      }
    }
    expect(res.headers.get('location')).toBe(`/api/v1/staff/imports/${body.importId}`)
    expect(body.status).toBe('validated')
    expect(body.preview.counts).toMatchObject({
      rows: 4,
      valid: 2,
      errors: 2,
      unitsToCreate: 2,
      ownersToAdd: 2,
    })
    expect(body.preview.validRows[0]?.notes[0]).toEqual({
      code: 'unit_will_create',
      params: { code: 'V1-1' },
      message: 'Unit V1-1 will be created.',
    })
    expect(body.preview.issues.map((issue) => [issue.code, issue.unitCode, issue.message])).toEqual(
      [
        ['phone_invalid', 'V1-3', 'This phone number is not valid.'],
        ['unit_code_duplicate', 'V1-1', 'Unit V1-1 already appears in row 2.'],
      ],
    )
    const vietnamese = await call(`/staff/imports/${body.importId}`, { token: manager })
    const again = (await vietnamese.json()) as typeof body
    expect(again.preview.issues[0]?.message).toBe('Số điện thoại không hợp lệ.')
  })

  test('the body refuses an unknown key, an unknown kind and the kind finance owns', async () => {
    const fileId = await upload(manager, await workbook(rows('V2')))
    const post = (json: unknown) => call('/staff/imports', { method: 'POST', token: manager, json })
    expect((await post({ kind: 'unit_owner', fileId, extra: 1 })).status).toBe(400)
    expect((await post({ kind: 'nothing', fileId })).status).toBe(400)
    expect((await post({ kind: 'unit_owner' })).status).toBe(400)
    expect((await post({ kind: 'unit_owner', fileId, params: { batchId: 'x' } })).status).toBe(400)
    expect((await post({ kind: 'fee_batch', fileId })).status).toBe(400)
  })

  test('a file that is not verified is 422, one of another account is 404', async () => {
    const pending = await upload(manager, await workbook(rows('V3')), false)
    const res = await create(manager, pending)
    expect(res.status).toBe(422)
    expect((await errorOf(res)).code).toBe('file_not_verified')
    const mine = await upload(manager, await workbook(rows('V3')))
    expect((await create(admin, mine)).status).toBe(404)
    expect((await create(manager, crypto.randomUUID())).status).toBe(404)
  })

  test('IM-05 more than 5,000 rows is 400 too_many_rows and stores no job', async () => {
    const before = (await db.sql`SELECT count(*)::int AS n FROM residency.import_job`)[0]?.n
    const many = Array.from({ length: 5001 }, (_, i) => [`W-${i}`])
    const fileId = await upload(manager, await workbook(many))
    const res = await create(manager, fileId)
    expect(res.status).toBe(400)
    const error = await errorOf(res)
    expect(error.code).toBe('validation_failed')
    expect(JSON.stringify(error.details)).toContain('too_many_rows')
    expect((await db.sql`SELECT count(*)::int AS n FROM residency.import_job`)[0]?.n).toBe(before)
  })

  test('IM-33 the commit answers 200, and a second press answers the same body', async () => {
    const fileId = await upload(manager, await workbook(rows('V4')))
    const created = (await (await create(manager, fileId)).json()) as { importId: string }
    const first = await call(`/staff/imports/${created.importId}/commit`, {
      method: 'POST',
      token: manager,
    })
    expect(first.status).toBe(200)
    const body = (await first.json()) as { status: string; committed: Record<string, number> }
    expect(body.status).toBe('committed')
    expect(body.committed).toEqual({
      unitsCreated: 2,
      unitsUpdated: 0,
      accountsCreated: 2,
      accountsLinked: 0,
      ownersAdded: 2,
    })
    // FS-17: the upload is `deleted` in the commit transaction and its delete command exists (DR-22).
    const [file] = await db.sql`SELECT status FROM building.file_object WHERE id = ${fileId}`
    expect(file?.status).toBe('deleted')
    const commands = await db.sql`
      SELECT 1 FROM building.outbox_messages
       WHERE type = 'building.file_delete_requested.v1' AND payload->>'fileId' = ${fileId}`
    expect(commands).toHaveLength(1)
    const second = await call(`/staff/imports/${created.importId}/commit`, {
      method: 'POST',
      token: admin,
    })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual(body)
    const read = (await (
      await call(`/staff/imports/${created.importId}`, { token: manager })
    ).json()) as {
      status: string
      committed: unknown
      committedAt: string
    }
    expect(read).toMatchObject({ status: 'committed', committed: body.committed })
    expect(read.committedAt).toBe((body as unknown as { committedAt: string }).committedAt)
  })

  test('IM-36 a file without the unit-code header is a failed job and cannot be committed', async () => {
    const book = new ExcelJS.Workbook()
    book.addWorksheet('x').addRow(['Tầng'])
    const fileId = await upload(manager, new Uint8Array(await book.xlsx.writeBuffer()))
    const res = await create(manager, fileId)
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      importId: string
      status: string
      preview: { issues: { severity: string; code: string; message: string }[] }
    }
    expect(body.status).toBe('failed')
    expect(body.preview.issues[0]).toMatchObject({ severity: 'fail', code: 'import_no_header' })
    const commit = await call(`/staff/imports/${body.importId}/commit`, {
      method: 'POST',
      token: manager,
    })
    expect(commit.status).toBe(409)
    expect(await errorOf(commit)).toMatchObject({
      code: 'import_not_ready',
      details: { status: 'failed' },
    })
  })

  test('IM-43 another building cannot read or commit a job: 404', async () => {
    const fileId = await upload(manager, await workbook(rows('V5')))
    const created = (await (await create(manager, fileId)).json()) as { importId: string }
    expect(
      (await call(`/staff/imports/${created.importId}`, { token: strangerManager })).status,
    ).toBe(404)
    expect(
      (
        await call(`/staff/imports/${created.importId}/commit`, {
          method: 'POST',
          token: strangerManager,
        })
      ).status,
    ).toBe(404)
    expect((await call(`/staff/imports/${crypto.randomUUID()}`, { token: manager })).status).toBe(
      404,
    )
    expect((await call('/staff/imports/not-a-uuid', { token: manager })).status).toBe(400)
  })
})

describe('IM-42 the history (E-169)', () => {
  test('newest first, a cursor that walks to the end, the filters and the building scope', async () => {
    const created: string[] = []
    for (const prefix of ['L1', 'L2', 'L3']) {
      const fileId = await upload(admin, await workbook([[`${prefix}-1`]]))
      const res = await create(admin, fileId)
      created.push(((await res.json()) as { importId: string }).importId)
      await Bun.sleep(5)
    }
    await call(`/staff/imports/${created[0]}/commit`, { method: 'POST', token: admin })
    const page = async (query: string, token = admin) => {
      const res = await call(`/staff/imports${query}`, { token })
      expect(res.status).toBe(200)
      return (await res.json()) as {
        items: {
          importId: string
          status: string
          counts: Record<string, number>
          createdBy: { name: string | null }
        }[]
        nextCursor: string | null
      }
    }
    const all = await page('?limit=100')
    const mine = all.items.filter((item) => created.includes(item.importId))
    expect(mine.map((item) => item.importId)).toEqual([...created].reverse())

    const first = await page('?limit=2')
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).toBeString()
    const seen = [...first.items]
    let cursor = first.nextCursor
    while (cursor) {
      const next = await page(`?limit=2&cursor=${encodeURIComponent(cursor)}`)
      seen.push(...next.items)
      cursor = next.nextCursor
    }
    expect(seen.map((item) => item.importId)).toEqual(all.items.map((item) => item.importId))

    // The jobs of the tests above are in the building too: look at this test's own.
    const committed = (await page('?status=committed')).items.filter((item) =>
      created.includes(item.importId),
    )
    expect(committed.map((item) => item.importId)).toEqual([created[0] as string])
    expect(committed[0]).toMatchObject({
      counts: { rows: 1, valid: 1, errors: 0, warnings: 0 },
      createdBy: { name: 'Phạm Thu Hà' },
    })
    expect(committed[0]).not.toHaveProperty('preview')
    const validated = await page('?status=validated')
    expect(validated.items.map((item) => item.importId)).toContain(created[2] as string)
    expect(validated.items.map((item) => item.importId)).not.toContain(created[0] as string)

    expect((await page('', strangerManager)).items).toEqual([])
  })

  test('bad parameters are 400: a limit out of range, an unknown status or kind, a cursor that does not decode', async () => {
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?limit=x',
      '?status=nope',
      '?kind=fee_batch',
      '?kind=nope',
      '?other=1',
    ])
      expect((await call(`/staff/imports${query}`, { token: manager })).status).toBe(400)
    const bad = await call('/staff/imports?cursor=not-a-cursor', { token: manager })
    expect(bad.status).toBe(400)
    expect((await errorOf(bad)).code).toBe('invalid_cursor')
  })
})

describe('NFR-12 IM-30 over the route', () => {
  test('2,000 rows with 40 errors: the preview in under 10 s', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => [
      `N-${i + 1}`,
      (i % 30) + 1,
      2,
      60,
      'occupied',
      `Chủ hộ ${i + 1}`,
      i % 50 === 0 ? 'bad' : phone(10 + i),
    ])
    const fileId = await upload(manager, await workbook(rows))
    const started = performance.now()
    const res = await create(manager, fileId)
    const seconds = (performance.now() - started) / 1000
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      preview: { counts: Record<string, number>; issues: unknown[] }
    }
    expect(body.preview.counts).toMatchObject({ rows: 2000, valid: 1960, errors: 40 })
    expect(body.preview.issues).toHaveLength(40)
    expect(seconds).toBeLessThan(10)
  }, 60_000)
})
