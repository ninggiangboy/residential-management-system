import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import ExcelJS from 'exceljs'
import { containerFor } from './support'

/**
 * The `fee_batch` kind of `/staff/imports` over HTTP (DR-149, DOC-21 §4.1): `residency` owns the routes and hands the kind to
 * `finance` through its `ImportHandler`; the units come from the real `ResidencyApi.findUnitsByCodes`. The rules and the commit
 * are proved in `modules/finance/test/fee-import.integration.test.ts` (IM-50…77); here the template, the dispatch, the rendered
 * messages, a second "Save", the history and the building scope.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000011'
const OTHER_BUILDING = '018f0000-0000-7000-8000-000000000012'
const PASSWORD = 'Sunrise2026!'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const HEADER = ['Mã căn hộ', 'Tháng phí', 'Tên khoản', 'Số lượng', 'Đơn giá', 'Thành tiền']

let db: TestDb
let app: ReturnType<typeof containerFor>['app']
let close: () => Promise<void>
const storage = new FakeStorage()
let manager: string
let strangerManager: string
let managerId: string

const call = (path: string, init: RequestInit & { token?: string; json?: unknown } = {}) => {
  const { token, json, headers, ...rest } = init
  return app.handle(
    new Request(`http://localhost/api/v1${path}`, {
      ...rest,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(rest.method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    }),
  )
}

async function signIn(email: string): Promise<string> {
  const res = await call('/auth/staff/login', {
    method: 'POST',
    json: { email, password: PASSWORD, client: 'app' },
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { accessToken: string }).accessToken
}

async function workbook(
  rows: readonly (readonly unknown[])[],
  header = HEADER,
): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Phí')
  for (const row of [header, ...rows]) sheet.addRow([...row])
  return new Uint8Array(await book.xlsx.writeBuffer())
}

/** E-36, the `PUT`, E-37 for the module `finance`. */
async function upload(token: string, body: Uint8Array): Promise<string> {
  const registered = await call('/staff/uploads', {
    method: 'POST',
    token,
    json: { purpose: 'import', module: 'finance', mime: XLSX, size: body.byteLength },
  })
  expect(registered.status).toBe(201)
  const ticket = (await registered.json()) as { fileId: string; url: string }
  await storage.write(new URL(ticket.url).pathname.replace(/^\/put\//, ''), body, XLSX)
  expect(
    (await call(`/staff/uploads/${ticket.fileId}/verify`, { method: 'POST', token })).status,
  ).toBe(200)
  return ticket.fileId
}

async function seedUnit(code: string, withOwner: boolean) {
  const unitId = crypto.randomUUID()
  await db.sql`INSERT INTO residency.unit (id, building_id, code, floor, occupancy)
               VALUES (${unitId}, ${BUILDING}, ${code}, 15, 'occupied')`
  if (withOwner)
    await db.sql`
      INSERT INTO residency.membership (id, building_id, account_id, unit_id, member_type, can_pay, status, credential_version,
                                        added_by_kind, added_by)
      VALUES (${crypto.randomUUID()}, ${BUILDING}, ${crypto.randomUUID()}, ${unitId}, 'owner', true, 'active', 1, 'staff',
              ${crypto.randomUUID()})`
}

async function seedBatch(buildingId: string, code: string) {
  const id = crypto.randomUUID()
  await db.sql`
    INSERT INTO finance.fee_batch (id, building_id, code, name, fee_month, due_date, created_by)
    VALUES (${id}, ${buildingId}, ${code}, '{"vi":"Phí tháng 10/2026"}'::jsonb, '2026-10-01', '2026-10-15', ${crypto.randomUUID()})`
  return id
}

const validate = (token: string, fileId: string, batchId: string, lang = 'vi') =>
  call('/staff/imports', {
    method: 'POST',
    token,
    headers: { 'accept-language': lang },
    json: { kind: 'fee_batch', fileId, params: { batchId } },
  })

const rows = [
  ['A-1508', '10/2026', 'Phí quản lý', 1, 2_488_000, 2_488_000],
  ['a-1508', '10/2026', 'Nước', '12,345', 15_000, 185_175],
  ['A-1509', '10/2026', 'Phí quản lý', 1, 2_488_000, ''],
  ['A-9999', '10/2026', 'Phí quản lý', 1, 2_488_000, ''],
  ['A-1510', '10/2026', 'Phí quản lý', 1, 2_488_000, ''],
]

beforeAll(async () => {
  db = await cloneTemplate('empty')
  for (const [id, code] of [
    [BUILDING, 'SUNRISE-F'],
    [OTHER_BUILDING, 'SUNRISE-G'],
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
  managerId = crypto.randomUUID()
  await db.sql`
    INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
    VALUES (${managerId}, ${BUILDING}, 'manager@fees.example', 'Lê Văn Quản', 'manager', 'active', ${hash}, 'en'),
           (gen_random_uuid(), ${OTHER_BUILDING}, 'manager@other-fees.example', 'Quản Lý G', 'manager', 'active', ${hash}, 'en')`
  await seedUnit('A-1508', true)
  await seedUnit('A-1509', true)
  await seedUnit('A-1510', false)
  const built = containerFor(db.url, { storage })
  app = built.app
  close = () => built.container.close()
  manager = await signIn('manager@fees.example')
  strangerManager = await signIn('manager@other-fees.example')
})
afterAll(async () => {
  await close()
  await db.drop()
})

describe('the fee template (E-71, DOC-18 §2.1)', () => {
  test('sheet Phí or Fees, the header in the request language, one example row per kind', async () => {
    const vi = await call('/staff/imports/templates/fee_batch', { token: manager })
    expect(vi.status).toBe(200)
    expect(vi.headers.get('content-disposition')).toBe(
      'attachment; filename="fee-batch-template-vi.xlsx"',
    )
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await vi.arrayBuffer())
    const sheet = book.worksheets[0]
    expect(sheet?.name).toBe('Phí')
    expect(sheet?.getRow(1).getCell(1).value).toBe('Mã căn hộ')
    expect(sheet?.getRow(3).getCell(8).value).toBe('điều chỉnh')
    const en = await call('/staff/imports/templates/fee_batch', {
      token: manager,
      headers: { 'accept-language': 'en' },
    })
    await book.xlsx.load(await en.arrayBuffer())
    expect([book.worksheets[0]?.name, book.worksheets[0]?.getRow(1).getCell(2).value]).toEqual([
      'Fees',
      'Fee month',
    ])
  })
})

describe('validate, read, commit and list a fee file (E-72, E-73, E-74, E-169)', () => {
  test('one route for two kinds: the fee preview with messages in English, then commit twice with one answer', async () => {
    const batchId = await seedBatch(BUILDING, 'PH-2610-01')
    const fileId = await upload(manager, await workbook(rows))
    const res = await validate(manager, fileId, batchId, 'en')
    expect(res.status).toBe(201)
    const job = (await res.json()) as {
      importId: string
      kind: string
      status: string
      params: { batchId: string }
      preview: {
        counts: Record<string, number>
        issues: { row: number; column: string; code: string; message: string }[]
      }
    }
    expect(res.headers.get('location')).toBe(`/api/v1/staff/imports/${job.importId}`)
    expect([job.kind, job.status, job.params.batchId]).toEqual(['fee_batch', 'validated', batchId])
    expect(job.preview.counts).toMatchObject({ rows: 5, valid: 3, errors: 2, charges: 2, lines: 3 })
    expect(job.preview.issues.map((issue) => [issue.row, issue.code, issue.message])).toEqual([
      [5, 'unit_not_found', 'There is no unit A-9999 in this building.'],
      [
        6,
        'unit_without_owner',
        'Unit A-1510 has no owner, so nobody could be notified of the fee.',
      ],
    ])

    const read = await call(`/staff/imports/${job.importId}`, { token: manager })
    expect(read.status).toBe(200)
    expect(((await read.json()) as { kind: string }).kind).toBe('fee_batch')
    expect((await call(`/staff/imports/${job.importId}`, { token: strangerManager })).status).toBe(
      404,
    )
    expect(
      (
        await call(`/staff/imports/${job.importId}/commit`, {
          method: 'POST',
          token: strangerManager,
        })
      ).status,
    ).toBe(404)

    const first = await call(`/staff/imports/${job.importId}/commit`, {
      method: 'POST',
      token: manager,
    })
    expect(first.status).toBe(200)
    const body = await first.json()
    expect(body).toMatchObject({
      importId: job.importId,
      status: 'committed',
      committed: { created: 2, replaced: 0 },
    })
    const second = await call(`/staff/imports/${job.importId}/commit`, {
      method: 'POST',
      token: manager,
    })
    expect(await second.json()).toEqual(body)
    const [charges] =
      await db.sql`SELECT count(*)::int AS n FROM finance.charge WHERE batch_id = ${batchId}`
    expect(charges?.n).toBe(2)

    const list = await call('/staff/imports?kind=fee_batch', { token: manager })
    expect(list.status).toBe(200)
    const page = (await list.json()) as {
      items: { importId: string; kind: string; createdBy: unknown }[]
    }
    expect(page.items.map((item) => [item.importId, item.kind])).toEqual([
      [job.importId, 'fee_batch'],
    ])
    expect(page.items[0]?.createdBy).toEqual({ staffId: managerId, name: 'Lê Văn Quản' })
    expect((await call('/staff/imports?kind=fee_batch', { token: strangerManager })).status).toBe(
      200,
    )
  })

  test('IM-88 a file without the required columns is a failed job; the message names them as headers; commit is 409', async () => {
    const batchId = await seedBatch(BUILDING, 'PH-2610-02')
    const fileId = await upload(
      manager,
      await workbook([['A-1508', 1]], ['Mã căn hộ', 'Thành tiền']),
    )
    const job = (await (await validate(manager, fileId, batchId)).json()) as {
      importId: string
      status: string
      preview: { issues: { code: string; message: string }[] }
    }
    expect(job.status).toBe('failed')
    expect(job.preview.issues).toMatchObject([
      {
        code: 'import_missing_column',
        message: 'Thiếu cột bắt buộc: Tháng phí, Tên khoản. Hãy dùng tệp mẫu.',
      },
    ])
    const commit = await call(`/staff/imports/${job.importId}/commit`, {
      method: 'POST',
      token: manager,
    })
    expect(commit.status).toBe(409)
    expect(((await commit.json()) as { error: { code: string } }).error.code).toBe(
      'import_not_ready',
    )
  })

  test('IM-64 another building’s batch is 404 and no batch is 400 required', async () => {
    const theirs = await seedBatch(OTHER_BUILDING, 'PH-2610-01')
    const fileId = await upload(manager, await workbook(rows))
    expect((await validate(manager, fileId, theirs)).status).toBe(404)
    const missing = await call('/staff/imports', {
      method: 'POST',
      token: manager,
      json: { kind: 'fee_batch', fileId },
    })
    expect(missing.status).toBe(400)
  })
})
