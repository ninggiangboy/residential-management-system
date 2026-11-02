import type { Language } from '@rms/shared-types'
import { FEE_IMPORT_HEADERS } from '../../contracts'
import { foldKey } from './folding'

/** The canonical columns of the fee file (DOC-18 §2.1, DOC-21 §4.2). */
export const FEE_COLUMNS = [
  'unit_code',
  'fee_month',
  'item_name',
  'item_name_en',
  'quantity',
  'unit_price',
  'amount',
  'kind',
  'note',
] as const
export type FeeColumn = (typeof FEE_COLUMNS)[number]

/** The three columns DQ-62 requires, in the order `params.columns` lists the missing ones. */
export const REQUIRED_COLUMNS = ['unit_code', 'fee_month', 'item_name'] as const

/**
 * The aliases are the contract (DOC-18 §2.1); compared by `foldKey`. `Tên khoản (EN)` folds to `tenkhoanen`, so it never collides
 * with `Tên khoản`; `Ghi chú` is `note` here although the units file ignores it (the alias set belongs to the file kind).
 */
const ALIASES: Readonly<Record<FeeColumn, readonly string[]>> = {
  unit_code: ['Mã căn hộ', 'Mã căn', 'Căn hộ', 'Unit code', 'Unit', 'Apartment'],
  fee_month: ['Tháng phí', 'Kỳ phí', 'Fee month', 'Month'],
  item_name: ['Tên khoản', 'Khoản phí', 'Item name', 'Item'],
  item_name_en: ['Tên khoản (EN)', 'Item name (EN)'],
  quantity: ['Số lượng', 'SL', 'Quantity', 'Qty'],
  unit_price: ['Đơn giá', 'Unit price', 'Price'],
  amount: ['Thành tiền', 'Số tiền', 'Amount', 'Total'],
  kind: ['Loại', 'Kind', 'Type'],
  note: ['Ghi chú', 'Note', 'Reason'],
}

const COLUMN_BY_KEY: ReadonlyMap<string, FeeColumn> = new Map(
  FEE_COLUMNS.flatMap((column) =>
    ALIASES[column].map((alias) => [foldKey(alias), column] as const),
  ),
)

/** The canonical column a header names, or `null` when it matches no alias (DQ-06: a warning, the column is ignored). */
export const feeColumnOfHeader = (header: string): FeeColumn | null =>
  COLUMN_BY_KEY.get(foldKey(header)) ?? null

/** Row 1 of the template, per language (DOC-18 §2.1, E-71); the contract holds it so issues name columns the same way. */
export const FEE_TEMPLATE_HEADERS: Readonly<Record<Language, Readonly<Record<FeeColumn, string>>>> =
  FEE_IMPORT_HEADERS

export const FEE_TEMPLATE_SHEET_NAMES: Readonly<Record<Language, string>> = {
  vi: 'Phí',
  en: 'Fees',
}

/** Formatted as Text, because Excel turns the text `10/2026` into a date and drops a leading zero (DOC-18 §2.1). */
export const FEE_TEXT_COLUMNS: readonly FeeColumn[] = ['unit_code', 'fee_month', 'note']

/** One example row per kind (DOC-21 §4.2, E-71): the A-1508 fixture's fee line and its adjustment. */
export const FEE_TEMPLATE_EXAMPLES: Readonly<
  Record<Language, readonly Readonly<Partial<Record<FeeColumn, string | number>>>[]>
> = {
  vi: [
    {
      unit_code: 'A-1508',
      fee_month: '10/2026',
      item_name: 'Phí quản lý',
      quantity: 1,
      unit_price: 2_488_000,
      kind: 'phí',
    },
    {
      unit_code: 'A-1508',
      fee_month: '10/2026',
      item_name: 'Điều chỉnh',
      amount: -35_175,
      kind: 'điều chỉnh',
      note: 'Trừ phí nước tính thừa tháng 9',
    },
  ],
  en: [
    {
      unit_code: 'A-1508',
      fee_month: '10/2026',
      item_name: 'Management fee',
      quantity: 1,
      unit_price: 2_488_000,
      kind: 'fee',
    },
    {
      unit_code: 'A-1508',
      fee_month: '10/2026',
      item_name: 'Adjustment',
      amount: -35_175,
      kind: 'adjustment',
      note: 'Water overcharged in September',
    },
  ],
}
