import { describe, expect, test } from 'bun:test'
import {
  type BuildingId,
  CAPABILITIES,
  type Capability,
  MEMBER_TYPES,
  type MembershipId,
  type MemberType,
  type ResidentAccountId,
  type UnitId,
} from '@rms/shared-types'
import { can, type UnitContext } from './policy'

const context = (memberType: MemberType, canPay: boolean): UnitContext => ({
  buildingId: 'b' as BuildingId,
  unitId: 'u' as UnitId,
  membershipId: 'm' as MembershipId,
  accountId: 'a' as ResidentAccountId,
  memberType,
  canPay,
  startedAt: new Date('2026-10-01T00:00:00Z'),
  scope: { buildingId: 'b' as BuildingId },
})

/** The table of DOC-27 §3.2, written out as the document gives it: the types that hold each capability, `can_pay` aside. */
const EXPECTED: Record<Capability, readonly MemberType[]> = {
  broadcast_notices: ['owner', 'family', 'tenant', 'helper'],
  personal_notifications: ['owner', 'family', 'tenant'],
  view_fees: ['owner', 'family', 'tenant'],
  pay: ['owner', 'family'],
  tickets: ['owner', 'family', 'tenant'],
  vehicles: ['owner', 'family', 'tenant'],
  library: ['owner', 'family', 'tenant'],
  manage_members: ['owner'],
}

describe('the policy table', () => {
  test('RM-06 4 member types × 8 capabilities × can_pay off and on (64 cells) equal the table', () => {
    let cells = 0
    for (const capability of CAPABILITIES)
      for (const type of MEMBER_TYPES)
        for (const canPay of [false, true]) {
          // `can_pay` turns on one cell only: the tenant's `pay`.
          const expected =
            EXPECTED[capability].includes(type) ||
            (capability === 'pay' && type === 'tenant' && canPay)
          expect(can(context(type, canPay), capability)).toBe(expected)
          cells++
        }
    expect(cells).toBe(64)
  })

  test('RM-06 can_pay changes nothing for an owner, a family member or a helper', () => {
    for (const type of ['owner', 'family', 'helper'] as const)
      for (const capability of CAPABILITIES)
        expect(can(context(type, true), capability)).toBe(can(context(type, false), capability))
  })

  test('RM-07 a helper holds broadcast notices and nothing else', () => {
    const held = CAPABILITIES.filter((capability) => can(context('helper', false), capability))
    expect(held).toEqual(['broadcast_notices'])
  })
})
