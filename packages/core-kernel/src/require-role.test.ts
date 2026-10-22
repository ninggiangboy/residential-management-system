import { describe, expect, test } from 'bun:test'
import { ForbiddenError } from './errors'
import { requireRole } from './require-role'

type Role = 'admin' | 'manager' | 'guard'

describe('requireRole', () => {
  test('passes a listed role', () => {
    const actor: { role: Role } = { role: 'manager' }
    expect(() => requireRole(actor, ['admin', 'manager'])).not.toThrow()
  })

  test('refuses an unlisted role with 403 forbidden', () => {
    const actor: { role: Role } = { role: 'guard' }
    expect(() => requireRole(actor, ['admin'] as const)).toThrow(ForbiddenError)
  })

  test('refuses everyone when the list is empty', () => {
    const actor: { role: Role } = { role: 'admin' }
    expect(() => requireRole(actor, [])).toThrow(ForbiddenError)
  })
})
