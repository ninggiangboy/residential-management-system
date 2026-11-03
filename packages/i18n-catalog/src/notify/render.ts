import {
  formatDate,
  type Language,
  NOTICE_TITLE_PUSH_MAX,
  type Params,
  type ParamValue,
  type TemplateKey,
} from '@rms/shared-types'
import { createTranslator } from '../create-translator'
import type { Translator } from '../translator'

/**
 * Renders one notification's title and body (DOC-31 §3.3, DR-303). The params are formatted before ICU interpolation, as
 * DOC-68 §1 requires: the catalog holds the sentence, the caller holds no text, and `vi` and `en` share the arguments.
 */
export function renderNotification(
  key: TemplateKey,
  params: Params,
  language: Language,
  opts: { timeZone?: string } = {},
): { title: string; body: string } {
  const t = createTranslator(language)
  const args: Record<string, string> = {}
  for (const [name, value] of Object.entries(params))
    args[name] = formatParam(name, value, language, t, opts.timeZone)
  return { title: t(`notify.${key}.title`, args), body: t(`notify.${key}.body`, args) }
}

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const MONTHS_EN_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** `2026-10` -> `tháng 10/2026` / `October 2026` (DOC-31 §3.3, DOC-68 §7). */
function formatFeeMonth(month: string, language: Language): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return language === 'vi' ? `tháng ${m}/${year}` : `${MONTHS_EN[m - 1]} ${year}`
}

/** `2026-11-20` -> `20/11/2026` / `20 Nov 2026` (DOC-31 §3.3; the order differs from `formatDate`'). */
function formatDueDate(day: string, language: Language, timeZone?: string): string {
  if (language === 'vi') return formatDate(day, 'vi', timeZone)
  const [year, m, d] = day.split('-').map(Number) as [number, number, number]
  return `${d} ${MONTHS_EN_SHORT[m - 1]} ${year}`
}

/** A ticket status as its resident label, else the raw value (DOC-31 §3.3, DOC-68 §5.7). */
function formatStatus(value: string, t: Translator): string {
  const key = `status.ticket-resident.${value}`
  return t.has(key) ? t(key) : value
}

/** The title in the reader's language, else `vi`, cut to 100 characters with `…` (DOC-31 §3.3, DR-52). */
function formatNoticeTitle(value: ParamValue, language: Language): string {
  const title = typeof value === 'string' ? { vi: value } : value
  const chosen = language === 'en' && title.en !== undefined ? title.en : title.vi
  return chosen.length > NOTICE_TITLE_PUSH_MAX
    ? `${chosen.slice(0, NOTICE_TITLE_PUSH_MAX - 1)}…`
    : chosen
}

function formatParam(
  name: string,
  value: ParamValue,
  language: Language,
  t: Translator,
  timeZone?: string,
): string {
  switch (name) {
    case 'feeMonth':
      return formatFeeMonth(String(value), language)
    case 'dueDate':
      return formatDueDate(String(value), language, timeZone)
    case 'status':
      return formatStatus(String(value), t)
    case 'noticeTitle':
      return formatNoticeTitle(value, language)
    default:
      return String(value)
  }
}
