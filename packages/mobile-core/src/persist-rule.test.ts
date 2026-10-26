import { expect, test } from 'bun:test'
import { shouldPersistQuery } from './persist-rule'

const query = (status: string, meta?: Record<string, unknown>) => ({ state: { status }, meta })

test('CL-16: only a successful query that opted in is persisted', () => {
  expect(shouldPersistQuery(query('success', { persist: true }))).toBe(true)
  expect(shouldPersistQuery(query('success'))).toBe(false)
  expect(shouldPersistQuery(query('success', { persist: false }))).toBe(false)
  expect(shouldPersistQuery(query('error', { persist: true }))).toBe(false)
  expect(shouldPersistQuery(query('pending', { persist: true }))).toBe(false)
})
