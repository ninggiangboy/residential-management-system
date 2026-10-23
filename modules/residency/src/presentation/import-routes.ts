import { IdParams, type RouteSet, routePlugin, staffRoute, strictObject } from '@core/http'
import { NotFoundError, ValidationError } from '@core/kernel'
import { createTranslator, isMessageKey } from '@rms/i18n-catalog'
import { type Guards, type Language, staffOf } from '@rms/shared-types'
import { type Static, Type } from '@sinclair/typebox'
import { IMPORT_READ_ROLES, type ImportQueries } from '../application/queries/import-queries'
import {
  COMMIT_UNIT_OWNER_IMPORT_ROLES,
  type CommitUnitOwnerImport,
} from '../application/use-cases/commit-unit-owner-import'
import {
  VALIDATE_UNIT_OWNER_IMPORT_ROLES,
  type ValidateUnitOwnerImport,
} from '../application/use-cases/validate-unit-owner-import'
import { isUnitOwnerColumn, TEMPLATE_HEADERS } from '../domain/import/columns'
import type { ImportIssue, PreviewNote } from '../domain/import/types'
import type { CommittedCounts, ImportJobRecord } from '../domain/import-job'
import type { ImportJobCursor } from '../domain/import-job-repository'

export interface ImportRouteDeps {
  queries: ImportQueries
  validate: ValidateUnitOwnerImport
  commit: CommitUnitOwnerImport
  guards: Guards
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const KINDS = ['unit_owner', 'fee_batch'] as const
const STATUSES = ['validated', 'failed', 'committed', 'expired'] as const

const KindParams = strictObject({ kind: Type.String() })
const CreateBody = strictObject({
  kind: Type.Union(KINDS.map((kind) => Type.Literal(kind))),
  fileId: Type.String({ format: 'uuid' }),
  params: Type.Optional(strictObject({})),
})
const ListQuery = strictObject({
  kind: Type.Optional(Type.Union(KINDS.map((kind) => Type.Literal(kind)))),
  status: Type.Optional(Type.Union(STATUSES.map((status) => Type.Literal(status)))),
  cursor: Type.Optional(Type.String({ maxLength: 200 })),
  limit: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}$' })),
})

/** `en` when the caller asks for it; Vietnamese otherwise (DR-71), as `GET /me/terms` does. */
const languageOf = (header: string | null): Language =>
  header?.trim().toLowerCase().startsWith('en') ? 'en' : 'vi'

/** The opaque cursor of DOC-50 §10: the key of the last row of the page. */
const encodeCursor = ({ createdAt, id }: ImportJobCursor) =>
  Buffer.from(JSON.stringify({ t: createdAt.toISOString(), i: id })).toString('base64url')

function decodeCursor(cursor: string): ImportJobCursor {
  try {
    const { t, i } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t: string
      i: string
    }
    const createdAt = new Date(t)
    if (Number.isNaN(createdAt.getTime()) || typeof i !== 'string') throw new Error('bad cursor')
    return { createdAt, id: i }
  } catch {
    throw new ValidationError([], 'invalid_cursor', 'The cursor is not valid')
  }
}

/** Renders `{code, params}` as the text of the language; a column or field name is shown as the header the Manager sees. */
function messenger(lang: Language) {
  const t = createTranslator(lang)
  return (code: string, params: Record<string, string | number>) => {
    const key = `common.import.${code}`
    if (!isMessageKey(key)) return code
    const shown = Object.fromEntries(
      Object.entries(params).map(([name, value]) => [
        name,
        (name === 'column' || name === 'field') &&
        typeof value === 'string' &&
        isUnitOwnerColumn(value)
          ? TEMPLATE_HEADERS[lang][value]
          : value,
      ]),
    )
    return t(key, shown)
  }
}

function jobBody(job: ImportJobRecord, committed: CommittedCounts | null, lang: Language) {
  const message = messenger(lang)
  const { counts, validRows, issues, issuesTruncated } = job.result
  const note = (n: PreviewNote) => ({ ...n, message: message(n.code, n.params) })
  const issue = (i: ImportIssue) => ({ ...i, message: message(i.code, i.params) })
  return {
    importId: job.id,
    kind: job.kind,
    status: job.status,
    fileName: job.fileName,
    createdAt: job.createdAt.toISOString(),
    expiresAt: job.expiresAt.toISOString(),
    committedAt: job.committedAt?.toISOString() ?? null,
    committed,
    preview: {
      counts,
      validRows: validRows.map((row) => ({ ...row, notes: row.notes.map(note) })),
      issues: issues.map(issue),
      issuesTruncated,
    },
  }
}

/**
 * `/staff/imports` (E-71…E-74, E-169; DOC-27 §9, DOC-18 §1): the template, the synchronous validation that stores the preview, the
 * preview again, the commit and the history. `kind` selects the module; `unit_owner` is `residency`'s, `fee_batch` waits for
 * `finance` (P2-04) and is 404 on the template and 400 on the body until then. Every handler is the call of a use case or a query.
 * The `Idempotency-Key` of E-72 joins with the idempotency plugin of DOC-50 §8; until then a retried request validates the file
 * again and makes a second job, which expires on its own.
 */
export function importRoutes(d: ImportRouteDeps) {
  const template = async (context: { params: Static<typeof KindParams>; request: Request }) => {
    if (context.params.kind !== 'unit_owner') throw new NotFoundError()
    const language = languageOf(context.request.headers.get('accept-language'))
    const bytes = await d.queries.template(staffOf(context), language)
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': XLSX,
        'content-disposition': `attachment; filename="unit-owner-template-${language}.xlsx"`,
        'cache-control': 'no-store',
      },
    })
  }

  const create = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    if (context.body.kind !== 'unit_owner')
      throw new ValidationError([
        { path: 'kind', code: 'unsupported', message: 'not available yet' },
      ])
    const job = await d.validate.execute(staffOf(context), { fileId: context.body.fileId })
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/imports/${job.id}`
    return jobBody(job, null, languageOf(context.request.headers.get('accept-language')))
  }

  const get = async (context: { params: Static<typeof IdParams>; request: Request }) => {
    const { job, committed } = await d.queries.get(staffOf(context), context.params.id)
    return jobBody(job, committed, languageOf(context.request.headers.get('accept-language')))
  }

  const commit = async (context: { params: Static<typeof IdParams> }) => {
    const { job, committed } = await d.commit.execute(staffOf(context), context.params.id)
    return {
      importId: job.id,
      status: 'committed' as const,
      committedAt: job.committedAt?.toISOString() ?? null,
      committed,
    }
  }

  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const { kind, status, cursor, limit } = context.query
    if (kind === 'fee_batch')
      throw new ValidationError([
        { path: 'kind', code: 'unsupported', message: 'not available yet' },
      ])
    const size = limit === undefined ? 20 : Number(limit)
    if (size < 1 || size > 100)
      throw new ValidationError([{ path: 'limit', code: 'range', message: '1 to 100' }])
    const page = await d.queries.list(staffOf(context), {
      kind: 'unit_owner',
      status,
      after: cursor === undefined ? undefined : decodeCursor(cursor),
      limit: size,
    })
    return {
      items: page.items.map((row) => ({
        importId: row.id,
        kind: row.kind,
        status: row.status,
        fileName: row.fileName,
        counts: {
          rows: row.counts.rows,
          valid: row.counts.valid,
          errors: row.counts.errors,
          warnings: row.counts.warnings,
        },
        createdBy: { staffId: row.createdBy, name: row.createdByName },
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        committedAt: row.committedAt?.toISOString() ?? null,
      })),
      nextCursor: page.next ? encodeCursor(page.next) : null,
    }
  }

  const read = staffRoute(d.guards, 'residency', IMPORT_READ_ROLES)
  const create_ = staffRoute(d.guards, 'residency', VALIDATE_UNIT_OWNER_IMPORT_ROLES)
  const commit_ = staffRoute(d.guards, 'residency', COMMIT_UNIT_OWNER_IMPORT_ROLES)

  return routePlugin({ prefix: '/staff/imports' })
    .get('/templates/:kind', template, { ...read, params: KindParams })
    .post('/', create, { ...create_, body: CreateBody })
    .get('/', list, { ...read, query: ListQuery })
    .get('/:id', get, { ...read, params: IdParams })
    .post('/:id/commit', commit, { ...commit_, params: IdParams })
}
