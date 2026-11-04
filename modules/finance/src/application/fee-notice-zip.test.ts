import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { buildFeeNoticeZip, type FeeNoticeZipEntry } from './fee-notice-zip'

/**
 * The streaming ZIP of the bulk fee notices (DOC-34 §9.2 phase 2, DR-294; PD-34, PD-38): the stored entries, the
 * manifest last with its BOM, a failed unit left out of the archive and `unzip -t` over a temp file. No database.
 */

/** One unit the test feeds the builder. */
interface Unit {
  readonly unitCode: string
  readonly read: () => Promise<Uint8Array | null>
}

const encoder = new TextEncoder()
const pdf = (unit: string): Uint8Array => encoder.encode(`%PDF-${unit}`)

/** The units as the async iterable the builder reads (DOC-34 §9.2 phase 2). */
function source(units: readonly Unit[]): AsyncIterable<FeeNoticeZipEntry> {
  return (async function* () {
    for (const unit of units) yield unit
  })()
}

/** Drains the stream into one buffer. */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of stream) {
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** The end-of-central-directory offset of an archive with no comment. */
function eocd(view: DataView): number {
  for (let offset = view.byteLength - 22; offset >= 0; offset -= 1)
    if (view.getUint32(offset, true) === 0x06054b50) return offset
  throw new Error('no end-of-central-directory record')
}

/** The central-directory entries: name and compression method (0 = stored), PD-38. */
function centralEntries(data: Uint8Array): Array<{ name: string; method: number }> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const start = eocd(view)
  const count = view.getUint16(start + 10, true)
  let offset = view.getUint32(start + 16, true)
  const entries: Array<{ name: string; method: number }> = []
  for (let index = 0; index < count; index += 1) {
    const method = view.getUint16(offset + 10, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength))
    entries.push({ name, method })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const unzip = Bun.which('unzip')
if (!unzip)
  console.log('fee-notice-zip.test: `unzip` is not on PATH, skipping the `unzip -t` check')

describe('buildFeeNoticeZip (DOC-34 §9.2 phase 2, DR-294; PD-34, PD-38)', () => {
  test('PD-38 the entries are stored (method 0), the manifest is last with a BOM, and a failed unit is left out', async () => {
    const units: Unit[] = [
      { unitCode: 'A-1510', read: async () => pdf('A-1510') },
      { unitCode: 'A-1508', read: async () => pdf('A-1508') },
      { unitCode: 'A-1509', read: async () => null },
      {
        unitCode: 'A-1511',
        read: async () => {
          throw new Error('render failed')
        },
      },
      { unitCode: 'B,2000', read: async () => pdf('B,2000') },
      { unitCode: 'C/1', read: async () => pdf('C_1') },
    ]
    const { stream, result } = buildFeeNoticeZip({ folder: 'PH-2610-01', entries: source(units) })
    const bytes = await collect(stream)
    const outcome = await result

    expect(outcome.ok).toEqual(['A-1510', 'A-1508', 'B,2000', 'C/1'])
    expect(outcome.failed).toEqual(['A-1509', 'A-1511'])

    const entries = centralEntries(bytes)
    expect(entries.map((entry) => entry.method)).toEqual([0, 0, 0, 0, 0])
    expect(entries.map((entry) => entry.name)).toEqual([
      'PH-2610-01/A-1510.pdf',
      'PH-2610-01/A-1508.pdf',
      'PH-2610-01/B,2000.pdf',
      'PH-2610-01/C_1.pdf',
      'PH-2610-01/manifest.csv',
    ])

    const files = unzipSync(bytes)
    expect(files['PH-2610-01/A-1509.pdf']).toBeUndefined()
    expect(new TextDecoder().decode(files['PH-2610-01/A-1510.pdf'] ?? new Uint8Array())).toBe(
      '%PDF-A-1510',
    )

    const manifest = files['PH-2610-01/manifest.csv']
    if (!manifest) throw new Error('the archive holds no manifest')
    expect([...manifest.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(manifest.subarray(3))).toBe(
      'unit_code,file,status\n' +
        'A-1508,A-1508.pdf,ok\n' +
        'A-1509,,failed\n' +
        'A-1510,A-1510.pdf,ok\n' +
        'A-1511,,failed\n' +
        '"B,2000","B,2000.pdf",ok\n' +
        'C/1,C_1.pdf,ok\n',
    )
  })

  test('PD-34 a null or a throwing read is listed failed and kept out of the archive', async () => {
    const units: Unit[] = [
      {
        unitCode: 'A-1508',
        read: async () => {
          throw new Error('render failed')
        },
      },
      { unitCode: 'A-1509', read: async () => null },
    ]
    const { stream, result } = buildFeeNoticeZip({ folder: 'PH-2610-01', entries: source(units) })
    const bytes = await collect(stream)
    expect(await result).toEqual({ ok: [], failed: ['A-1508', 'A-1509'] })
    expect(centralEntries(bytes).map((entry) => entry.name)).toEqual(['PH-2610-01/manifest.csv'])
  })

  test('the PDFs are read one at a time as the consumer pulls (back-pressure)', async () => {
    const reads: string[] = []
    const unit = (code: string): Unit => ({
      unitCode: code,
      read: async () => {
        reads.push(code)
        return pdf(code)
      },
    })
    const { stream, result } = buildFeeNoticeZip({
      folder: 'PH-2610-01',
      entries: source([unit('A-1508'), unit('A-1509'), unit('A-1510')]),
    })
    const reader = stream.getReader()
    await reader.read()
    expect(reads).toEqual(['A-1508'])
    await reader.read()
    expect(reads).toEqual(['A-1508'])
    while (!(await reader.read()).done) {}
    expect(reads).toEqual(['A-1508', 'A-1509', 'A-1510'])
    expect(await result).toEqual({ ok: ['A-1508', 'A-1509', 'A-1510'], failed: [] })
  })

  test.skipIf(!unzip)('PD-38 the archive passes `unzip -t`', async () => {
    const units: Unit[] = [
      { unitCode: 'A-1508', read: async () => pdf('A-1508') },
      { unitCode: 'A-1509', read: async () => pdf('A-1509') },
    ]
    const { stream } = buildFeeNoticeZip({ folder: 'PH-2610-01', entries: source(units) })
    const bytes = await collect(stream)
    const dir = mkdtempSync(join(tmpdir(), 'fee-notice-zip-'))
    const path = join(dir, 'PH-2610-01.zip')
    writeFileSync(path, bytes)
    try {
      const check = Bun.spawnSync(['unzip', '-t', path])
      expect(check.exitCode).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
