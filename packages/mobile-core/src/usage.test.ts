import { describe, expect, test } from 'bun:test'
import type { SecureStorage } from './storage'
import { createMobileUsage, homeScreenOf, screenOfSegments, usagePath } from './usage'

const memory = (
  seed: Record<string, string> = {},
): SecureStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(seed))
  return {
    data,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
    getSync: (key) => data.get(key) ?? null,
    setSync: (key, value) => void data.set(key, value),
  }
}

function build(
  over: {
    app?: 'resident' | 'staff'
    unit?: string | null
    seed?: Record<string, string>
    answer?: () => Response
  } = {},
) {
  const storage = memory(over.seed)
  const calls: Array<{ url: string; init: RequestInit }> = []
  let ids = 0
  const usage = createMobileUsage({
    app: over.app ?? 'resident',
    platform: 'ios',
    appVersion: '1.0.3',
    apiBaseUrl: 'http://api.test/api/v1',
    storage,
    unitId: () => (over.unit === undefined ? 'unit-1' : over.unit),
    randomId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
    authenticatedFetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return over.answer ? over.answer() : new Response(null, { status: 204 })
    }) as unknown as typeof fetch,
  })
  return { usage, calls, storage }
}

describe('the routes of the batch (DOC-104 §6.1)', () => {
  test('the resident app calls E-173 and the staff app E-174', () => {
    expect(usagePath('resident')).toBe('/me/usage-events')
    expect(usagePath('staff')).toBe('/staff/usage-events')
  })

  test('one POST holds the batch, as JSON, with no idempotency key', async () => {
    const { usage, calls } = build()
    usage.setSignedIn(true)
    usage.foreground(true)
    usage.screen('Main')
    usage.foreground(false)
    await usage.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('http://api.test/api/v1/me/usage-events')
    expect(calls[0]?.init.method).toBe('POST')
    expect(new Headers(calls[0]?.init.headers).has('idempotency-key')).toBe(false)
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body).toMatchObject({ app: 'resident', platform: 'ios', appVersion: '1.0.3' })
    expect(body.events.map((event: { event: string }) => event.event)).toEqual([
      'app_open',
      'screen_view',
      'app_close',
    ])
  })

  test('UA-30 the header X-Usage-Enabled: false stops the tracker for the launch', async () => {
    const { usage, calls } = build({
      answer: () => new Response(null, { status: 204, headers: { 'x-usage-enabled': 'false' } }),
    })
    usage.setSignedIn(true)
    usage.foreground(true)
    await usage.flush()
    usage.screen('Main')
    await usage.flush()
    expect(calls).toHaveLength(1)
    expect(usage.queued()).toBe(0)
  })

  test('the resident app keeps its events while no unit is chosen; the staff app needs none', async () => {
    const resident = build({ unit: null })
    resident.usage.setSignedIn(true)
    resident.usage.foreground(true)
    await resident.usage.flush()
    expect(resident.calls).toHaveLength(0)
    expect(resident.usage.queued()).toBe(1)
    const staff = build({ app: 'staff', unit: null })
    staff.usage.setSignedIn(true)
    staff.usage.foreground(true)
    await staff.usage.flush()
    expect(staff.calls[0]?.url).toBe('http://api.test/api/v1/staff/usage-events')
  })
})

describe('UA-26 the switch on the device', () => {
  test('the choice is stored under usage.enabled and read back after a restart; the default is on', () => {
    const first = build()
    expect(first.usage.isEnabled()).toBe(true)
    first.usage.setEnabled(false)
    expect(first.storage.data.get('usage.enabled')).toBe('0')
    expect(build({ seed: { 'usage.enabled': '0' } }).usage.isEnabled()).toBe(false)
    expect(build({ seed: { 'usage.enabled': '1' } }).usage.isEnabled()).toBe(true)
  })

  test('another account that signs in on the device inherits the choice (it is not per account)', () => {
    const { usage } = build()
    usage.setEnabled(false)
    usage.setSignedIn(true)
    usage.setSignedIn(false)
    usage.setSignedIn(true)
    expect(usage.isEnabled()).toBe(false)
  })
})

describe('the route-to-screen map (DOC-104 §5.1)', () => {
  const map = { account: 'Account', 'account/sessions': 'Sessions', contact: 'Contact' } as const

  test('groups are left out and a route that is not in the map is not tracked', () => {
    expect(screenOfSegments(map, ['(app)', 'account'])).toBe('Account')
    expect(screenOfSegments(map, ['(app)', 'account', 'sessions'])).toBe('Sessions')
    expect(screenOfSegments(map, ['contact'])).toBe('Contact')
    expect(screenOfSegments(map, ['(auth)'])).toBeNull()
    expect(screenOfSegments(map, ['unit-pick'])).toBeNull()
    expect(screenOfSegments(map, ['terms'])).toBeNull()
  })

  test('a parameter is a placeholder of the route and never reaches the id', () => {
    expect(screenOfSegments(map, ['(app)', 'account', '[id]'])).toBeNull()
  })
})

describe('the home screen of a member type (DOC-57)', () => {
  test('each member type reads its own section; a tenant by whether it may pay', () => {
    expect(homeScreenOf({ memberType: 'owner', canPay: true })).toBe('Main')
    expect(homeScreenOf({ memberType: 'family', canPay: false })).toBe('Home-Member')
    expect(homeScreenOf({ memberType: 'tenant', canPay: true })).toBe('Home-Tenant-Pay')
    expect(homeScreenOf({ memberType: 'tenant', canPay: false })).toBe('Home-Tenant-NoPay')
    expect(homeScreenOf({ memberType: 'helper', canPay: false })).toBe('Home-Helper')
  })
})
