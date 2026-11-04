/**
 * The render-throughput spike of P2-13's first step (DOC-34 §15, DR-56, DR-320; EXP-08 case C and D without the job):
 * renders N bilingual fee notices of 60 lines through the real render host pool and the real template, and prints
 * the wall time and the peak memory of this process plus its render hosts. It is NOT the EXP-08 run: that one goes through
 * `POST …/pdf` and the job on the staging host (DOC-97). Usage:
 *   bun scripts/pdf-spike.ts [--units 240] [--hosts 1] [--lines 60] [--language both] [--max-documents 150] [--max-rss-mb 400] [--json out.json]
 */
import { join } from 'node:path'
import { createRenderHostPool } from '@rms/pdf-assets'
import type { LocalDate } from '@rms/shared-types'
import type {
  FeeNoticeInput,
  PdfChargeLine,
  PdfLanguage,
} from '../modules/finance/src/application/pdf-renderer'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '')
const num = (key: string, fallback: number) => Number(args.get(key) ?? fallback)

const units = num('units', 240)
const hosts = num('hosts', 1)
const lineCount = num('lines', 60)
const language = (args.get('language') ?? 'both') as PdfLanguage
const maxDocuments = num('max-documents', 150)
const maxRssMb = num('max-rss-mb', 400)
const jsonOut = args.get('json')

const NAMES = [
  'Nguyễn Thị Ánh Nguyệt',
  'Trần Minh Anh',
  'Lê Hoàng Phương',
  'Phạm Đức Thắng',
  'Đặng Thị Hương Giang',
]

function lines(seed: number): PdfChargeLine[] {
  return Array.from({ length: lineCount }, (_, at) => {
    const adjustment = at % 30 === 29
    const unitPrice = adjustment ? 0 : 12000 + ((seed + at) % 7) * 1000
    const quantity = adjustment ? '1' : String(1 + ((seed + at) % 90))
    return {
      position: at + 1,
      itemName: { vi: `Khoản phí số ${at + 1}`, en: `Fee item ${at + 1}` },
      quantity,
      unitPrice,
      amount: adjustment ? -35175 : unitPrice * Number(quantity),
      kind: adjustment ? 'adjustment' : 'normal',
      note: adjustment ? 'Trừ phí nước tính thừa tháng 9' : null,
    } satisfies PdfChargeLine
  })
}

function notice(index: number): FeeNoticeInput {
  const items = lines(index)
  return {
    kind: 'fee_notice',
    language,
    draft: false,
    building: {
      name: { vi: 'Chung cư Sunrise A', en: 'Sunrise A Apartments' },
      company: {
        name: {
          vi: 'Công ty TNHH Quản lý Tòa nhà Sunrise',
          en: 'Sunrise Building Management Co., Ltd.',
        },
        address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
      },
      address: '12 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh',
      hotline: '1900 1234',
      email: 'bql@sunrise.vn',
      workingHours: { vi: 'Thứ 2 – Thứ 6, 8:00 – 17:00', en: 'Mon – Fri, 8:00 – 17:00' },
      logo: null,
    },
    gatewayActive: true,
    unit: { code: `A-${1000 + index}`, ownerName: NAMES[index % NAMES.length]! },
    batch: {
      code: 'PH-2610-01',
      name: { vi: 'Phí tháng 10/2026', en: 'October 2026 fees' },
      feeMonth: '2026-10',
      dueDate: '2026-10-15' as LocalDate,
      issueDate: '2026-10-01' as LocalDate,
    },
    lines: items,
    total: items.reduce((sum, line) => sum + line.amount, 0),
  }
}

/** RSS in MiB of this process plus every child of it (the render hosts), read with `ps`. */
async function treeRssMib(): Promise<number> {
  const out = await new Response(
    Bun.spawn(['ps', '-A', '-o', 'pid=,ppid=,rss='], { stdout: 'pipe' }).stdout,
  ).text()
  let kib = 0
  for (const row of out.trim().split('\n')) {
    const [pid, ppid, rss] = row.trim().split(/\s+/).map(Number)
    if (pid === process.pid || ppid === process.pid) kib += rss ?? 0
  }
  return kib / 1024
}

const pool = createRenderHostPool({
  templatesModule: join(import.meta.dir, '../modules/finance/src/infrastructure/pdf/templates.ts'),
  size: hosts,
  maxDocuments,
  maxRssMb,
  observer: {
    rendered: () => undefined,
    restarted: (reason) => {
      if (reason !== 'idle') restarts[reason] = (restarts[reason] ?? 0) + 1
    },
  },
})
const restarts: Record<string, number> = {}

let peak = 0
const sampler = setInterval(async () => {
  peak = Math.max(peak, await treeRssMib())
}, 500)

const started = performance.now()
let bytes = 0
let failed = 0
let next = 0
await Promise.all(
  Array.from({ length: hosts }, async () => {
    while (next < units) {
      const index = next++
      try {
        bytes += (await pool.render('fee_notice', notice(index))).byteLength
      } catch {
        failed++
      }
    }
  }),
)
const seconds = (performance.now() - started) / 1000
peak = Math.max(peak, await treeRssMib())
clearInterval(sampler)
await pool.close()

const result = {
  bun: Bun.version,
  units,
  hosts,
  lines: lineCount,
  language,
  maxDocuments,
  maxRssMb,
  seconds: Number(seconds.toFixed(1)),
  perDocumentMs: Number(((seconds * 1000) / units).toFixed(0)),
  peakTreeRssMib: Number(peak.toFixed(0)),
  averageBytes: Math.round(bytes / Math.max(1, units - failed)),
  failed,
  restarts,
}
console.log(JSON.stringify(result, null, 2))
if (jsonOut) await Bun.write(jsonOut, `${JSON.stringify(result, null, 2)}\n`)
