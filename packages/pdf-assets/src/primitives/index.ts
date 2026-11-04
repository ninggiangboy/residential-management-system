/**
 * The shared PDF primitives of DOC-34 §2, §5 and §7 (DR-55, DR-56, DR-292): the page frame, the
 * company header, the label pair, the money table, the watermark and the footer content.
 */
export { CompanyHeader } from './company-header'
export { LabelPair } from './label-pair'
export type { MoneyCell, MoneyColumn, MoneyRow, MoneyTotal } from './money-table'
export { DEFAULT_TOTAL_HEIGHT, MoneyTable } from './money-table'
export { PageFooter } from './page-footer'
export { PageFrame } from './page-frame'
export { Watermark } from './watermark'
