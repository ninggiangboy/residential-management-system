import { expect, test } from 'bun:test'
import { createTermsGate, createUpgradeGate } from './gates'

test('UIRA-29: two requests share one gate and one promise; resolving releases both', async () => {
  const gate = createTermsGate()
  let opened = 0
  gate.subscribe(() => {
    if (gate.isOpen()) opened++
  })
  const a = gate.request()
  const b = gate.request()
  expect(a).toBe(b)
  expect(opened).toBe(1)
  let released = 0
  void Promise.all([a, b]).then(() => released++)
  gate.resolve()
  await a
  await Promise.resolve()
  expect(released).toBe(1)
  expect(gate.isOpen()).toBe(false)
})

test('a request after the gate resolved opens a new one', () => {
  const gate = createTermsGate()
  const first = gate.request()
  gate.resolve()
  const second = gate.request()
  expect(second).not.toBe(first)
  expect(gate.isOpen()).toBe(true)
})

test('the upgrade gate holds the details until cleared', () => {
  const gate = createUpgradeGate()
  expect(gate.get()).toBeNull()
  gate.require({ minVersion: '1.2.0', storeUrl: 'https://store.example/app' })
  expect(gate.get()?.minVersion).toBe('1.2.0')
})
