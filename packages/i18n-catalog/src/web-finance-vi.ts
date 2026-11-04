import type { Messages } from './catalog'
import { webFinanceVi } from './web/finance-vi'

/** The finance screens in Vietnamese: a chunk of its own, fetched by the finance routes. */
export const WEB_FINANCE_VI: Partial<Messages> = webFinanceVi
