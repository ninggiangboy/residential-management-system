import { describe, expect, test } from 'bun:test'
import { QueryClient } from '@tanstack/react-query'
import type { SecureStorage } from './storage'
import { capabilityOf, createUnitStore, type Membership, resolveUnit } from './unit'

const membership = (unitId: string, over: Partial<Membership> = {}): Membership => ({
  membershipId: `m-${unitId}`,
  unitId,
  unitCode: unitId.toUpperCase(),
  memberType: 'owner',
  canPay: true,
  ...over,
})

describe('resolveUnit (DOC-55 §7.3 rule 2)', () => {
  test('UIRA-32: one membership is selected without asking', () => {
    expect(resolveUnit([membership('a')], null)).toEqual({
      kind: 'selected',
      unitId: 'a',
      stored: 'a',
    })
  })

  test('UIRA-35: a stored unit that is no longer a membership is dropped and two units go to Unit-Pick', () => {
    expect(resolveUnit([membership('a'), membership('b')], 'gone')).toEqual({
      kind: 'pick',
      stored: null,
    })
  })

  test('a valid stored unit wins over the pick', () => {
    expect(resolveUnit([membership('a'), membership('b')], 'b')).toMatchObject({
      kind: 'selected',
      unitId: 'b',
    })
  })

  test('UIRA-36: no membership is the no-unit state and clears the stored value', () => {
    expect(resolveUnit([], 'a')).toEqual({ kind: 'none', stored: null })
  })
})

describe('the unit store (CL-15, CL-24)', () => {
  const memory = (): SecureStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return {
      data,
      get: async (k) => data.get(k) ?? null,
      set: async (k, v) => void data.set(k, v),
      remove: async (k) => void data.delete(k),
      getSync: (k) => data.get(k) ?? null,
      setSync: (k, v) => void data.set(k, v),
    }
  }

  test('select writes rms.unit and removes only the previous unit’s queries', () => {
    const storage = memory()
    const queryClient = new QueryClient()
    queryClient.setQueryData(['unit', 'a', 'fees'], 'A data')
    queryClient.setQueryData(['unit', 'b', 'fees'], 'B data')
    queryClient.setQueryData(['me'], 'account')
    const store = createUnitStore(storage, queryClient)
    store.select('a')
    store.select('b')
    expect(storage.data.get('rms.unit')).toBe('b')
    expect(store.get()).toBe('b')
    expect(queryClient.getQueryData(['unit', 'a', 'fees'])).toBeUndefined()
    expect(queryClient.getQueryData(['unit', 'b', 'fees'])).toBe('B data')
    expect(queryClient.getQueryData(['me'])).toBe('account')
  })

  test('the stored unit is read at start and drop removes its queries', () => {
    const storage = memory()
    storage.data.set('rms.unit', 'a')
    const queryClient = new QueryClient()
    queryClient.setQueryData(['unit', 'a', 'inbox'], 'x')
    const store = createUnitStore(storage, queryClient)
    expect(store.get()).toBe('a')
    store.drop()
    expect(store.get()).toBeNull()
    expect(storage.data.has('rms.unit')).toBe(false)
    expect(queryClient.getQueryData(['unit', 'a', 'inbox'])).toBeUndefined()
  })

  test('subscribers hear a selection', () => {
    const store = createUnitStore(memory(), new QueryClient())
    let heard = 0
    store.subscribe(() => heard++)
    store.select('a')
    store.select('a')
    expect(heard).toBe(1)
  })
})

describe('capabilityOf', () => {
  test('a tenant without can_pay cannot pay but can view fees; a helper cannot view fees', () => {
    const tenant = membership('a', { memberType: 'tenant', canPay: false })
    expect(capabilityOf(tenant, 'pay')).toBe(false)
    expect(capabilityOf(tenant, 'view_fees')).toBe(true)
    expect(capabilityOf(membership('a', { memberType: 'helper' }), 'view_fees')).toBe(false)
    expect(capabilityOf(null, 'broadcast_notices')).toBe(false)
  })
})
