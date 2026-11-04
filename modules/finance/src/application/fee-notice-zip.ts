import { Zip, ZipPassThrough } from 'fflate'

/**
 * The streaming ZIP of DOC-34 §9.2 phase 2 (DR-294; PD-34, PD-38): one stored entry per unit `folder/<unitCode>.pdf`,
 * read one at a time as the consumer pulls, then a last `folder/manifest.csv` in unit-code order. Pure: no clock and
 * no I/O — the caller supplies the bytes and stores the stream (multipart, DOC-37 §9). The entry modification time is
 * a constant so the archive is reproducible.
 */

/** The fixed modification time of every entry (DOC-34 §9.2); a constant, never `new Date()`. */
const MTIME = new Date(Date.UTC(2026, 0, 1))

/** The UTF-8 BOM so Excel shows the diacritics (DOC-34 §9.2; PD-38). */
const BOM = new Uint8Array([0xef, 0xbb, 0xbf])

/** One unit's PDF to add (DOC-34 §9.2 phase 2): `read` returns the bytes; `null` or a throw means the unit failed. */
export interface FeeNoticeZipEntry {
  readonly unitCode: string
  readonly read: () => Promise<Uint8Array | null>
}

/** What the ZIP reported (PD-34): the units with a file and those left out, in the order read. */
export interface FeeNoticeZipResult {
  readonly ok: string[]
  readonly failed: string[]
}

/** The input of `buildFeeNoticeZip` (DOC-34 §9.2 phase 2). */
export interface BuildFeeNoticeZipInput {
  /** The batch code, e.g. `PH-2610-01`; every entry is `folder/unitCode.pdf` (DOC-34 §9.2). */
  readonly folder: string
  readonly entries: AsyncIterable<FeeNoticeZipEntry>
  readonly signal?: AbortSignal
}

/** The file segment of a unit: a code with `/` or `\` is replaced by `_` (DOC-34 §9.2). */
const filePart = (unitCode: string): string => `${unitCode.replace(/[/\\]/g, '_')}.pdf`

/** An RFC-4180 CSV field: quoted when it holds a comma, a quote or a newline (PD-38). */
const csvField = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/** The manifest of §9.2: `unit_code,file,status`, one row per unit in unit-code order, UTF-8 with a BOM. */
function manifest(ok: readonly string[], failed: readonly string[]): Uint8Array {
  const done = new Set(ok)
  const rows = [...ok, ...failed]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((unit) =>
      done.has(unit)
        ? `${csvField(unit)},${csvField(filePart(unit))},ok`
        : `${csvField(unit)},,failed`,
    )
  const body = new TextEncoder().encode(
    `unit_code,file,status\n${rows.map((row) => `${row}\n`).join('')}`,
  )
  const out = new Uint8Array(BOM.length + body.length)
  out.set(BOM, 0)
  out.set(body, BOM.length)
  return out
}

/**
 * Streams the ZIP (DOC-34 §9.2 phase 2): one entry per unit `folder/<unitCode>.pdf` stored, read one at a time, then
 * `folder/manifest.csv`. The stream is pull-driven, so memory holds one PDF and one chunk. `result` is the `ok` and
 * `failed` lists (PD-34); `null` from `read` or a throw leaves that unit out and lists it `failed`.
 */
export function buildFeeNoticeZip({ folder, entries, signal }: BuildFeeNoticeZipInput): {
  stream: ReadableStream<Uint8Array>
  result: Promise<FeeNoticeZipResult>
} {
  const chunks: Uint8Array[] = []
  const ok: string[] = []
  const failed: string[] = []
  const iterator = entries[Symbol.asyncIterator]()
  let failure: Error | null = null
  let done = false

  const zip = new Zip((err, chunk) => {
    if (err) {
      failure = err
      return
    }
    if (chunk) chunks.push(chunk)
  })

  let settleResult: (value: FeeNoticeZipResult) => void = () => {}
  let rejectResult: (reason: unknown) => void = () => {}
  const result = new Promise<FeeNoticeZipResult>((resolve, reject) => {
    settleResult = resolve
    rejectResult = reject
  })
  let settled = false
  const settle = (complete: () => void): void => {
    if (settled) return
    settled = true
    complete()
  }

  const addEntry = async (entry: FeeNoticeZipEntry): Promise<void> => {
    let bytes: Uint8Array | null
    try {
      bytes = await entry.read()
    } catch {
      bytes = null
    }
    if (bytes === null) {
      failed.push(entry.unitCode)
      return
    }
    const file = new ZipPassThrough(`${folder}/${filePart(entry.unitCode)}`)
    file.mtime = MTIME
    zip.add(file)
    file.push(bytes, true)
    ok.push(entry.unitCode)
  }

  const finish = (): void => {
    const file = new ZipPassThrough(`${folder}/manifest.csv`)
    file.mtime = MTIME
    zip.add(file)
    file.push(manifest(ok, failed), true)
    zip.end()
    if (failure) settle(() => rejectResult(failure))
    else settle(() => settleResult({ ok: [...ok], failed: [...failed] }))
  }

  const produce = async (): Promise<void> => {
    while (chunks.length === 0 && !done) {
      if (signal?.aborted) throw new Error('fee_notice_zip_aborted')
      const next = await iterator.next()
      if (next.done) {
        done = true
        finish()
        break
      }
      await addEntry(next.value)
      if (failure) throw failure
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await produce()
        const chunk = chunks.shift()
        if (chunk) controller.enqueue(chunk)
        else controller.close()
      } catch (error) {
        settle(() => rejectResult(error))
        controller.error(error)
      }
    },
    cancel() {
      done = true
      zip.terminate()
      settle(() => rejectResult(new Error('fee_notice_zip_cancelled')))
    },
  })

  return { stream, result }
}
