import type { Clock, Log } from '@core/kernel'
import type { FilesApi } from '@mod/building/contracts'
import { type BuildingId, type BuildingScope, buildingToday } from '@rms/shared-types'
import type { ChargeNoticeRow, ChargeRepository } from '../../domain/charge-repository'
import {
  type ClaimedJob,
  FEE_NOTICE_CHUNK,
  type FeeNoticeJobRepository,
} from '../../domain/fee-notice-job-repository'
import type { FeeNoticeCache } from '../fee-notice-cache'
import {
  type FeeNoticeContext,
  feeNoticeHash,
  feeNoticeKey,
  toFeeNoticeInput,
} from '../fee-notice-input'
import { buildFeeNoticeZip, type FeeNoticeZipEntry } from '../fee-notice-zip'
import type { BuildingCalendar, NoticeBuilding, NoticeContextSource } from '../ports'
import { systemFileActor } from '../system-file-actor'

/**
 * The work loop of `fee_notice_run` (DOC-34 §9.2; DR-294; P2-13). One `execute` per building: it gives up the exhausted
 * jobs, claims one, fills the cache in phase 1 over chunks of `FEE_NOTICE_CHUNK` (a unit that fails is retried once and
 * a second failure leaves it out — PD-34, PD-35), and streams phase 2's ZIP (PD-38). Every write is fenced by the
 * claim's `attempts`, so a worker whose lease ran out writes nothing and answers `lost_lease` (PD-24). `signal` is
 * checked between chunks: the run stops `aborted` and the next claim resumes after `cursor_charge` (PD-28). A
 * transaction never wraps a render or a bucket call (DOC-12 §8.2).
 */

/** What one `execute` did (DOC-34 §9.2): `idle` found no job; the rest name why it stopped. */
export type FeeNoticeRunOutcome = 'idle' | 'ready' | 'failed' | 'lost_lease' | 'aborted'

/** The building to work and the run's abort signal (shutdown, DOC-38 §3.4). */
export interface RunFeeNoticeJobInput {
  readonly buildingId: string
  readonly signal?: AbortSignal
}

/** The outcome and the job it applies to (`null` when `idle`). */
export interface RunFeeNoticeJobResult {
  readonly outcome: FeeNoticeRunOutcome
  readonly jobId: string | null
}

/** What phase 1 resolved: the charge ids that failed, or why it stopped before the batch ended. */
type PhaseOne =
  | { readonly outcome: 'aborted' | 'lost_lease' }
  | { readonly outcome: 'rendered'; readonly tried: number; readonly failed: ReadonlySet<string> }

/** The use case of DOC-34 §9.2 (`fee_notice_run`). One `execute` per building per tick. */
export class RunFeeNoticeJob {
  constructor(
    private readonly charges: ChargeRepository,
    private readonly jobs: FeeNoticeJobRepository,
    private readonly cache: FeeNoticeCache,
    private readonly files: Pick<FilesApi, 'read' | 'storeGenerated'>,
    private readonly noticeContext: NoticeContextSource,
    private readonly calendar: BuildingCalendar,
    private readonly clock: Clock,
    private readonly logger: Log,
    private readonly concurrency: number,
  ) {}

  async execute(input: RunFeeNoticeJobInput): Promise<RunFeeNoticeJobResult> {
    const { buildingId, signal } = input
    await this.jobs.giveUpExhausted(buildingId)
    const claim = await this.jobs.claim(buildingId)
    if (!claim) return { outcome: 'idle', jobId: null }

    const scope: BuildingScope = { buildingId: buildingId as BuildingId }
    const building = await this.noticeContext.building(buildingId)
    const timeZone = await this.calendar.timeZone(buildingId)

    const phaseOne = await this.renderPhase(scope, claim, building, timeZone, signal)
    if (phaseOne.outcome !== 'rendered') return { outcome: phaseOne.outcome, jobId: claim.id }
    // PD-35: every unit failed and at least one was tried — the job ends `failed`, with no ZIP.
    if (phaseOne.tried > 0 && phaseOne.failed.size === phaseOne.tried && claim.unitDone === 0) {
      await this.jobs.finishFailed(claim, { error: { code: 'all_units_failed' } })
      return { outcome: 'failed', jobId: claim.id }
    }
    return this.zipPhase(scope, claim, building, timeZone, signal)
  }

  /** Phase 1 (DOC-34 §9.2): read a chunk, fill the cache, save the progress; `lost_lease`/`aborted` stop it. */
  private async renderPhase(
    scope: BuildingScope,
    claim: ClaimedJob,
    building: NoticeBuilding,
    timeZone: string,
    signal: AbortSignal | undefined,
  ): Promise<PhaseOne> {
    const failed = new Set<string>()
    let cursor = claim.cursorCharge
    let unitDone = claim.unitDone
    let tried = 0
    for (;;) {
      if (signal?.aborted) return { outcome: 'aborted' }
      const chunk = await this.charges.listNoticeSources(
        scope,
        claim.batchId,
        cursor,
        FEE_NOTICE_CHUNK,
      )
      const last = chunk.at(-1)
      if (!last) return { outcome: 'rendered', tried, failed }
      const owners = await this.noticeContext.ownerNames(
        claim.buildingId,
        chunk.map((source) => source.charge.unitId),
      )
      await this.eachLimited(chunk, (source) =>
        this.renderUnit(source, claim, building, owners, timeZone, failed),
      )
      tried += chunk.length
      cursor = last.charge.id
      unitDone = Math.min(unitDone + chunk.length, claim.unitTotal)
      const saved = await this.jobs.saveProgress(claim, { unitDone, cursorCharge: cursor })
      if (!saved) return { outcome: 'lost_lease' }
    }
  }

  /** One unit: a throw is retried once at once; a second failure records the charge id and the loop goes on. */
  private async renderUnit(
    source: ChargeNoticeRow,
    claim: ClaimedJob,
    building: NoticeBuilding,
    owners: Map<string, string | null>,
    timeZone: string,
    failed: Set<string>,
  ): Promise<void> {
    const context = this.noticeContextOf(source, building, owners, timeZone)
    if (await this.renderOnce(claim, source, context)) return
    if (await this.renderOnce(claim, source, context)) return
    failed.add(source.charge.id)
    this.logger.warn(
      { buildingId: claim.buildingId, jobId: claim.id, chargeId: source.charge.id },
      'fee_notice.unit_failed',
    )
  }

  /** One cache fill of one charge (DOC-34 §8.1): `false` when the render throws. */
  private async renderOnce(
    claim: ClaimedJob,
    source: ChargeNoticeRow,
    context: FeeNoticeContext,
  ): Promise<boolean> {
    try {
      await this.cache.get(claim.buildingId, source, context, claim.language, false)
      return true
    } catch {
      return false
    }
  }

  /** The building block, the owner and the issue day of one charge (DOC-34 §6.1, DR-292): the published day. */
  private noticeContextOf(
    source: ChargeNoticeRow,
    building: NoticeBuilding,
    owners: Map<string, string | null>,
    timeZone: string,
  ): FeeNoticeContext {
    return {
      building,
      ownerName: owners.get(source.charge.unitId) ?? null,
      issueDate: buildingToday(source.batch.publishedAt ?? this.clock.now(), timeZone),
    }
  }

  /** Renders at most `concurrency` units at once (DOC-34 §9.2 step 2, `PDF_CONCURRENCY`). */
  private async eachLimited<T>(
    items: readonly T[],
    run: (item: T) => Promise<void>,
  ): Promise<void> {
    let next = 0
    const workers = Math.max(1, Math.min(this.concurrency, items.length))
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (;;) {
          const item = items[next]
          next += 1
          if (item === undefined) return
          await run(item)
        }
      }),
    )
  }

  /** Phase 2 (DOC-34 §9.2): stream the ZIP into `bulk_zip`, then finish `ready`; a lost lease leaves the file to purge. */
  private async zipPhase(
    scope: BuildingScope,
    claim: ClaimedJob,
    building: NoticeBuilding,
    timeZone: string,
    signal: AbortSignal | undefined,
  ): Promise<RunFeeNoticeJobResult> {
    const folder = await this.batchCode(scope, claim)
    const { stream, result } = buildFeeNoticeZip({
      folder,
      entries: this.zipEntries(scope, claim, building, timeZone, signal),
      signal,
    })
    // A shutdown makes the builder error its stream, which fails the store: the upload is not kept (multipart abort).
    const stored = await this.files
      .storeGenerated({
        buildingId: claim.buildingId,
        module: 'finance',
        purpose: 'bulk_zip',
        ownerRef: `batch/${claim.batchId}/zip/${claim.id}.zip`,
        mime: 'application/zip',
        body: stream,
      })
      .catch((error: unknown) => {
        if (signal?.aborted) return null
        throw error
      })
    if (stored === null) {
      result.catch(() => undefined)
      return { outcome: 'aborted', jobId: claim.id }
    }
    const zip = await result
    // A shutdown that cut the entries short must not publish a partial ZIP: the lease runs out and the next claim redoes phase 2.
    if (signal?.aborted) return { outcome: 'aborted', jobId: claim.id }
    // Every unit failed to read in phase 2: the stored file holds only the manifest, so the job fails like PD-35.
    if (zip.ok.length === 0) {
      await this.jobs.finishFailed(claim, { error: { code: 'all_units_failed' } })
      return { outcome: 'failed', jobId: claim.id }
    }
    const finished = await this.jobs.finishReady(claim, { zipFile: stored.fileId })
    if (!finished) {
      this.logger.warn({ buildingId: claim.buildingId, jobId: claim.id }, 'fee_notice.zip_orphaned')
      return { outcome: 'lost_lease', jobId: claim.id }
    }
    this.logger.info(
      {
        buildingId: claim.buildingId,
        jobId: claim.id,
        units: zip.ok.length,
        failedUnits: zip.failed.length,
      },
      'fee_notice.ready',
    )
    return { outcome: 'ready', jobId: claim.id }
  }

  /** The batch code every entry is filed under (DOC-34 §9.2). */
  private async batchCode(scope: BuildingScope, claim: ClaimedJob): Promise<string> {
    const [first] = await this.charges.listNoticeSources(scope, claim.batchId, null, 1)
    return first?.batch.code ?? claim.batchId
  }

  /** Phase 2's entries (DOC-34 §9.2): the charges re-read in id order, each read from its cached file. */
  private async *zipEntries(
    scope: BuildingScope,
    claim: ClaimedJob,
    building: NoticeBuilding,
    timeZone: string,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<FeeNoticeZipEntry> {
    let cursor: string | null = null
    for (;;) {
      if (signal?.aborted) return
      const chunk = await this.charges.listNoticeSources(
        scope,
        claim.batchId,
        cursor,
        FEE_NOTICE_CHUNK,
      )
      const last = chunk.at(-1)
      if (!last) return
      const owners = await this.noticeContext.ownerNames(
        claim.buildingId,
        chunk.map((source) => source.charge.unitId),
      )
      for (const source of chunk) {
        const context = this.noticeContextOf(source, building, owners, timeZone)
        yield {
          unitCode: source.charge.unitCode,
          read: () => this.readNotice(claim, source, context),
        }
      }
      cursor = last.charge.id
    }
  }

  /** Reads one cached notice with the system actor (DOC-34 §9.2, DOC-37 §3). */
  private async readNotice(
    claim: ClaimedJob,
    source: ChargeNoticeRow,
    context: FeeNoticeContext,
  ): Promise<Uint8Array> {
    const { fileId } = await this.cache.get(
      claim.buildingId,
      source,
      context,
      claim.language,
      false,
    )
    const ownerRef = feeNoticeKey(
      source.batch.id,
      source.charge.unitId,
      claim.language,
      feeNoticeHash(toFeeNoticeInput(source, context, claim.language, null)),
    )
    return this.files.read(systemFileActor(claim.buildingId), fileId, {
      module: 'finance',
      purpose: 'fee_notice_pdf',
      ownerRef,
    })
  }
}
