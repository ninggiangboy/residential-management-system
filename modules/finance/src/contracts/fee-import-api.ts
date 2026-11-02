import type { Language, StaffContext } from '@rms/shared-types'

/**
 * The fee import as the host's import routes call it (E-71…E-74, E-169 with `kind = fee_batch`, DR-149, DOC-21 §4): plain DTOs
 * with ISO dates. Each call checks the caller's role and building like the use case behind it.
 */
export type FeeImportStatusDto = 'validated' | 'failed' | 'committed' | 'expired'

export interface FeeImportIssueDto {
  readonly row: number
  readonly unitCode: string | null
  /** A canonical column of the fee file (`FEE_IMPORT_HEADERS`), `null` for a rule of the whole file. */
  readonly column: string | null
  readonly severity: 'fail' | 'error' | 'warning'
  readonly code: string
  readonly params: Readonly<Record<string, string | number>>
}

export interface FeeImportCountsDto {
  readonly rows: number
  readonly valid: number
  readonly errors: number
  readonly warnings: number
  readonly charges: number
  readonly lines: number
  readonly totalAmount: number
}

export interface FeePreviewRowDto {
  readonly row: number
  readonly unitCode: string
  readonly itemName: string
  readonly itemNameEn?: string
  readonly kind: 'fee' | 'adjustment'
  readonly quantity: string
  readonly unitPrice: number
  readonly amount: number
}

export interface FeeImportCommittedDto {
  readonly created: number
  readonly replaced: number
}

export interface FeeImportSummaryDto {
  readonly importId: string
  readonly status: FeeImportStatusDto
  readonly fileName: string | null
  readonly batchId: string
  readonly createdBy: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly committedAt: string | null
  readonly counts: FeeImportCountsDto
}

export interface FeeImportJobDto extends Omit<FeeImportSummaryDto, 'counts'> {
  readonly committed: FeeImportCommittedDto | null
  readonly preview: {
    readonly counts: FeeImportCountsDto
    readonly validRows: readonly FeePreviewRowDto[]
    readonly issues: readonly FeeImportIssueDto[]
    readonly issuesTruncated: boolean
  }
}

export interface FeeImportCursorDto {
  readonly createdAt: Date
  readonly id: string
}

export interface FeeImportApi {
  template(staff: StaffContext, language: Language): Promise<Uint8Array>
  validate(
    staff: StaffContext,
    input: { batchId: string; fileId: string; fileName?: string },
  ): Promise<FeeImportJobDto>
  /** 404 `not_found` for an unknown id or another building's job. */
  get(staff: StaffContext, id: string): Promise<FeeImportJobDto>
  /** 404 `not_found` for an unknown id or another building's job. */
  commit(
    staff: StaffContext,
    id: string,
  ): Promise<{ readonly job: FeeImportJobDto; readonly committed: FeeImportCommittedDto }>
  list(
    staff: StaffContext,
    query: { status?: FeeImportStatusDto; after?: FeeImportCursorDto; limit: number },
  ): Promise<{
    readonly items: readonly FeeImportSummaryDto[]
    readonly next: FeeImportCursorDto | null
  }>
}

/** Row 1 of the template per language (DOC-18 §2.1, E-71): also how an issue names a column to the Manager. */
export const FEE_IMPORT_HEADERS = {
  vi: {
    unit_code: 'Mã căn hộ',
    fee_month: 'Tháng phí',
    item_name: 'Tên khoản',
    item_name_en: 'Tên khoản (EN)',
    quantity: 'Số lượng',
    unit_price: 'Đơn giá',
    amount: 'Thành tiền',
    kind: 'Loại',
    note: 'Ghi chú',
  },
  en: {
    unit_code: 'Unit code',
    fee_month: 'Fee month',
    item_name: 'Item name',
    item_name_en: 'Item name (EN)',
    quantity: 'Quantity',
    unit_price: 'Unit price',
    amount: 'Amount',
    kind: 'Kind',
    note: 'Note',
  },
} as const satisfies Record<Language, Record<string, string>>
