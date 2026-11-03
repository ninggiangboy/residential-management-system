import type { FinanceModuleDeps } from '../../src/finance.module'

/** The building every finance test runs in: Ho Chi Minh City time (DR-09) and the receipt blocks of DOC-22 §7. */
export const TEST_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * Stand-ins for the ports `apps/api` adapts from `building`, `identity` and `residency` (`finance-ports.ts`): a fixed zone, the
 * Sunrise company block, and a payer whose name `payerNames` may override (a missing entry is a deleted account, IN-39).
 */
export function testPorts(
  payerNames: ReadonlyMap<string, string | null> = new Map(),
): Pick<FinanceModuleDeps, 'calendar' | 'receiptBuildings' | 'payers' | 'outboxMaxPayloadBytes'> {
  return {
    calendar: { timeZone: async () => TEST_ZONE },
    receiptBuildings: {
      forBuilding: async () => ({
        timeZone: TEST_ZONE,
        company: {
          name: { vi: 'Công ty Quản lý An Phú', en: 'An Phu Property Management Co.' },
          address: '12 Nguyễn Văn Linh, Quận 7',
          hotline: '028 3775 1234',
          logoKey: null,
        },
        building: { name: { vi: 'Chung cư Sunrise', en: 'Sunrise Residences' } },
      }),
    },
    payers: {
      payer: async (accountId) => ({
        name: payerNames.has(accountId) ? (payerNames.get(accountId) ?? null) : 'Trần Minh Anh',
        memberType: 'owner',
      }),
    },
    outboxMaxPayloadBytes: 65_536,
  }
}
