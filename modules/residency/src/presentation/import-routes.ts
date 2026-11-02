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
import type { ImportHandler } from '../contracts'
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
  /** The handlers of the kinds other modules own (DR-149), read at request time: the host builds them after `residency`. */
  importHandlers: () => readonly ImportHandler[]
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
    strictObject(
      {
        batchId: Type.Optional(
          Type.String({
            format: 'uuid',
            description:
              'Required for `fee_batch`: the draft batch the file fills (DOC-21 §4.1). Another building’s or an unknown batch is 404, one that is not a draft 409 `invalid_transition`',
          }),
        ),
      },
      { description: 'Extra parameters of the kind. `unit_owner` takes none' },
    ),
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
 * preview again, the commit and the history. `kind` selects the module (DR-149): `unit_owner` is `residency`'s, `fee_batch` is
 * `finance`'s through the `ImportHandler` the host hands over (P2-04). Every handler is the call of a use case, a query or a handler.
 * E-72 takes an `Idempotency-Key` (DOC-50 §8, P1-28) in the `external` mode: the validation reads the bucket, so the key is committed
 * `in_progress` before and completed after, and a retry replays the first preview, `Location` included.
 */
export function importRoutes(d: ImportRouteDeps) {
  const handlerOf = (kind: string | undefined) =>
    d.importHandlers().find((handler) => handler.kind === kind)

  /** E-73 and E-74 get only an id: `residency`'s table first, then each handler in turn (DR-149, UUIDv7 in two tables). */
  async function byId<A, B>(
    own: () => Promise<A>,
    other: (h: ImportHandler) => Promise<B | null>,
  ): Promise<A | B> {
    try {
      return await own()
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error
    }
    for (const handler of d.importHandlers()) {
      const found = await other(handler)
      if (found !== null) return found
    }
    throw new NotFoundError()
  }

  const template = async (context: { params: Static<typeof KindParams>; request: Request }) => {
    const language = languageOf(context.request.headers.get('accept-language'))
    const staff = staffOf(context)
    const handler = handlerOf(context.params.kind)
    if (context.params.kind !== 'unit_owner' && !handler) throw new NotFoundError()
    const { bytes, fileName } = handler
      ? await handler.template(staff, language)
      : {
          bytes: await d.queries.template(staff, language),
          fileName: `unit-owner-template-${language}.xlsx`,
        }
    return new Response(Buffer.from(bytes), {
      headers: {
        'content-type': XLSX,
        'content-disposition': `attachment; filename="${fileName}"`,
        'cache-control': 'no-store',
      },
    })
  }

  const create = async (context: {
    body: Static<typeof CreateBody>
    request: Request
    set: RouteSet
  }) => {
    const { kind, fileId, fileName, params } = context.body
    const language = languageOf(context.request.headers.get('accept-language'))
    const body = await (kind === 'unit_owner'
      ? validateUnitOwner(staffOf(context), { fileId, fileName, params }, language)
      : validateOther(staffOf(context), kind, { fileId, fileName, params }, language))
    context.set.status = 201
    context.set.headers.location = `/api/v1/staff/imports/${body.importId}`
    return body
  }

  type CreateInput = Pick<Static<typeof CreateBody>, 'fileId' | 'fileName' | 'params'>

  async function validateUnitOwner(
    staff: ReturnType<typeof staffOf>,
    input: CreateInput,
    language: Language,
  ) {
    if (input.params?.batchId !== undefined)
      throw new ValidationError([
        { path: 'params.batchId', code: 'unsupported', message: '`unit_owner` takes no batch' },
      ])
    const job = await d.validate.execute(staff, { fileId: input.fileId, fileName: input.fileName })
    return jobBody(job, null, language)
  }

  async function validateOther(
    staff: ReturnType<typeof staffOf>,
    kind: string,
    input: CreateInput,
    language: Language,
  ) {
    const handler = handlerOf(kind)
    if (!handler)
      throw new ValidationError([{ path: 'kind', code: 'unsupported', message: 'not available' }])
    if (input.params?.batchId === undefined)
      throw new ValidationError([
        { path: 'params.batchId', code: 'required', message: 'the draft batch to fill' },
      ])
    const params = { batchId: input.params.batchId }
    return handler.validate(
      staff,
      { fileId: input.fileId, fileName: input.fileName, params },
      language,
    )
  }

  const get = async (context: { params: Static<typeof IdParams>; request: Request }) => {
    const staff = staffOf(context)
    const language = languageOf(context.request.headers.get('accept-language'))
    return byId(
      async () => {
        const { job, committed } = await d.queries.get(staff, context.params.id)
        return jobBody(job, committed, language)
      },
      (handler) => handler.get(staff, context.params.id, language),
    )
  }

  const commit = async (context: { params: Static<typeof IdParams> }) => {
    const staff = staffOf(context)
    return byId(
      async () => {
        const { job, committed } = await d.commit.execute(staff, context.params.id)
        return {
          importId: job.id,
          status: 'committed' as const,
          committedAt: job.committedAt?.toISOString() ?? null,
          committed: { ...committed },
        }
      },
      (handler) => handler.commit(staff, context.params.id),
    )
  }

  const list = async (context: { query: Static<typeof ListQuery> }) => {
    const { kind, status, cursor, limit } = context.query
    const size = limit === undefined ? 20 : Number(limit)
    if (size < 1 || size > 100)
      throw new ValidationError([{ path: 'limit', code: 'range', message: '1 to 100' }])
    const after = cursor === undefined ? undefined : decodeCursor(cursor)
    if (kind !== undefined && kind !== 'unit_owner')
      return listOther(staffOf(context), kind, { status, after, limit: size })
    const page = await d.queries.list(staffOf(context), {
      kind: 'unit_owner',
      status,
      after,
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

  /** E-169 for another module's kind: its page, the creators named by `residency`, which reads the staff of `identity`. */
  async function listOther(
    staff: ReturnType<typeof staffOf>,
    kind: string,
    query: Parameters<ImportHandler['list']>[1],
  ) {
    const handler = handlerOf(kind)
    if (!handler)
      throw new ValidationError([{ path: 'kind', code: 'unsupported', message: 'not available' }])
    const page = await handler.list(staff, query)
    const names = await d.queries.staffNames(
      staff,
      page.items.map((row) => row.createdBy),
    )
    return {
      items: page.items.map(({ createdBy, ...row }) => ({
        ...row,
        createdBy: { staffId: createdBy, name: names.get(createdBy) ?? null },
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
