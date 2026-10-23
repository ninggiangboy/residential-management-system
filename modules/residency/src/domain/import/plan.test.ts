import { describe, expect, test } from 'bun:test'
import { LibphonenumberPhoneParser } from '../../infrastructure/phone/libphonenumber-phone-parser'
import { checkSet, classify, type Lookups, type StoredUnit } from './plan'
import { parseRow } from './row-rules'
import { readSheet } from './sheet'
import { HEADER_ROW } from './test-fixtures'

const context = { today: '2026-10-19', phones: new LibphonenumberPhoneParser() }

const AN = 'account-an'
const BINH = 'account-binh'
const CUONG = 'account-cuong'
const DUNG = 'account-dung'

/** The sample building of DOC-18 §1.6. */
function sampleLookups(): Lookups {
  const unit = (code: string, ownerAccountId: string | null): [string, StoredUnit] => [
    code.toLowerCase(),
    { unitId: `unit-${code}`, code, occupancy: 'occupied', ownerAccountId },
  ]
  return {
    units: new Map([
      unit('A-1508', AN),
      unit('A-1509', null),
      unit('A-1510', CUONG),
      unit('A-1512', null),
    ]),
    accounts: new Map([
      ['+84901234567', { accountId: AN }],
      ['+84912345678', { accountId: BINH }],
      ['+84934567890', { accountId: DUNG }],
    ]),
    members: new Set([`unit-A-1512|${DUNG}`]),
    profiles: new Map([
      [
        AN,
        {
          accountId: AN,
          fullName: 'Nguyễn Văn An',
          email: 'an@example.com',
          cccdLast4: '2345',
          dateOfBirth: '1985-04-03',
        },
      ],
    ]),
  }
}

const sample = [
  ['A-1508', 'Nguyễn Văn An', '0901234567'],
  ['A-1509', 'Trần Thị Bình', '0912345678'],
  ['A-1510', 'Phạm Thị Dung', '0934567890'],
  ['A-1511', 'Võ Thị Hà', '0956789012'],
  ['A-1512', 'Phạm Thị Dung', '0934567890'],
  ['A-1513', 'Ngô Văn Khoa', '0901234567'],
  ['a-1508', '', ''],
] as const

function planOf(rows: readonly (readonly string[])[], lookups = sampleLookups()) {
  const sheet = readSheet({
    headers: HEADER_ROW,
    rows: rows.map((cells, index) => ({
      row: index + 2,
      cells: [cells[0] ?? null, null, null, null, null, cells[1] ?? null, cells[2] ?? null].map(
        (cell) => (cell === '' ? null : cell),
      ),
    })),
  })
  if (!sheet.ok) throw new Error('unreadable')
  const parsed = sheet.rows.map((row) => parseRow(row, context))
  const set = checkSet(parsed)
  return classify({
    rowCount: parsed.length,
    survivors: set.survivors,
    earlierIssues: [...parsed.flatMap((row) => row.issues), ...set.issues],
    lookups,
  })
}

describe('IM-29 the sample file of DOC-18 §1.6', () => {
  const plan = planOf(sample)
  test('the counts', () => {
    expect(plan.preview.counts).toEqual({
      rows: 7,
      valid: 3,
      errors: 4,
      warnings: 0,
      unitsToCreate: 1,
      unitsToUpdate: 2,
      accountsToCreate: 1,
      accountsLinked: 2,
      ownersToAdd: 2,
      ownersUnchanged: 1,
    })
  })
  test('the outcome of each row', () => {
    const errors = plan.preview.issues.map((issue) => [issue.row, issue.code])
    expect(errors).toEqual([
      [4, 'owner_conflict'],
      [6, 'owner_is_member'],
      [7, 'phone_conflict'],
      [8, 'unit_code_duplicate'],
    ])
    expect(plan.preview.validRows.map((row) => [row.row, row.notes.map((n) => n.code)])).toEqual([
      [2, ['unit_will_update', 'account_linked']],
      [3, ['unit_will_update', 'account_linked']],
      [5, ['unit_will_create', 'account_will_be_created']],
    ])
  })
  test('the duplicate points at the first row (IM-19)', () => {
    const duplicate = plan.preview.issues.find((issue) => issue.code === 'unit_code_duplicate')
    expect(duplicate?.params).toEqual({ code: 'A-1508', firstRow: 2 })
  })
  test('IM-24 the owner with the same phone is unchanged; IM-23 another owner conflicts', () => {
    expect(plan.rows.find((r) => r.parsed.row === 2)?.owner?.action).toBe('unchanged')
    expect(plan.rows.find((r) => r.parsed.row === 3)?.owner?.action).toBe('add')
  })
})

describe('IM-20 IM-21 one phone, one person', () => {
  test('the same phone with another name: the later row is phone_conflict', () => {
    const plan = planOf([
      ['B-1', 'Nguyễn Văn An', '0988000111'],
      ['B-2', 'Lê Thị Cúc', '0988000111'],
    ])
    expect(plan.preview.issues.map((i) => [i.row, i.code, i.params])).toEqual([
      [3, 'phone_conflict', { firstRow: 2 }],
    ])
  })
  test('the same phone and the same name folded: both valid, one account created', () => {
    const plan = planOf([
      ['B-1', 'Nguyễn Văn An', '0988000111'],
      ['B-2', 'NGUYEN  VAN AN', '0988000111'],
    ])
    expect(plan.preview.counts).toMatchObject({
      valid: 2,
      errors: 0,
      accountsToCreate: 1,
      ownersToAdd: 2,
    })
  })
})

describe('IM-27 a stored profile that differs', () => {
  test('a warning per differing field and the row stays valid', () => {
    const lookups = sampleLookups()
    const plan = planOf([['A-1508', 'Nguyễn Văn Anh', '0901234567']], lookups)
    expect(plan.preview.issues.map((i) => [i.code, i.severity, i.params])).toEqual([
      ['profile_field_differs', 'warning', { field: 'owner_name' }],
    ])
    expect(plan.preview.counts).toMatchObject({ valid: 1, warnings: 1 })
  })
})

describe('IM-31 more than 500 issues', () => {
  test('500 are listed, the counts are complete', () => {
    const rows = Array.from({ length: 600 }, (_, i) => [`C-${i}`, 'An', 'not a phone'])
    const { preview } = planOf(rows)
    expect(preview.issues).toHaveLength(500)
    expect(preview.issuesTruncated).toBe(true)
    expect(preview.counts).toMatchObject({ rows: 600, errors: 600, valid: 0 })
  })
})

describe('IM-32 the preview holds no ID number and no date of birth', () => {
  test('the valid row lists the number masked and nothing else personal', () => {
    const sheet = readSheet({
      headers: HEADER_ROW,
      rows: [
        {
          row: 2,
          cells: [
            'D-1',
            null,
            null,
            null,
            null,
            'An Nguyen',
            '0901234567',
            null,
            '079085012345',
            '03/04/1985',
          ],
        },
      ],
    })
    if (!sheet.ok) throw new Error('unreadable')
    const plan = classify({
      rowCount: 1,
      survivors: sheet.rows.map((row) => parseRow(row, context)),
      earlierIssues: [],
      lookups: { units: new Map(), accounts: new Map(), members: new Set(), profiles: new Map() },
    })
    const stored = JSON.stringify(plan.preview)
    expect(plan.preview.validRows[0]?.ownerIdNumber).toBe('•••• 2345')
    expect(stored).not.toContain('079085012345')
    expect(stored).not.toContain('1985')
  })
})
