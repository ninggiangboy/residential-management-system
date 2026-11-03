import { expect, test } from 'bun:test'
import {
  INBOX_UNREAD_CAP,
  isPushRoute,
  NOTICE_TITLE_PUSH_MAX,
  NOTIFICATION_TEMPLATES,
  PARAM_NAMES,
  PUSH_CHUNK_SIZE_MAX,
  PUSH_ROUTES,
  PUSH_SAFE_PARAMS,
  SOURCE_KINDS,
  type SourceKind,
  TEMPLATE_KEYS,
} from './notification'

test('the catalog holds the 21 keys of DOC-31 §3.2, each once', () => {
  expect(TEMPLATE_KEYS).toHaveLength(21)
  expect(new Set(TEMPLATE_KEYS).size).toBe(21)
  expect(Object.keys(NOTIFICATION_TEMPLATES).sort()).toEqual([...TEMPLATE_KEYS].sort())
  for (const key of TEMPLATE_KEYS) expect(NOTIFICATION_TEMPLATES[key].key).toBe(key)
})

test('staff.invited is not a key (DR-116)', () => {
  expect(TEMPLATE_KEYS as readonly string[]).not.toContain('staff.invited')
  expect(Object.keys(NOTIFICATION_TEMPLATES)).not.toContain('staff.invited')
})

test('NT-04: every target route is in PUSH_ROUTES of its audience', () => {
  for (const key of TEMPLATE_KEYS) {
    const { audience, target } = NOTIFICATION_TEMPLATES[key]
    expect(isPushRoute(audience, target.route)).toBe(true)
  }
  expect(isPushRoute('resident', '/tickets')).toBe(false)
  expect(isPushRoute('staff', '/fees')).toBe(false)
})

test('NT-04: a route takes an entity only where the closed list of §6.5 says so', () => {
  for (const key of TEMPLATE_KEYS) {
    const { audience, target } = NOTIFICATION_TEMPLATES[key]
    const route = PUSH_ROUTES[audience].find((entry) => entry.route === target.route)
    expect(route).toBeDefined()
    if (target.entity === 'source') expect(route?.entity).toBe(true)
  }
})

test('payment.received pushes on channel urgent (DR-52)', () => {
  expect(NOTIFICATION_TEMPLATES['payment.received'].push).toEqual({ channel: 'urgent' })
})

test('staff.step_up_done and report.export_ready do not push (DOC-31 §3.2)', () => {
  expect(NOTIFICATION_TEMPLATES['staff.step_up_done'].push).toBe(false)
  expect(NOTIFICATION_TEMPLATES['report.export_ready'].push).toBe(false)
})

test('a pushed template declares only push-safe params (DR-52, FR-29.3)', () => {
  const safe = new Set<string>(PUSH_SAFE_PARAMS)
  for (const key of TEMPLATE_KEYS) {
    const def = NOTIFICATION_TEMPLATES[key]
    if (def.push === false) continue
    for (const param of def.params) expect(safe.has(param)).toBe(true)
  }
  expect(safe.has('action')).toBe(false)
  expect(safe.has('actorName')).toBe(false)
})

test('the source kinds, the param names and the caps of DOC-31 §9', () => {
  const kinds: readonly SourceKind[] = SOURCE_KINDS
  expect(kinds).toHaveLength(13)
  expect(PARAM_NAMES).toHaveLength(8)
  expect(INBOX_UNREAD_CAP).toBe(100)
  expect(PUSH_CHUNK_SIZE_MAX).toBe(100)
  expect(NOTICE_TITLE_PUSH_MAX).toBe(100)
})
