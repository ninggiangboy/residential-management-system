import { afterAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Log } from '@core/kernel'
import type { LocalDate } from '@rms/shared-types'
import { recordingMetrics } from '@rms/test-support'
import {
  type FeeNoticeInput,
  PdfRenderFailure,
  type ReceiptInput,
} from '../../application/pdf-renderer'
import { HostPdfRenderer } from './host-pdf-renderer'

/** The tiny templates module the host loads (DOC-34 §2, §4.1): a real child process, and `receipt` throws (DOC-34 §10). */
const TEMPLATES = join(import.meta.dir, 'host-pdf-renderer.fixture.tsx')

/** A log that goes nowhere, the shape the module tests use (DOC-42 §8). */
const logger: Log = { info() {}, warn() {}, error() {} }

/** What the module reported (DOC-40 §4.3, DOC-34 §14). */
const metrics = recordingMetrics()

/** DOC-34 §4: a worker pool of one host, so the adapter has no wait and no idle exit. */
const renderer = new HostPdfRenderer({
  role: 'worker',
  size: 1,
  metrics,
  logger,
  templatesModule: TEMPLATES,
})

afterAll(async () => {
  await renderer.close()
})

/** A fee notice with no line: the fixture ignores the input and prints a fixed page. */
const NOTICE: FeeNoticeInput = {
  kind: 'fee_notice',
  language: 'vi',
  draft: false,
  building: {
    name: { vi: 'Chung cư Sunrise' },
    company: { name: { vi: 'Công ty Quản lý' }, address: null },
    address: '12 Nguyễn Huệ',
    hotline: null,
    email: null,
    workingHours: null,
    logo: null,
  },
  gatewayActive: false,
  unit: { code: 'A-1508', ownerName: null },
  batch: {
    code: 'PH-2610-01',
    name: { vi: 'Phí tháng 10/2026' },
    feeMonth: '2026-10-01',
    dueDate: '2026-10-15' as LocalDate,
    issueDate: '2026-10-01' as LocalDate,
  },
  lines: [],
  total: 0,
}

/** A receipt: the fixture's `receipt` template throws, so the render fails (DOC-34 §10). */
const RECEIPT: ReceiptInput = {
  kind: 'receipt',
  language: 'vi',
  number: 'BL-2610-0153',
  issuedAt: '2026-10-09T02:12:42Z',
  paidAt: '2026-10-09T02:12:41Z',
  payer: { name: null, memberType: null },
  unit: { code: 'A-1508' },
  batch: { code: 'PH-2610-01', name: { vi: 'Phí tháng 10/2026' }, feeMonth: '2026-10-01' },
  items: [],
  amount: 0,
  method: 'cash',
  reference: null,
  building: { name: { vi: 'Chung cư Sunrise' } },
  company: { name: { vi: 'Công ty Quản lý' }, address: null, hotline: null },
  logo: null,
  void: null,
}

describe('HostPdfRenderer (DOC-34 §4, §10, §14, DR-291)', () => {
  test('renders a document as PDF bytes', async () => {
    const bytes = await renderer.render(NOTICE)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
  }, 30_000)

  test('maps a throwing template to PdfRenderFailure(render_failed) (DOC-34 §10)', async () => {
    const rejection = await renderer.render(RECEIPT).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(rejection).toBeInstanceOf(PdfRenderFailure)
    if (!(rejection instanceof PdfRenderFailure)) throw new Error('not a render failure')
    expect(rejection.code).toBe('render_failed')
  }, 30_000)

  test('reports pdf_renders_total and pdf_render_duration_seconds (DOC-34 §14)', async () => {
    await renderer.render(NOTICE)
    expect(
      metrics.count('pdf_renders_total', { document: 'fee_notice', outcome: 'rendered' }),
    ).toBeGreaterThan(0)
    expect(
      metrics.observations('pdf_render_duration_seconds', { document: 'fee_notice' }).length,
    ).toBeGreaterThan(0)
  }, 30_000)

  test('close() resolves (DOC-34 §4.1)', async () => {
    await expect(renderer.close()).resolves.toBeUndefined()
  })
})
