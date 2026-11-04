/**
 * The pure mapper from the stored charge to the renderer's `FeeNoticeInput` and the cache key of DOC-34 §8.1
 * (DR-292, DR-293): the hash over the canonical JSON of the input, the logical key
 * `batch/<batchId>/unit/<unitId>/<lang>/<hash>.pdf`, the download name and `toFeeNoticeInput`. No I/O and no clock;
 * money is a plain integer đồng and days are `LocalDate`.
 */
import { createHash } from 'node:crypto'
import type { LocalDate } from '@rms/shared-types'
import type { ChargeNoticeRow } from '../domain/charge-repository'
import type { FeeNoticeInput, PdfChargeLine, PdfLanguage } from './pdf-renderer'
import type { NoticeBuilding } from './ports'

/** Bump when the printed notice changes so a changed document makes a new hash and a new file (DOC-34 §8.1, DR-293). */
export const FEE_NOTICE_TEMPLATE_VERSION = 1

/** The stored charge, its batch and its lines in `position` order (DR-292): the source of one notice. */
export type FeeNoticeSource = ChargeNoticeRow

/** What the caller resolved besides the charge (DOC-34 §6.1, DR-292): the building block, the owner and the issue day. */
export interface FeeNoticeContext {
  readonly building: NoticeBuilding
  readonly ownerName: string | null
  readonly issueDate: LocalDate
}

/** SHA-256 as lowercase hex through `node:crypto` (application may use node built-ins, never Drizzle or Elysia). */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The canonical JSON of DOC-34 §8.1: object keys sorted at every level, so key order never changes the hash. */
function canonical(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
}

/** The parts the hash covers (DOC-34 §8.1): the version, the language, the batch, the charge, the owner, the building and the switches. */
function hashPayload(input: FeeNoticeInput): unknown {
  return {
    version: FEE_NOTICE_TEMPLATE_VERSION,
    language: input.language,
    batch: {
      code: input.batch.code,
      name: input.batch.name,
      feeMonth: input.batch.feeMonth,
      dueDate: input.batch.dueDate,
      issueDate: input.batch.issueDate,
    },
    unit: { code: input.unit.code, ownerName: input.unit.ownerName },
    total: input.total,
    lines: input.lines.map((line) => ({ ...line })),
    building: {
      name: input.building.name,
      company: input.building.company,
      address: input.building.address,
      hotline: input.building.hotline,
      email: input.building.email,
      workingHours: input.building.workingHours,
    },
    logoFile: input.logoFile ?? null,
    gatewayActive: input.gatewayActive,
    workingHoursSet: input.building.workingHours !== null,
  }
}

/** The first 16 hex characters of SHA-256 over the canonical JSON of §8.1 (DR-293); key order never matters. */
export function feeNoticeHash(input: FeeNoticeInput): string {
  return sha256Hex(canonical(hashPayload(input))).slice(0, 16)
}

/** The logical key of §8.1: `batch/<batchId>/unit/<unitId>/<lang>/<hash>.pdf`, purpose `fee_notice_pdf`. */
export function feeNoticeKey(
  batchId: string,
  unitId: string,
  language: PdfLanguage,
  hash: string,
): string {
  return `batch/${batchId}/unit/${unitId}/${language}/${hash}.pdf`
}

/** The `Content-Disposition` name of §8.1: `PH-2610-01-A-1508.pdf`. */
export function feeNoticeFileName(batchCode: string, unitCode: string): string {
  return `${batchCode}-${unitCode}.pdf`
}

/** One printed line (DOC-34 §6.1): a fee as `normal` and an adjustment as `adjustment`. */
function toChargeLine(line: ChargeNoticeRow['lines'][number]): PdfChargeLine {
  return {
    position: line.position,
    itemName: line.itemName,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
    kind: line.kind === 'fee' ? 'normal' : 'adjustment',
    note: line.note,
  }
}

/**
 * The fee notice of DOC-34 §6 from the stored charge and the resolved context: `draft` follows the batch (DR-292),
 * `logo` is the bytes the caller read (§8.4, `null` when missing) and the issue day is the published day, or today
 * for a draft (§6.1). The `logoFile` id is carried for the cache key and is never printed.
 */
export function toFeeNoticeInput(
  source: FeeNoticeSource,
  context: FeeNoticeContext,
  language: PdfLanguage,
  logo: Uint8Array | null,
): FeeNoticeInput {
  const { charge, batch, lines } = source
  return {
    kind: 'fee_notice',
    language,
    draft: batch.status === 'draft',
    building: {
      name: context.building.name,
      company: context.building.company,
      address: context.building.address,
      hotline: context.building.hotline,
      email: context.building.email,
      workingHours: context.building.workingHours,
      logo,
    },
    logoFile: context.building.logoFile,
    gatewayActive: context.building.gatewayActive,
    unit: { code: charge.unitCode, ownerName: context.ownerName },
    batch: {
      code: batch.code,
      name: batch.name,
      feeMonth: batch.feeMonth,
      dueDate: batch.dueDate,
      issueDate: context.issueDate,
    },
    lines: lines.map(toChargeLine),
    total: Number(charge.amount),
  }
}
