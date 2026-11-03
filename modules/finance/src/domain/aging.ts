import { daysBetween, type LocalDate } from '@rms/shared-types'

/** The five buckets of DR-18 (DOC-22 §8.1); FR-12's "0–30" is read as "1–30". The SQL of §8.2 uses the same bounds. */
export const AGING_BUCKETS = ['not_yet_due', '1-30', '31-60', '61-90', 'over_90'] as const
export type AgingBucket = (typeof AGING_BUCKETS)[number]

/** `today − due` in building days, signed: 0 on the due day, negative before it (DOC-22 §8.1, DR-09). */
export const signedDaysPastDue = (today: LocalDate, due: LocalDate): number =>
  daysBetween(due, today)

export function bucketOf(days: number): AgingBucket {
  if (days <= 0) return 'not_yet_due'
  if (days <= 30) return '1-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  return 'over_90'
}
