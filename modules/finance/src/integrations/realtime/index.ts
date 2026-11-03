import type { RealtimeMapping } from '@mod/realtime/contracts'
import { FINANCE_EVENTS, type MoneyUnpostedPayload } from '../../contracts'

/**
 * What the events of `finance` mean on the staff stream (DOC-52 §6.4, §9.1): a new row of the money log tells Manager and Admin
 * to refetch the counter and the list. The source event's amount and time are not copied: the stream holds no money.
 */
export const financeRealtime: RealtimeMapping<MoneyUnpostedPayload>[] = [
  {
    handler: 'realtime.sse_on_finance_money_unposted',
    eventType: FINANCE_EVENTS.moneyUnposted,
    build: (p) => ({
      buildingId: p.buildingId,
      target: { roles: ['manager', 'admin'] },
      event: {
        type: 'money_log.opened',
        data: { kind: p.kind, rowId: p.rowId, outcome: p.outcome },
      },
    }),
  },
]
