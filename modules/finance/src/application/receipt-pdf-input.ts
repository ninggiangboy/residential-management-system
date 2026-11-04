/**
 * The pure mapper from the stored receipt snapshot to the renderer's `ReceiptInput` (DOC-34 §8.2, §7; DR-17, DR-295):
 * everything printed comes from the frozen snapshot, so a later company, logo or payer change never alters an old
 * receipt, and the void copy pairs the snapshot with the void the row carries. No I/O and no clock; money is a plain
 * integer đồng and days are `LocalDate`.
 */
import { buildingToday, DEFAULT_TIME_ZONE, type LocalDate } from '@rms/shared-types'
import type { ReceiptPdfRow } from '../domain/receipt-pdf-repository'
import type { ReceiptLine, ReceiptSnapshot } from '../domain/receipt-snapshot'
import type { PdfChargeLine, PdfLanguage, ReceiptInput } from './pdf-renderer'

/** The two logical keys of a receipt PDF (§8.2): the issued copy and the void copy. */
export type ReceiptPdfKey = `receipt/${string}/issued.pdf` | `receipt/${string}/void.pdf`

/** The logical key `storeGenerated` writes and `findByOwnerRef` reads (DR-86; DOC-34 §8.2). */
export function receiptPdfKey(receiptId: string, variant: 'issued' | 'void'): ReceiptPdfKey {
  return `receipt/${receiptId}/${variant}.pdf`
}

/** One printed line (DOC-34 §6.1, §7): the snapshot line, a fee as `normal` and an adjustment as `adjustment`. */
function toChargeLine(line: ReceiptLine, index: number): PdfChargeLine {
  return {
    position: index + 1,
    itemName: line.name,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
    kind: line.kind === 'fee' ? 'normal' : 'adjustment',
    note: line.note,
  }
}

/** The void block of DOC-34 §7.1 (only on the void copy): the voided day in the building's zone and the reason. */
function toVoid(row: ReceiptPdfRow): ReceiptInput['void'] {
  if (row.status !== 'void' || row.voidedAt === null) return null
  return { voidedOn: voidedOn(row.voidedAt, row.snapshot), reason: row.voidReason }
}

/** The calendar day of the void instant (DOC-34 §5): the snapshot names no zone, so `DEFAULT_TIME_ZONE` (DOC-22 §7). */
function voidedOn(instant: Date, snapshot: ReceiptSnapshot): LocalDate {
  const zone = (snapshot as { timeZone?: string }).timeZone ?? DEFAULT_TIME_ZONE
  return buildingToday(instant, zone)
}

/**
 * The receipt of DOC-34 §7 from the stored row (DR-17): `logo` is the bytes the caller read (§8.4, `null` when
 * missing), and `void` is set only when the row is `void` (DR-295).
 */
export function toReceiptInput(
  row: ReceiptPdfRow,
  language: PdfLanguage,
  logo: Uint8Array | null,
): ReceiptInput {
  const { snapshot } = row
  return {
    kind: 'receipt',
    language,
    number: row.number,
    issuedAt: snapshot.issuedAt,
    paidAt: snapshot.paidAt,
    payer: snapshot.payer,
    unit: { code: snapshot.unitCode },
    batch: snapshot.batch,
    items: snapshot.lines.map(toChargeLine),
    amount: snapshot.amount,
    method: snapshot.method,
    reference: snapshot.reference,
    building: snapshot.building,
    company: {
      name: snapshot.company.name,
      address: snapshot.company.address,
      hotline: snapshot.company.hotline,
    },
    logo,
    void: toVoid(row),
  }
}
