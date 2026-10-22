import { appendFileSync } from 'node:fs'

/** Appends Markdown to the job summary of GitHub Actions; a no-op outside CI. */
export function writeSummary(markdown: string) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (file) appendFileSync(file, `${markdown}\n`)
}

/** A workflow command annotation (`::warning title=…::message`); plain text outside CI reads the same. */
export function annotate(level: 'error' | 'warning' | 'notice', title: string, message: string) {
  console.log(`::${level} title=${title}::${message}`)
}

/** A Markdown table from a header row and body rows. */
export function markdownTable(header: string[], rows: (string | number)[][]) {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}
