import { expect, test } from 'bun:test'
import { type CsvIssue, errorsCsv } from './csv'

test('UIWR-38: the error list is a CSV with a BOM, quoted cells and one line per issue', () => {
  const issues = [
    {
      row: 3,
      unitCode: 'A-0101',
      column: 'floor',
      severity: 'error',
      message: 'Floor "21" is wrong, fix it',
    },
    { row: 9, unitCode: null, column: null, severity: 'warning', message: 'Careful' },
  ] as CsvIssue[]
  const csv = errorsCsv(issues, (column) => (column === 'floor' ? 'Tầng' : ''))
  expect(csv.startsWith('﻿')).toBe(true)
  expect(csv.split('\r\n')).toEqual([
    '﻿row,unit_code,column,severity,message',
    '"3","A-0101","Tầng","error","Floor ""21"" is wrong, fix it"',
    '"9","","","warning","Careful"',
    '',
  ])
})
