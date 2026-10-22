import { describe, expect, test } from 'bun:test'
import { GENERATED_PURPOSES, UPLOAD_PURPOSES } from '../contracts'
import { objectKeyOf } from './object-key'
import { extensionOf, type FileLimits, maxBytesFor, PURPOSE_RULES } from './purposes'

const MB = 1_048_576
const limits: FileLimits = {
  imageBytes: 10 * MB,
  videoBytes: 50 * MB,
  attachmentBytes: 20 * MB,
  importBytes: 5 * MB,
  logoBytes: 1 * MB,
  generatedBytes: 1024 * MB,
}

describe('purposes and limits (DOC-37 §4)', () => {
  test('every purpose of the CHECK has a rule, and a rule has its mimes with an extension', () => {
    expect(Object.keys(PURPOSE_RULES).sort()).toEqual(
      [...UPLOAD_PURPOSES, ...GENERATED_PURPOSES].sort(),
    )
    for (const rule of Object.values(PURPOSE_RULES))
      for (const mime of rule.mimes) expect(extensionOf(mime)).toBeDefined()
  })

  test('FS-01 the limits of the table: 10 MB images, 50 MB video, 20 MB attachments, 5 MB imports, 1 MB logo', () => {
    expect(maxBytesFor('ticket_media', 'image/jpeg', limits)).toBe(10 * MB)
    expect(maxBytesFor('ticket_media', 'video/mp4', limits)).toBe(50 * MB)
    expect(maxBytesFor('notice_attachment', 'application/pdf', limits)).toBe(20 * MB)
    expect(maxBytesFor('import', 'x', limits)).toBe(5 * MB)
    expect(maxBytesFor('statement', 'text/csv', limits)).toBe(5 * MB)
    expect(maxBytesFor('logo', 'image/png', limits)).toBe(1 * MB)
    expect(maxBytesFor('receipt_pdf', 'application/pdf', limits)).toBe(2 * MB)
    expect(maxBytesFor('bulk_zip', 'application/zip', limits)).toBe(1024 * MB)
    // a generated file is also under the ceiling
    expect(
      maxBytesFor('bulk_zip', 'application/zip', { ...limits, generatedBytes: 100 * MB }),
    ).toBe(100 * MB)
  })

  test('only a vehicle paper has the 5-minute URL and no thumbnail; the system purposes have no client audience', () => {
    expect(
      Object.entries(PURPOSE_RULES)
        .filter(([, r]) => r.url === 'paper')
        .map(([p]) => p),
    ).toEqual(['vehicle_paper'])
    expect(PURPOSE_RULES.vehicle_paper.thumbnail).toBeNull()
    expect(PURPOSE_RULES.logo.thumbnail).toBe('logo')
    for (const purpose of GENERATED_PURPOSES) {
      expect(PURPOSE_RULES[purpose].audience).toEqual({ system: true })
    }
  })

  test('the MIME to extension map of DOC-37 §4', () => {
    expect(extensionOf('image/jpeg')).toBe('jpg')
    expect(extensionOf('video/quicktime')).toBe('mov')
    expect(extensionOf('text/csv')).toBe('csv')
    expect(
      extensionOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).toBe('docx')
    expect(extensionOf('application/x-msdownload')).toBeUndefined()
  })

  test('FS-03 the key is {env}/{building}/{module}/{yyyy}/{mm}/{id}.{ext} with UTC year and month', () => {
    const key = objectKeyOf({
      env: 'production',
      buildingId: '0192f3c4-5a1e-7000-8000-000000000001',
      module: 'tickets',
      now: new Date('2026-10-31T23:30:00-05:00'),
      fileId: '0192f3c4-9d02-7000-8000-00000000f001',
      extension: 'jpg',
    })
    expect(key).toBe(
      'production/0192f3c4-5a1e-7000-8000-000000000001/tickets/2026/11/0192f3c4-9d02-7000-8000-00000000f001.jpg',
    )
  })
})
