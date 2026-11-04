import { join } from 'node:path'
import type { Log } from '@core/kernel'
import {
  createRenderHostPool,
  PdfRenderError,
  type RenderHostObserver,
  type RenderHostPool,
  type RenderOutcome,
  type RenderRestartReason,
} from '@rms/pdf-assets'
import type { MetricsPort } from '@rms/shared-types'
import { type PdfInput, type PdfRenderer, PdfRenderFailure } from '../../application/pdf-renderer'

/**
 * `HostPdfRenderer` is the `PdfRenderer` port of DOC-34 §2 over the render-host pool of DOC-34 §4 (DR-291): the
 * application asks for one document's bytes, a pool of child processes renders it, and this adapter reports what the
 * pool did (DOC-34 §14) and maps its failures onto the port's own codes (DOC-34 §10). It never renders in-process.
 */

/** DOC-34 §4.2: in `api` a request waits at most 10 s for a free host, then the route answers 503 `service_unavailable` (DR-291). */
const API_WAIT_TIMEOUT_MS = 10_000
/** DOC-34 §4.1: an `api` host exits after 60 s with no work, so a rare download never keeps a host's memory alive (DR-291). */
const API_IDLE_EXIT_MS = 60_000

/** The four document kinds of DOC-34 §1: the closed set of the `document` label (DOC-34 §13, §14; observability §4.8). */
export type PdfDocumentKind = 'fee_notice' | 'receipt' | 'report' | 'wiki_page'

/** The kind the pool reported, narrowed to the label's closed set; only these four are ever rendered (DOC-34 §14). */
function isDocumentKind(kind: string): kind is PdfDocumentKind {
  return kind === 'fee_notice' || kind === 'receipt' || kind === 'report' || kind === 'wiki_page'
}

/** The `Log` of a process plus the optional `debug` level of DOC-34 §14 (pino's `Logger` has it; a test's fake may not). */
type RendererLogger = Log & { debug?(fields: object, message: string): void }

export interface HostPdfRendererOptions {
  /** Which pool this process owns: `api` (rare inline renders) or `worker` (the bulk run and the receipt handler). */
  role: 'api' | 'worker'
  /** The role's concurrency (DOC-34 §13): `PDF_INLINE_CONCURRENCY` for `api`, `PDF_CONCURRENCY` for `worker`. */
  size: number
  /** `PDF_RENDERER_MAX_DOCUMENTS`; the pool's default (150) when unset. */
  maxDocuments?: number
  /** `PDF_RENDERER_MAX_RSS_MB`; the pool's default (400) when unset. */
  maxRssMb?: number
  metrics: MetricsPort
  logger: Log
  /** The templates module the host loads (DOC-34 §2): `./templates.ts` by default, a test's fixture otherwise. */
  templatesModule?: string
}

/** The `PdfRenderer` port of DOC-34 §2 over the render-host pool of DOC-34 §4 (DR-291). */
export class HostPdfRenderer implements PdfRenderer, RenderHostObserver {
  private readonly metrics: MetricsPort
  private readonly logger: RendererLogger
  private readonly pool: RenderHostPool

  constructor(options: HostPdfRendererOptions) {
    this.metrics = options.metrics
    this.logger = options.logger
    this.pool = createRenderHostPool({
      templatesModule: options.templatesModule ?? join(import.meta.dir, 'templates.ts'),
      size: options.size,
      maxDocuments: options.maxDocuments,
      maxRssMb: options.maxRssMb,
      observer: this,
      onLog: (event, fields) => this.onLog(event, fields),
      // DOC-34 §4.2: an `api` request waits at most 10 s, then the route answers 503; a worker waits without a limit.
      waitTimeoutMs: options.role === 'api' ? API_WAIT_TIMEOUT_MS : undefined,
      // DOC-34 §4.1: an `api` host exits after 60 s idle; a worker host stays for the whole bulk run.
      idleExitMs: options.role === 'api' ? API_IDLE_EXIT_MS : undefined,
    })
  }

  async render(input: PdfInput): Promise<Uint8Array> {
    const startedAt = performance.now()
    try {
      const bytes = await this.pool.render(input.kind, input)
      // DOC-34 §14: `pdf.rendered` is a `debug` line and holds no name and no amount.
      this.logger.debug?.(
        {
          event: 'pdf.rendered',
          document: input.kind,
          ms: Math.round(performance.now() - startedAt),
          bytes: bytes.length,
        },
        'pdf rendered',
      )
      return bytes
    } catch (error) {
      if (!(error instanceof PdfRenderError)) throw error
      // DOC-34 §10: the pool's codes are the port's codes; the bytes never existed, so nothing is swallowed.
      this.logger.error(
        { event: 'pdf.failed', document: input.kind, reason: error.code },
        'pdf render failed',
      )
      throw new PdfRenderFailure(error.code, error.message)
    }
  }

  /** DOC-34 §14: one `pdf_renders_total` and one `pdf_render_duration_seconds` per request that reached a host. */
  rendered(kind: string, outcome: RenderOutcome, seconds: number): void {
    if (!isDocumentKind(kind)) return
    this.metrics.inc('pdf_renders_total', { document: kind, outcome })
    this.metrics.observe('pdf_render_duration_seconds', seconds, { document: kind })
  }

  /** DOC-34 §14: an idle exit is not a restart; the other reasons are what `pdf_renderer_restarts_total` counts. */
  restarted(reason: RenderRestartReason): void {
    if (reason === 'idle') return
    this.metrics.inc('pdf_renderer_restarts_total', { reason })
  }

  /** DOC-34 §4.1: stops the pool and its hosts. */
  close(): Promise<void> {
    return this.pool.close()
  }

  /** DOC-34 §14: the pool's own events a reader needs, as structured fields (DOC-42 §8). */
  private onLog(event: string, fields: Record<string, unknown>): void {
    if (event === 'pdf.host_retire') {
      if (fields.reason === 'close') return
      this.logger.info(
        { event: 'pdf.host_recycled', reason: fields.reason },
        'render host recycled',
      )
      return
    }
    if (event === 'pdf.busy') {
      this.logger.warn({ event: 'pdf.busy', document: fields.kind }, 'render host pool busy')
    }
  }
}
