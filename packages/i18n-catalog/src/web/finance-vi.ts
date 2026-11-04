import { finChargeVoidVi } from './fin-charge-void-vi'
import { finDebtsVi } from './fin-debts-vi'
import { finFeeBatchVi } from './fin-fee-batch-vi'
import { finFeeImportVi } from './fin-fee-import-vi'
import { finFeeNoticeVi } from './fin-fee-notice-vi'
import { finFeeRecallVi } from './fin-fee-recall-vi'
import { finFeeRecordVi } from './fin-fee-record-vi'
import { finFeeReissueVi } from './fin-fee-reissue-vi'
import { finFeesVi } from './fin-fees-vi'
import type { webFinanceEn } from './finance-en'

/** The Vietnamese copy of the finance screens, a feature chunk like its English twin. */
export const webFinanceVi: Record<keyof typeof webFinanceEn, string> = {
  ...finFeesVi,
  ...finFeeImportVi,
  ...finFeeBatchVi,
  ...finFeeNoticeVi,
  ...finFeeRecordVi,
  ...finFeeRecallVi,
  ...finChargeVoidVi,
  ...finFeeReissueVi,
  ...finDebtsVi,
}
