import { routePlugin } from '@core/http'
import { type BatchRouteDeps, batchRoutes } from './batch-routes'
import { type ChargeRouteDeps, chargeRoutes } from './charge-routes'
import { type MoneyLogRouteDeps, moneyLogRoutes } from './money-log-routes'
import { type PaymentRouteDeps, paymentRoutes } from './payment-routes'

/** Everything the routes of `finance` call (DOC-12 §4.1, §4.5): use cases and query services, never repositories. */
export type FinanceRouteDeps = PaymentRouteDeps &
  MoneyLogRouteDeps &
  BatchRouteDeps &
  ChargeRouteDeps

/** The finance routes under `/api/v1` (DOC-51 §2.2, P2-15); one plugin per group, mounted once by `apps/api`. */
export function financeRoutes(d: FinanceRouteDeps) {
  return routePlugin()
    .use(batchRoutes(d))
    .use(chargeRoutes(d))
    .use(paymentRoutes(d))
    .use(moneyLogRoutes(d))
}
