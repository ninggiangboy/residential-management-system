export interface CsvIssue {
  row: number
  unitCode: string | null
  column: string | null
  severity: string
  message: string
}

/** The error list built in the browser (DR-213): UTF-8 with a BOM, columns row, unit code, column, severity, message. */
export function errorsCsv(
  issues: readonly CsvIssue[],
  columnLabel: (column: string | null) => string,
): string {
  const quote = (value: string | number | null) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const rows = issues.map((issue) =>
    [issue.row, issue.unitCode, columnLabel(issue.column), issue.severity, issue.message]
      .map(quote)
      .join(','),
  )
  return `﻿${['row,unit_code,column,severity,message', ...rows].join('\r\n')}\r\n`
}
