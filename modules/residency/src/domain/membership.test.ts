import { describe, expect, test } from 'bun:test'
import { ConflictError, ForbiddenError, NotFoundError, RuleViolationError } from '@core/kernel'
import { Membership, type MembershipActor, type MembershipRecord } from './membership'

const NOW = new Date('2026-10-20T03:00:00Z')
const UNIT = '018f0000-0000-7000-8000-000000000021'
const OWNER_ACCOUNT = '018f0000-0000-7000-8000-000000000041'

const record = (over: Partial<MembershipRecord> = {}): MembershipRecord => ({
  id: '018f0000-0000-7000-8000-000000000062',
  buildingId: '018f0000-0000-7000-8000-000000000001',
  accountId: '018f0000-0000-7000-8000-000000000042',
  unitId: UNIT,
  memberType: 'tenant',
  canPay: false,
  status: 'active',
  lockedBy: null,
  credentialVersion: 1,
  addedByKind: 'resident',
  addedBy: OWNER_ACCOUNT,
  invitedAt: null,
  note: null,
  removedAt: null,
  createdAt: new Date('2026-10-01T03:00:00Z'),
  updatedAt: new Date('2026-10-01T03:00:00Z'),
  ...over,
})

const manager: MembershipActor = { kind: 'manager' }
const owner: MembershipActor = { kind: 'owner', accountId: OWNER_ACCOUNT, unitId: UNIT }

const codeOf = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as { code: string }).code
  }
  return undefined
}

describe('Membership', () => {
  test('RM-09 lock, unlock, retype and remove each move credential_version by one; can_pay does not', () => {
    const locked = new Membership(record()).lock(owner).transition
    expect(locked.set).toMatchObject({ status: 'locked', lockedBy: 'owner', credentialVersion: 2 })
    const unlocked = new Membership(
      record({ status: 'locked', lockedBy: 'owner', credentialVersion: 2 }),
    ).unlock(owner)
    expect(unlocked.transition.set).toMatchObject({
      status: 'active',
      lockedBy: null,
      credentialVersion: 3,
    })
    const retyped = new Membership(record({ credentialVersion: 3 })).retype('family', manager)
    expect(retyped.transition.set).toMatchObject({ memberType: 'family', credentialVersion: 4 })
    const removed = new Membership(record({ credentialVersion: 4 })).remove(manager, NOW)
    expect(removed.transition.set).toMatchObject({
      status: 'removed',
      lockedBy: null,
      removedAt: NOW,
      credentialVersion: 5,
    })
    const paying = new Membership(record({ credentialVersion: 5 })).setCanPay(true, manager)
    expect(paying.transition.set).toEqual({ canPay: true })
  })

  test('the guarded statement names the state the rule read', () => {
    const { transition } = new Membership(record({ credentialVersion: 7 })).lock(manager)
    expect(transition.expect).toEqual({
      status: 'active',
      lockedBy: null,
      memberType: 'tenant',
      credentialVersion: 7,
    })
  })

  test('RM-10 the Manager locks over the owner’s lock; the owner cannot unlock the Manager’s lock', () => {
    const lockedByOwner = record({ status: 'locked', lockedBy: 'owner' })
    expect(new Membership(lockedByOwner).lock(manager).transition.set).toMatchObject({
      status: 'locked',
      lockedBy: 'manager',
    })
    const lockedByManager = record({ status: 'locked', lockedBy: 'manager' })
    expect(codeOf(() => new Membership(lockedByManager).unlock(owner))).toBe('invalid_transition')
    expect(new Membership(lockedByManager).unlock(manager).transition.set).toMatchObject({
      status: 'active',
    })
    // A lock the Manager already holds changes nothing, and the owner cannot lock what is locked.
    expect(codeOf(() => new Membership(lockedByManager).lock(manager))).toBe('invalid_transition')
    expect(codeOf(() => new Membership(lockedByOwner).lock(owner))).toBe('invalid_transition')
  })

  test('RM-13 the owner acting on their own row: 403 for a lock, owner_must_transfer for a remove or a retype', () => {
    const own = record({ accountId: OWNER_ACCOUNT, memberType: 'owner' })
    expect(() => new Membership(own).lock(owner)).toThrow(ForbiddenError)
    expect(codeOf(() => new Membership(own).remove(owner, NOW))).toBe('owner_must_transfer')
    expect(codeOf(() => new Membership(own).retype('family', owner))).toBe('owner_must_transfer')
    // The Manager may lock and unlock an owner row, but not remove or retype it.
    expect(new Membership(own).lock(manager).change).toBe('locked')
    expect(codeOf(() => new Membership(own).remove(manager, NOW))).toBe('owner_must_transfer')
  })

  test('RM-21 a helper is not retyped, can_pay is for a tenant, and a type moves only between family and tenant', () => {
    expect(
      codeOf(() => new Membership(record({ memberType: 'helper' })).retype('family', manager)),
    ).toBe('invalid_transition')
    expect(codeOf(() => new Membership(record()).retype('helper', manager))).toBe(
      'invalid_transition',
    )
    expect(codeOf(() => new Membership(record()).retype('tenant', manager))).toBe(
      'invalid_transition',
    )
    expect(() => new Membership(record({ memberType: 'family' })).setCanPay(true, manager)).toThrow(
      RuleViolationError,
    )
    expect(
      codeOf(() => new Membership(record({ memberType: 'family' })).setCanPay(true, manager)),
    ).toBe('validation_failed')
  })

  test('an owner reaches the memberships of their own unit only; another unit’s looks missing', () => {
    const elsewhere = record({ unitId: '018f0000-0000-7000-8000-000000000099' })
    expect(() => new Membership(elsewhere).lock(owner)).toThrow(NotFoundError)
    expect(() => new Membership(elsewhere).remove(owner, NOW)).toThrow(NotFoundError)
  })

  test('a removed membership allows nothing, and the details of the conflict name it', () => {
    const gone = record({ status: 'removed', removedAt: NOW })
    try {
      new Membership(gone).lock(manager)
      throw new Error('expected a conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError)
      expect((error as ConflictError).details).toEqual({
        entity: 'membership',
        status: 'removed',
        action: 'lock',
      })
    }
    expect(codeOf(() => new Membership(gone).remove(manager, NOW))).toBe('invalid_transition')
  })
})
