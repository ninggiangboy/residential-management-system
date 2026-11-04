import type { FilesApi } from '@mod/building/contracts'
import { type MetricsPort, NO_METRICS } from '@rms/shared-types'
import {
  type FeeNoticeContext,
  type FeeNoticeSource,
  feeNoticeHash,
  feeNoticeKey,
  toFeeNoticeInput,
} from './fee-notice-input'
import type { LogoSource } from './logo-source'
import type { PdfLanguage, PdfRenderer } from './pdf-renderer'
import { systemFileActor } from './system-file-actor'

/**
 * The fee-notice cache of DOC-34 §8.1 (DR-293), shared by `RenderFeeNoticePdf` (E-176) and the bulk job
 * `fee_notice_run` (E-99, §9.2 phase 1): the hash of §8.1 names the file, a hit is read (only when the caller wants
 * the bytes) and a miss renders and stores once. A draft is never cached (§6.3, PD-06); the caller renders it through
 * `render`.
 */

/** The files the cache touches (DOC-37 §3): find a cached PDF, read it, and store a fresh one. */
type FeeNoticeFiles = Pick<FilesApi, 'read' | 'storeGenerated' | 'findByOwnerRef'>

/** What a `get` found (PD-17): the file and, only when asked, its bytes. */
export interface CachedFeeNotice {
  /** `true` when an unchanged notice was found under its key and no render happened (PD-17). */
  readonly cached: boolean
  readonly fileId: string
  readonly bytes: Uint8Array | null
}

/** The cache of the fee-notice PDFs (DR-293); `files`, `logo`, `renderer` and `metrics` are the constructor's. */
export class FeeNoticeCache {
  constructor(
    private readonly files: FeeNoticeFiles,
    private readonly logo: LogoSource,
    private readonly renderer: PdfRenderer,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {}

  /** §8.1: the key names the file; a hit reads it (when `wantBytes`), a miss renders and stores one (DR-293). */
  async get(
    buildingId: string,
    source: FeeNoticeSource,
    context: FeeNoticeContext,
    language: PdfLanguage,
    wantBytes: boolean,
  ): Promise<CachedFeeNotice> {
    const hash = feeNoticeHash(toFeeNoticeInput(source, context, language, null))
    const ownerRef = feeNoticeKey(source.batch.id, source.charge.unitId, language, hash)
    const cached = await this.files.findByOwnerRef(buildingId, {
      module: 'finance',
      purpose: 'fee_notice_pdf',
      ownerRef,
    })
    if (cached) {
      // A hit that avoided a render is counted here, and only here (DOC-34 §14).
      this.metrics.inc('pdf_renders_total', { document: 'fee_notice', outcome: 'cached' })
      const bytes = wantBytes
        ? await this.files.read(systemFileActor(buildingId), cached.fileId, {
            module: 'finance',
            purpose: 'fee_notice_pdf',
            ownerRef,
          })
        : null
      return { cached: true, fileId: cached.fileId, bytes }
    }
    // A miss: render and store, both outside any transaction (§8.4 for the logo).
    const rendered = await this.render(buildingId, source, context, language)
    const stored = await this.files.storeGenerated({
      buildingId,
      module: 'finance',
      purpose: 'fee_notice_pdf',
      ownerRef,
      mime: 'application/pdf',
      body: rendered,
    })
    return { cached: false, fileId: stored.fileId, bytes: rendered }
  }

  /** Read the logo (§8.4) and render one notice (DOC-34 §2); neither touches a transaction. A draft uses this. */
  async render(
    buildingId: string,
    source: FeeNoticeSource,
    context: FeeNoticeContext,
    language: PdfLanguage,
  ): Promise<Uint8Array> {
    const logo = await this.logo.load(buildingId, context.building.logoFile)
    return this.renderer.render(toFeeNoticeInput(source, context, language, logo))
  }
}
