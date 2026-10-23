import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTORS } from './actors'
import type { Cell } from './matrix'
import type { RouteRecord } from './route-records'

/**
 * The artifacts of a run (DOC-39 §4.6): `authz-routes.json`, `authz-matrix.json` and `authz-matrix.md`. The CI job uploads them;
 * they are not committed (`out/` is ignored), unlike the result files of `bun run exp:10`.
 */
const OUT_DIR = resolve(import.meta.dir, 'out')

const AUDIENCE_CLASSES = [
  ['public', 'Public'],
  ['resident', 'Resident (token only)'],
  ['resident-unit', 'Resident with a capability'],
  ['staff', 'Staff'],
  ['webhook', 'Webhook'],
] as const

const classOf = (route: RouteRecord) =>
  route.audience.kind === 'resident' && route.audience.capability
    ? 'resident-unit'
    : route.audience.kind

/** One table per audience class: routes as rows, actors as columns, the actual status in each cell, a mismatch in bold (C6). */
function matrixMarkdown(routes: readonly RouteRecord[], cells: readonly Cell[]): string {
  const lines = ['# Authorization matrix', '']
  for (const [key, title] of AUDIENCE_CLASSES) {
    const rows = routes.filter((route) => classOf(route) === key)
    if (rows.length === 0) continue
    lines.push(
      `## ${title}`,
      '',
      `| Route | Scope | ${ACTORS.join(' | ')} |`,
      `| --- | --- | ${ACTORS.map(() => '---').join(' | ')} |`,
    )
    for (const route of rows)
      for (const scope of ['own', 'foreign'] as const) {
        const own = cells.filter((c) => c.endpointId === route.endpointId && c.scope === scope)
        if (own.length === 0) continue
        const text = ACTORS.map((actor) => {
          const cell = own.find((c) => c.actor === actor)
          if (!cell) return ''
          const shown = cell.ok
            ? `${cell.status}`
            : `**${cell.status} (want ${cell.expected}; ${cell.reason})**`
          return shown
        })
        lines.push(
          `| ${route.endpointId} \`${route.method} ${route.path}\` | ${scope} | ${text.join(' | ')} |`,
        )
      }
    lines.push('')
  }
  return lines.join('\n')
}

export function writeArtifacts(routes: readonly RouteRecord[], cells: readonly Cell[]): void {
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, 'authz-routes.json'), `${JSON.stringify(routes, null, 2)}\n`)
  writeFileSync(
    resolve(OUT_DIR, 'authz-matrix.json'),
    `${JSON.stringify(
      cells.map(({ endpointId, actor, scope, expected, status, code, ok }) => ({
        endpointId,
        actor,
        scope,
        expected,
        status,
        code,
        ok,
      })),
      null,
      2,
    )}\n`,
  )
  writeFileSync(resolve(OUT_DIR, 'authz-matrix.md'), `${matrixMarkdown(routes, cells)}\n`)
}
