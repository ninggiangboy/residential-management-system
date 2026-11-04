import { type Database, inBuilding } from '@core/db'
import type { BuildingScope } from '@rms/shared-types'
import { and, eq, sql } from 'drizzle-orm'
import type {
  ReceiptPdfRepository,
  ReceiptPdfRow,
  SwapReceiptPdfInput,
} from '../../domain/receipt-pdf-repository'
import type { ReceiptSnapshot } from '../../domain/receipt-snapshot'
import { receipt } from './schema'

/**
 * The Drizzle adapter of `ReceiptPdfRepository` (DOC-34 §8.2, DR-295). The read carries the building scope like every
 * other repository; the swap is the doc's single statement, run on the caller's ambient executor
 * (`this.database.executor`) so it joins the open transaction and the `FOR UPDATE` lock holds to commit.
 */
export class DrizzleReceiptPdfRepository implements ReceiptPdfRepository {
  constructor(private readonly database: Database) {}

  async findForRender(scope: BuildingScope, receiptId: string): Promise<ReceiptPdfRow | null> {
    const [row] = await this.database.executor
      .select({
        id: receipt.id,
        number: receipt.number,
        status: receipt.status,
        snapshot: receipt.snapshot,
        pdfFile: receipt.pdfFile,
        issuedAt: receipt.issuedAt,
        voidedAt: receipt.voidedAt,
      })
      .from(receipt)
      .where(and(inBuilding(receipt, scope), eq(receipt.id, receiptId)))
      .limit(1)
    if (!row) return null
    return {
      id: row.id,
      number: row.number,
      status: row.status as ReceiptPdfRow['status'],
      snapshot: row.snapshot as ReceiptSnapshot,
      pdfFile: row.pdfFile,
      issuedAt: row.issuedAt,
      voidedAt: row.voidedAt,
      // `finance.receipt` has no void-reason column (schema.ts): the void line prints without a reason.
      voidReason: null,
    }
  }

  async swapPdfFile(
    scope: BuildingScope,
    input: SwapReceiptPdfInput,
  ): Promise<{ replaced: string | null } | null> {
    const rows = (await this.database.executor.execute(sql`
      WITH old AS (
        SELECT pdf_file FROM finance.receipt
         WHERE building_id = ${scope.buildingId}::uuid AND id = ${input.receiptId}::uuid FOR UPDATE)
      UPDATE finance.receipt r
         SET pdf_file = ${input.newFile}::uuid, updated_at = now()
        FROM old
       WHERE r.building_id = ${scope.buildingId}::uuid AND r.id = ${input.receiptId}::uuid
         AND r.status = ${input.expectedStatus}
         AND r.pdf_file IS DISTINCT FROM ${input.newFile}::uuid
         AND (${input.expectedStatus} = 'void' OR r.pdf_file IS NULL)
      RETURNING old.pdf_file AS replaced
    `)) as unknown as Array<{ replaced: string | null }>
    const [row] = rows
    if (!row) return null
    return { replaced: row.replaced }
  }
}
