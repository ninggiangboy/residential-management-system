import { describe, expect, test } from 'bun:test'
import { recipientFilter } from './membership-queries'

describe('recipientFilter', () => {
  test('it is derived from the policy table: a tenant receives for `pay` only with can_pay', () => {
    expect(recipientFilter('pay')).toEqual({ always: ['owner', 'family'], whenCanPay: ['tenant'] })
    expect(recipientFilter('view_fees')).toEqual({
      always: ['owner', 'family', 'tenant'],
      whenCanPay: [],
    })
    expect(recipientFilter('manage_members')).toEqual({ always: ['owner'], whenCanPay: [] })
    expect(recipientFilter('broadcast_notices').always).toHaveLength(4)
  })
})
