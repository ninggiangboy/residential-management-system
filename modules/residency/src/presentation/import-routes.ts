import {
  describedEnum,
  type Idempotent,
  IdParams,
  type RouteInfo,
  type RouteSet,
  routePlugin,
  staffRoute,
  strictObject,
} from '@core/http'
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
  idempotent: Idempotent
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const IMPORT_KIND = describedEnum(
  {
    unit_owner: 'Units and their owners',
    fee_batch: 'A batch of fees',
  },
  'What the file holds.',
)
const IMPORT_STATUS = describedEnum(
  {
    validated: 'The file was checked and the preview can still be committed',
    failed: 'The file could not be read',
    committed: 'The valid rows were saved',
    expired: 'The preview was not committed in time; upload the file again',
  },
  'The state of the import job.',
)

const KindParams = strictObject({
  kind: Type.String({
    description:
      'The kind of import: `unit_owner` or `fee_batch`. Any other value is 404 `not_found`',
  }),
})
const CreateBody = strictObject({
  kind: IMPORT_KIND,
  fileId: Type.String({
    format: 'uuid',
    description:
      'A verified upload of the purpose `import`, registered by the caller for the module of the kind. Otherwise 422 `file_not_verified`',
  }),
  /** The name of the file as the browser knows it: the upload flow keeps none (DR-258). */
  fileName: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 255,
      description: 'The name of the file as the browser knows it, shown in the import history',
    }),
  ),
  params: Type.Optional(
    strictObject({}, { description: 'Extra parameters of the kind. `unit_owner` takes none' }),
  ),
})
const ListQuery = strictObject({
  kind: Type.Optional(IMPORT_KIND),
  status: Type.Optional(IMPORT_STATUS),
  cursor: Type.Optional(
    Type.String({
      maxLength: 200,
      description:
        'The `next` cursor of the previous page. Opaque; one that does not decode is 400 `invalid_cursor`',
    }),
  ),
  limit: Type.Optional(
    Type.String({ pattern: '^[0-9]{1,3}$', description: 'Rows per page, 1…100 (default 20)' }),
  ),
})

/** The key belongs to the staff account (DOC-50 §8.3). */
const staffAccount = (context: object) => ({
  kind: 'staff' as const,
  id: staffOf(context).staffId as string,
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
 * E-72 takes an `Idempotency-Key` (DOC-50 §8, P1-28) in the `external` mode: the validation reads the bucket, so the key is committed
 * `in_progress` before and completed after, and a retry replays the first preview, `Location` included.
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
    const job = await d.validate.execute(staffOf(context), {
      fileId: context.body.fileId,
      fileName: context.body.fileName,
    })
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

  const read = (info: RouteInfo) => staffRoute(d.guards, 'residency', IMPORT_READ_ROLES, info)

  return routePlugin({ prefix: '/staff/imports' })
    .get('/templates/:kind', template, {
      ...read({
        endpoint: 'E-71',
        operationId: 'downloadImportTemplate',
        summary: 'Download an import template',
        description: 'Downloads the Excel template for an import of the given kind.',
      }),
      params: KindParams,
    })
    .post('/', d.idempotent({ account: staffAccount, mode: 'external' }, create), {
      ...staffRoute(d.guards, 'residency', VALIDATE_UNIT_OWNER_IMPORT_ROLES, {
        endpoint: 'E-72',
        operationId: 'createImport',
        summary: 'Validate an import file',
        description:
          'Validates an uploaded Excel file synchronously and stores the preview for the commit. Nothing is written to the unit tables here. Needs an `Idempotency-Key`.',
        idempotent: true,
      }),
      body: CreateBody,
    })
    .get('/', list, {
      ...read({
        endpoint: 'E-169',
        operationId: 'listImports',
        summary: 'List imports',
        description:
          'The earlier import jobs of the building, newest first, so the manager can reopen a preview that is still valid and see who imported what and when.',
      }),
      query: ListQuery,
    })
    .get('/:id', get, {
      ...read({
        endpoint: 'E-73',
        operationId: 'getImport',
        summary: 'Get an import',
        description: 'Reopens a preview or reads the result of a commit.',
      }),
      params: IdParams,
    })
    .post('/:id/commit', commit, {
      ...staffRoute(d.guards, 'residency', COMMIT_UNIT_OWNER_IMPORT_ROLES, {
        endpoint: 'E-74',
        operationId: 'commitImport',
        summary: 'Commit an import',
        description:
          'Saves the valid rows in one transaction: creates or updates the units, the resident profiles and the owner memberships. Rows with an error are skipped. No invitation SMS is sent.',
      }),
      params: IdParams,
    })
}
