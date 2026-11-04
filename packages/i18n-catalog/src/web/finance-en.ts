import { finChargeVoidEn } from './fin-charge-void-en'
import { finDebtsEn } from './fin-debts-en'
import { finFeeBatchEn } from './fin-fee-batch-en'
import { finFeeImportEn } from './fin-fee-import-en'
import { finFeeNoticeEn } from './fin-fee-notice-en'
import { finFeeRecallEn } from './fin-fee-recall-en'
import { finFeeRecordEn } from './fin-fee-record-en'
import { finFeeReissueEn } from './fin-fee-reissue-en'
import { finFeesEn } from './fin-fees-en'

/** The copy of the finance screens (P2-16): a feature chunk of the web CMS, loaded by the finance routes (`loadWebFeature`). */
export const webFinanceEn = {
  ...finFeesEn,
  ...finFeeImportEn,
  ...finFeeBatchEn,
  ...finFeeNoticeEn,
  ...finFeeRecordEn,
  ...finFeeRecallEn,
  ...finChargeVoidEn,
  ...finFeeReissueEn,
  ...finDebtsEn,
} as const
