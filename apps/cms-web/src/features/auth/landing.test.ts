import { expect, test } from 'bun:test'
import { isWebRole, landingFor } from './landing'

test('Admin and Manager land on /units or on the destination; Technician and Guard on /wrong-app (DR-174)', () => {
  expect(landingFor('manager', undefined)).toBe('/units')
  expect(landingFor('admin', '/staff?page=2')).toBe('/staff?page=2')
  expect(landingFor('technician', '/units')).toBe('/wrong-app')
  expect(landingFor('guard', undefined)).toBe('/wrong-app')
  expect(
    ['admin', 'manager', 'technician', 'guard'].filter((role) => isWebRole(role as never)),
  ).toEqual(['admin', 'manager'])
})
