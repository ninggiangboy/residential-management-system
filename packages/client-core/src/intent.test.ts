import { expect, test } from 'bun:test'
import { canonicalBody, newIntent } from './intent'
import { accountKey, staffKey, unitKey } from './keys'
import { singleFlight } from './single-flight'

test('CL-06: the same body twice is one intent; a changed body is a new one', () => {
  let n = 0
  const intent = newIntent(() => `key-${++n}`)
  const first = intent.for({ a: 1, b: [1, 2] })
  expect(intent.for({ b: [1, 2], a: 1 })).toEqual(first)
  expect(intent.for({ a: 2, b: [1, 2] }).key).not.toBe(first.key)
  intent.reset()
  expect(intent.for({ a: 2, b: [1, 2] }).key).toBe('key-3')
})

test('the canonical form ignores key order and undefined values', () => {
  expect(canonicalBody({ b: 1, a: undefined, c: { y: 1, x: 2 } })).toBe('{"b":1,"c":{"x":2,"y":1}}')
})

test('CL-15: two units give different keys; the unit id is in the second position', () => {
  expect(unitKey('A', 'fees')).toEqual(['unit', 'A', 'fees'])
  expect(unitKey('A', 'fees')).not.toEqual(unitKey('B', 'fees'))
  expect(staffKey('units', { q: 'a' })[0]).toBe('staff')
  expect(accountKey()).toEqual(['me'])
})

test('singleFlight runs the function once for callers that overlap', async () => {
  let runs = 0
  const flight = singleFlight(async () => {
    runs++
    await Bun.sleep(5)
    return runs
  })
  expect(await Promise.all([flight(), flight(), flight()])).toEqual([1, 1, 1])
  expect(await flight()).toBe(2)
})
