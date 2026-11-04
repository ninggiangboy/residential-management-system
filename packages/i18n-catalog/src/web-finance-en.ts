import type { Messages } from './catalog'
import { webFinanceEn } from './web/finance-en'

/** The finance screens in English: a chunk of its own, fetched by the finance routes and only in a language that is read. */
export const WEB_FINANCE_EN: Partial<Messages> = webFinanceEn
