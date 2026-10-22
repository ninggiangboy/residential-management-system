import { describe, expect, test } from 'bun:test'
import { CATALOGS, isMessageKey } from '@rms/i18n-catalog'
import { STATUS_ENUMS } from '@rms/shared-types'
import { ICON_NAMES, TONES } from './icons'
import { STATUS_ROWS, statusRow } from './status'

/** Presentations of derived values that are not a status column (DOC-54 §6). */
const DERIVED = new Set(['money_log', 'ticket_flag', 'import_preview', 'setting'])

describe('DS-04 and UICP-04: every status value has a presentation and a label in both languages', () => {
  test.each(Object.entries(STATUS_ENUMS))('%s', (entity, values) => {
    for (const value of values)
      expect([value, STATUS_ROWS.some((r) => r.entity === entity && r.value === value)]).toEqual([
        value,
        true,
      ])
  })

  test('each row has a known entity and value, a tone of the five, a registered icon and catalog keys', () => {
    const enums = STATUS_ENUMS as Record<string, readonly string[]>
    for (const row of STATUS_ROWS) {
      const known = DERIVED.has(row.entity) || enums[row.entity]?.includes(row.value)
      expect([row.entity, row.value, known]).toEqual([row.entity, row.value, true])
      expect(TONES).toContain(row.tone)
      if (row.icon !== null) expect(ICON_NAMES).toContain(row.icon)
      for (const key of [row.label, ...(row.detail ? [row.detail] : [])]) {
        expect([key, isMessageKey(key)]).toEqual([key, true])
        expect(CATALOGS.vi[key as never]).toBeTruthy()
      }
    }
  })

  test('one value has one row per audience and condition', () => {
    const seen = STATUS_ROWS.map((r) => `${r.entity}.${r.value}.${r.when ?? ''}.${r.audience}`)
    expect(seen.length).toBe(new Set(seen).size)
  })
})

test('tone follows the viewer: a pending vehicle needs the Manager, the resident only waits (DR-183)', () => {
  expect(statusRow('vehicle', 'pending', 'staff')?.tone).toBe('warning')
  expect(statusRow('vehicle', 'pending', 'resident')?.tone).toBe('neutral')
  expect(statusRow('ticket', 'resolved', 'resident')?.label).toBe(
    'status.ticket-resident.processing',
  )
  expect(statusRow('charge', 'open', 'resident', 'overdue')?.tone).toBe('danger')
  expect(statusRow('membership', 'locked', 'staff')?.label).toBe('status.membership.locked')
})
