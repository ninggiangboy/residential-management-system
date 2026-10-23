import { describe, expect, test } from 'bun:test'
import { type FamilyRecord, RefreshFamily, type TokenRecord } from './refresh-family'

const NOW = new Date('2026-10-23T08:00:00Z')
const at = (ms: number) => new Date(NOW.getTime() + ms)
const GRACE = 10

const family = (over: Partial<FamilyRecord> = {}) =>
  new RefreshFamily({
    id: 'f1',
    kind: 'staff',
    accountId: 'a1',
    buildingId: 'b1',
    client: 'web',
    absoluteExpiresAt: at(90 * 86_400_000),
    lastUsedAt: NOW,
    revokedAt: null,
    revokedReason: null,
    ...over,
  })

const token = (over: Partial<TokenRecord> = {}): TokenRecord => ({
  id: 't1',
  familyId: 'f1',
  expiresAt: at(30 * 86_400_000),
  revokedAt: null,
  replacedById: null,
  ...over,
})

describe('RefreshFamily.present', () => {
  test('the first use of a live token spends it and names the successor', () => {
    const p = family().present(token(), NOW, GRACE, 't2')
    expect(p).toEqual({
      kind: 'rotate',
      transition: {
        id: 't1',
        expect: { revokedAt: null },
        set: { revokedAt: NOW, replacedById: 't2' },
      },
    })
  })

  test('a spent token inside the grace window is a grace use', () => {
    const p = family().present(token({ revokedAt: at(-9000) }), NOW, GRACE, 't2')
    expect(p.kind).toBe('grace')
  })

  test('a spent token after the grace window is a reuse and revokes the family', () => {
    const p = family().present(token({ revokedAt: at(-11_000) }), NOW, GRACE, 't2')
    expect(p).toEqual({
      kind: 'reuse',
      revocation: {
        id: 'f1',
        expect: { revokedAt: null },
        set: { revokedAt: NOW, revokedReason: 'token_reuse' },
      },
    })
  })

  test('an expired token, an expired family and a revoked family are dead', () => {
    expect(family().present(token({ expiresAt: NOW }), NOW, GRACE, 't2').kind).toBe('dead')
    expect(family({ absoluteExpiresAt: NOW }).present(token(), NOW, GRACE, 't2').kind).toBe('dead')
    expect(family({ revokedAt: at(-1) }).present(token(), NOW, GRACE, 't2').kind).toBe('dead')
    expect(
      family({ revokedAt: at(-1) }).present(token({ revokedAt: at(-60_000) }), NOW, GRACE, 't2')
        .kind,
    ).toBe('dead')
  })
})

describe('RefreshFamily.revoke', () => {
  test('a live family ends with the reason', () => {
    expect(family().revoke('sign_out', NOW)?.set).toEqual({
      revokedAt: NOW,
      revokedReason: 'sign_out',
    })
  })

  test('a revoked family has nothing to revoke', () => {
    expect(family({ revokedAt: at(-1) }).revoke('sign_out', NOW)).toBeNull()
  })

  test('ownership is the kind and the account', () => {
    expect(family().ownedBy('staff', 'a1')).toBe(true)
    expect(family().ownedBy('staff', 'a2')).toBe(false)
    expect(family().ownedBy('resident', 'a1')).toBe(false)
  })
})
