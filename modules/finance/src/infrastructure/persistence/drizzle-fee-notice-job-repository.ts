import type { Database } from '@core/db'
import { InvariantError } from '@core/kernel'
import type { BuildingScope } from '@rms/shared-types'
import { sql } from 'drizzle-orm'
import {
  type ClaimedJob,
  FEE_NOTICE_LEASE_SECONDS,
  FEE_NOTICE_MAX_ATTEMPTS,
  type FeeNoticeJobRepository,
  type FeeNoticeJobRequest,
  type FeeNoticeJobRow,
  type FeeNoticeJobStatus,
  type RequestFeeNoticeJobInput,
  type SaveProgressInput,
} from '../../domain/fee-notice-job-repository'

/** The columns `RETURNING *` gives back, snake_case as the driver names them. */
interface RawJobRow {
  id: string
  building_id: string
  batch_id: string
  status: string
  language: string
  unit_total: number
  unit_done: number
  cursor_charge: string | null
  zip_file: string | null
  attempts: number
  error: unknown
  created_at: Date
  finished_at: Date | null
}

const toRow = (row: RawJobRow): FeeNoticeJobRow => ({
  id: row.id,
  batchId: row.batch_id,
  status: row.status as FeeNoticeJobStatus,
  language: row.language as FeeNoticeJobRow['language'],
  unitTotal: row.unit_total,
  unitDone: row.unit_done,
  zipFile: row.zip_file,
  error: row.error,
  createdAt: row.created_at,
  finishedAt: row.finished_at,
})

const toClaim = (row: RawJobRow): ClaimedJob => ({
  id: row.id,
  buildingId: row.building_id,
  batchId: row.batch_id,
  language: row.language as ClaimedJob['language'],
  unitTotal: row.unit_total,
  unitDone: row.unit_done,
  cursorCharge: row.cursor_charge,
  attempts: row.attempts,
})

/**
 * The Drizzle adapter of `FeeNoticeJobRepository` (DOC-34 §9.1, §9.2; DR-293, DR-294). Every statement carries the
 * building scope explicitly (`building_id = :b`); the leases use the database's `now()`, and the fenced writes carry
 * `AND status = 'running' AND attempts = :a`, so a worker that lost its lease writes nothing (PD-24).
 */
export class DrizzleFeeNoticeJobRepository implements FeeNoticeJobRepository {
  constructor(private readonly database: Database) {}

  async request(
    scope: BuildingScope,
    input: RequestFeeNoticeJobInput,
  ): Promise<FeeNoticeJobRequest> {
    const inserted = (await this.database.executor.execute(sql`
      INSERT INTO finance.fee_notice_job (id, building_id, batch_id, language, unit_total, requested_by)
      VALUES (${input.id}::uuid, ${scope.buildingId}::uuid, ${input.batchId}::uuid, ${input.language},
              (SELECT count(*)::int FROM finance.charge
                WHERE building_id = ${scope.buildingId}::uuid AND batch_id = ${input.batchId}::uuid
                  AND status IN ('open', 'paid')),
              ${input.requestedBy}::uuid)
      ON CONFLICT DO NOTHING
      RETURNING *`)) as unknown as RawJobRow[]
    const [created] = inserted
    if (created) return { job: toRow(created), created: true }
    // FNM-111: a job of the batch is already queued or running; the answer is that one.
    const [active] = (await this.database.executor.execute(sql`
      SELECT * FROM finance.fee_notice_job
       WHERE building_id = ${scope.buildingId}::uuid AND batch_id = ${input.batchId}::uuid
         AND status IN ('queued', 'running')
       ORDER BY created_at DESC
       LIMIT 1`)) as unknown as RawJobRow[]
    if (!active) throw new InvariantError('fee_notice_job: no active job after a conflict')
    return { job: toRow(active), created: false }
  }

  async latestForBatch(scope: BuildingScope, batchId: string): Promise<FeeNoticeJobRow | null> {
    const [row] = (await this.database.executor.execute(sql`
      SELECT * FROM finance.fee_notice_job
       WHERE building_id = ${scope.buildingId}::uuid AND batch_id = ${batchId}::uuid
       ORDER BY created_at DESC, id DESC
       LIMIT 1`)) as unknown as RawJobRow[]
    return row ? toRow(row) : null
  }

  // scope-ok: the worker runs per building from BuildingApi.listBuildings (DR-244 item 10); building_id = :b is explicit.
  async giveUpExhausted(buildingId: string): Promise<number> {
    const result = await this.database.executor.execute(sql`
      UPDATE finance.fee_notice_job
         SET status = 'failed', finished_at = now(), locked_until = NULL, updated_at = now(),
             error = jsonb_build_object('code', 'attempts_exhausted', 'attempts', attempts, 'unitDone', unit_done)
       WHERE building_id = ${buildingId}::uuid AND status = 'running' AND locked_until < now()
         AND attempts >= ${FEE_NOTICE_MAX_ATTEMPTS}`)
    return result.count
  }

  // scope-ok: the worker claims per building from BuildingApi.listBuildings (DR-244 item 10); building_id = :b is explicit.
  async claim(buildingId: string): Promise<ClaimedJob | null> {
    const [row] = (await this.database.executor.execute(sql`
      UPDATE finance.fee_notice_job
         SET status = 'running', attempts = attempts + 1,
             locked_until = now() + make_interval(secs => ${FEE_NOTICE_LEASE_SECONDS}),
             started_at = coalesce(started_at, now()), updated_at = now()
       WHERE id = (SELECT id FROM finance.fee_notice_job
                    WHERE building_id = ${buildingId}::uuid
                      AND (status = 'queued' OR (status = 'running' AND locked_until < now()))
                      AND attempts < ${FEE_NOTICE_MAX_ATTEMPTS}
                    ORDER BY created_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED)
       RETURNING *`)) as unknown as RawJobRow[]
    return row ? toClaim(row) : null
  }

  // scope-ok: the fence id and attempts pin the row the worker claimed; building_id = :b is explicit.
  async saveProgress(claim: ClaimedJob, input: SaveProgressInput): Promise<boolean> {
    const rows = (await this.database.executor.execute(sql`
      UPDATE finance.fee_notice_job
         SET unit_done = ${input.unitDone}, cursor_charge = ${input.cursorCharge}::uuid,
             locked_until = now() + make_interval(secs => ${FEE_NOTICE_LEASE_SECONDS}), updated_at = now()
       WHERE building_id = ${claim.buildingId}::uuid AND id = ${claim.id}::uuid
         AND status = 'running' AND attempts = ${claim.attempts}
       RETURNING id`)) as unknown as Array<{ id: string }>
    return rows.length === 1
  }

  // scope-ok: the fence id and attempts pin the row the worker claimed; building_id = :b is explicit.
  async finishReady(claim: ClaimedJob, input: { readonly zipFile: string }): Promise<boolean> {
    const rows = (await this.database.executor.execute(sql`
      UPDATE finance.fee_notice_job
         SET status = 'ready', zip_file = ${input.zipFile}::uuid, unit_done = unit_total,
             finished_at = now(), locked_until = NULL, updated_at = now()
       WHERE building_id = ${claim.buildingId}::uuid AND id = ${claim.id}::uuid
         AND status = 'running' AND attempts = ${claim.attempts}
       RETURNING id`)) as unknown as Array<{ id: string }>
    return rows.length === 1
  }

  // scope-ok: the fence id and attempts pin the row the worker claimed; building_id = :b is explicit.
  async finishFailed(claim: ClaimedJob, input: { readonly error: unknown }): Promise<boolean> {
    const rows = (await this.database.executor.execute(sql`
      UPDATE finance.fee_notice_job
         SET status = 'failed', error = ${JSON.stringify(input.error)}::jsonb, finished_at = now(),
             locked_until = NULL, updated_at = now()
       WHERE building_id = ${claim.buildingId}::uuid AND id = ${claim.id}::uuid
         AND status = 'running' AND attempts = ${claim.attempts}
       RETURNING id`)) as unknown as Array<{ id: string }>
    return rows.length === 1
  }
}
