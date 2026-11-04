import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { FakeStorage } from '@core/testing'
import { cloneTemplate, type TestDb } from '@rms/test-support'
import {
  api,
  seedBuilding,
  seedMembership,
  seedResidentAccount,
  seedStaff,
  seedUnit,
  signInResident,
  signInStaff,
} from './finance-support'
import { containerFor } from './support'

/**
 * The audience of every mounted finance route (DOC-39 §4, DOC-51 §2.2 and §11; P2-15): a staff token never passes a unit guard
 * and a resident token never passes a staff guard (FR-16.4); a Technician and a Guard are 403 on a staff route, and a Manager
 * and an Admin reach the handler (whatever the fake id answers next). Table-driven, one request per cell.
 *
 * The route list is read from the catalog §2.2 and §11. `E-101`, `E-102` and `E-103` (`/staff/debts`, `/staff/units/{id}/debt`,
 * `/staff/debts/reminders`) belong to the same group but no route file mounts them in this slice (P2-15), so they are absent.
 */

const BUILDING = '018f0000-0000-7000-8000-000000000041'
const ID = '0192f3c4-c001-7000-8000-0000000000aa'

interface Route {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly path: string
  readonly kind: 'staff' | 'unit'
}

/** E-80…E-84 (unit), then the staff routes E-89…E-110, E-170…E-172, E-176, E-177. */
const ROUTES: readonly Route[] = [
  { method: 'GET', path: '/me/fees', kind: 'unit' },
  { method: 'GET', path: `/me/fees/${ID}`, kind: 'unit' },
  { method: 'GET', path: '/me/fees/history', kind: 'unit' },
  { method: 'GET', path: '/me/receipts', kind: 'unit' },
  { method: 'GET', path: `/me/receipts/${ID}/pdf`, kind: 'unit' },
  { method: 'GET', path: '/staff/fee-batches', kind: 'staff' }, // E-89
  { method: 'POST', path: '/staff/fee-batches', kind: 'staff' }, // E-90
  { method: 'GET', path: `/staff/fee-batches/${ID}`, kind: 'staff' }, // E-91
  { method: 'PATCH', path: `/staff/fee-batches/${ID}`, kind: 'staff' }, // E-92
  { method: 'GET', path: `/staff/fee-batches/${ID}/charges`, kind: 'staff' }, // E-93
  { method: 'PUT', path: `/staff/charges/${ID}`, kind: 'staff' }, // E-94
  { method: 'POST', path: `/staff/fee-batches/${ID}/publish`, kind: 'staff' }, // E-95
  { method: 'POST', path: `/staff/fee-batches/${ID}/recall`, kind: 'staff' }, // E-96
  { method: 'POST', path: `/staff/fee-batches/${ID}/close`, kind: 'staff' }, // E-97
  { method: 'POST', path: `/staff/fee-batches/${ID}/reissue`, kind: 'staff' }, // E-98
  { method: 'POST', path: `/staff/fee-batches/${ID}/pdf`, kind: 'staff' }, // E-99
  { method: 'POST', path: `/staff/charges/${ID}/void`, kind: 'staff' }, // E-100
  { method: 'POST', path: '/staff/payments', kind: 'staff' }, // E-104
  { method: 'POST', path: `/staff/payments/${ID}/void`, kind: 'staff' }, // E-105
  { method: 'GET', path: `/staff/receipts/${ID}/pdf`, kind: 'staff' }, // E-106
  { method: 'GET', path: '/staff/money-log', kind: 'staff' }, // E-108
  { method: 'POST', path: `/staff/money-log/gateway_event/${ID}/review`, kind: 'staff' }, // E-109
  { method: 'GET', path: `/staff/units/${ID}/money-log`, kind: 'staff' }, // E-110
  { method: 'POST', path: `/staff/fee-batches/${ID}/charges`, kind: 'staff' }, // E-170
  { method: 'DELETE', path: `/staff/charges/${ID}`, kind: 'staff' }, // E-171
  { method: 'DELETE', path: `/staff/fee-batches/${ID}`, kind: 'staff' }, // E-172
  { method: 'GET', path: `/staff/charges/${ID}/pdf`, kind: 'staff' }, // E-176
  { method: 'GET', path: `/staff/fee-batches/${ID}/pdf`, kind: 'staff' }, // E-177
]

const staffRows = ROUTES.filter((route) => route.kind === 'staff')
const unitRows = ROUTES.filter((route) => route.kind === 'unit')

let db: TestDb
let built: ReturnType<typeof containerFor>
let app: ReturnType<typeof containerFor>['app']
let manager: string
let admin: string
let technician: string
let guard: string
let resident: string
let unitId: string

/** A body only for the methods with one; the guard runs before validation, so a fake body never changes the status. */
const initOf = (token: string | undefined, method: Route['method'], unit?: string) => ({
  method,
  ...(token ? { token } : {}),
  ...(unit ? { unit } : {}),
  ...(['POST', 'PUT', 'PATCH'].includes(method) ? { json: {} } : {}),
})

beforeAll(async () => {
  db = await cloneTemplate('empty')
  await seedBuilding(db, BUILDING, 'SUNRISE-AUTHZ')
  await seedStaff(db, { buildingId: BUILDING, email: 'manager@authz.example', role: 'manager' })
  await seedStaff(db, { buildingId: BUILDING, email: 'admin@authz.example', role: 'admin' })
  await seedStaff(db, { buildingId: BUILDING, email: 'tech@authz.example', role: 'technician' })
  await seedStaff(db, { buildingId: BUILDING, email: 'guard@authz.example', role: 'guard' })
  unitId = await seedUnit(db, { buildingId: BUILDING, code: 'A-1508' })
  const accountId = await seedResidentAccount(db, { phone: '+84907000901' })
  await seedMembership(db, {
    buildingId: BUILDING,
    accountId,
    unitId,
    memberType: 'owner',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })

  built = containerFor(db.url, { storage: new FakeStorage() })
  app = built.app
  manager = await signInStaff(app, 'manager@authz.example')
  admin = await signInStaff(app, 'admin@authz.example')
  technician = await signInStaff(app, 'tech@authz.example')
  guard = await signInStaff(app, 'guard@authz.example')
  resident = await signInResident(app, '+84907000901')
})
afterAll(async () => {
  await built.container.close()
  await db.drop()
})

describe('the finance audience matrix (DOC-39 §4, FR-16.4)', () => {
  test('no token is 401 on every finance route', async () => {
    for (const route of ROUTES) {
      const res = await api(app, route.path, initOf(undefined, route.method))
      expect({ path: route.path, status: res.status }).toEqual({ path: route.path, status: 401 })
    }
  })

  test('a resident token is 401/403 on every staff route, the same answer for all', async () => {
    const seen = new Set<number>()
    for (const route of staffRows) {
      const res = await api(app, route.path, initOf(resident, route.method, unitId))
      seen.add(res.status)
    }
    expect(seen.size).toBe(1)
    expect([401, 403]).toContain([...seen][0] ?? 0)
  })

  test('a Technician and a Guard are 403 on every staff route', async () => {
    for (const route of staffRows) {
      for (const token of [technician, guard]) {
        const res = await api(app, route.path, initOf(token, route.method))
        expect({ path: route.path, status: res.status }).toEqual({ path: route.path, status: 403 })
      }
    }
  })

  test('a Manager and an Admin pass the guard on every staff route (never 401/403)', async () => {
    for (const route of staffRows) {
      for (const token of [manager, admin]) {
        const res = await api(app, route.path, initOf(token, route.method))
        expect({ path: route.path, status: res.status }).not.toEqual({
          path: route.path,
          status: 401,
        })
        expect({ path: route.path, status: res.status }).not.toEqual({
          path: route.path,
          status: 403,
        })
      }
    }
  })

  test('a staff token is 401/403 on every /me route, the same answer for all', async () => {
    const seen = new Set<number>()
    for (const route of unitRows) {
      for (const token of [manager, admin, technician, guard]) {
        const res = await api(app, route.path, initOf(token, route.method, unitId))
        seen.add(res.status)
      }
    }
    expect(seen.size).toBe(1)
    expect([401, 403]).toContain([...seen][0] ?? 0)
  })

  test('a resident passes the unit guard on its own unit', async () => {
    for (const route of unitRows) {
      const res = await api(app, route.path, initOf(resident, route.method, unitId))
      expect({ path: route.path, status: res.status }).not.toEqual({
        path: route.path,
        status: 401,
      })
      expect({ path: route.path, status: res.status }).not.toEqual({
        path: route.path,
        status: 403,
      })
    }
  })
})
