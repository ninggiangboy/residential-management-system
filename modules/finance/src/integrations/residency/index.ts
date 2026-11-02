import { NotFoundError } from '@core/kernel'
import type { ImportHandler, ImportIssueBody, ImportJobBody } from '@mod/residency/contracts'
import { createTranslator, isMessageKey } from '@rms/i18n-catalog'
import type { Language } from '@rms/shared-types'
import {
  FEE_IMPORT_HEADERS,
  type FeeImportApi,
  type FeeImportIssueDto,
  type FeeImportJobDto,
} from '../../contracts'

type Column = keyof (typeof FEE_IMPORT_HEADERS)['vi']

const headerOf = (lang: Language, column: string): string =>
  column in FEE_IMPORT_HEADERS[lang] ? FEE_IMPORT_HEADERS[lang][column as Column] : column

/** `{code, params}` in the request language (DR-22); a column is shown as the header the Manager sees in the template. */
function messenger(lang: Language) {
  const t = createTranslator(lang)
  return (issue: FeeImportIssueDto): ImportIssueBody => {
    const key = `common.import.${issue.code}`
    const shown = Object.fromEntries(
      Object.entries(issue.params).map(([name, value]) => {
        if (typeof value !== 'string') return [name, value]
        if (name === 'column') return [name, headerOf(lang, value)]
        if (name === 'columns')
          return [
            name,
            value
              .split(', ')
              .map((column) => headerOf(lang, column))
              .join(', '),
          ]
        return [name, value]
      }),
    )
    return {
      ...issue,
      params: { ...issue.params },
      message: isMessageKey(key) ? t(key, shown) : issue.code,
    }
  }
}

function bodyOf(job: FeeImportJobDto, lang: Language): ImportJobBody {
  const message = messenger(lang)
  return {
    importId: job.importId,
    kind: 'fee_batch',
    status: job.status,
    fileName: job.fileName,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    committedAt: job.committedAt,
    committed: job.committed ? { ...job.committed } : null,
    params: { batchId: job.batchId },
    preview: {
      counts: { ...job.preview.counts },
      validRows: job.preview.validRows.map((row) => ({ ...row })),
      issues: job.preview.issues.map(message),
      issuesTruncated: job.preview.issuesTruncated,
    },
  }
}

/** A 404 of `finance` means "not a fee job of this building": the routes then try the next kind (DR-149). */
async function orNull<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

/**
 * `residency` owns `/staff/imports` and declares `ImportHandler`; `finance` answers the `fee_batch` kind here, so the module graph
 * stays acyclic (DR-149, DOC-12 §4.4). Only `apps/api` imports this file.
 */
export function feeImportHandler(finance: FeeImportApi): ImportHandler {
  return {
    kind: 'fee_batch',
    template: async (staff, language) => ({
      bytes: await finance.template(staff, language),
      fileName: `fee-batch-template-${language}.xlsx`,
    }),
    validate: async (staff, input, language) => {
      const batchId = input.params.batchId as string
      const job = await finance.validate(staff, {
        batchId,
        fileId: input.fileId,
        fileName: input.fileName,
      })
      return bodyOf(job, language)
    },
    get: (staff, id, language) =>
      orNull(async () => bodyOf(await finance.get(staff, id), language)),
    commit: (staff, id) =>
      orNull(async () => {
        const { job, committed } = await finance.commit(staff, id)
        return {
          importId: job.importId,
          status: 'committed',
          committedAt: job.committedAt,
          committed: { ...committed },
        }
      }),
    list: async (staff, query) => {
      const page = await finance.list(staff, query)
      return {
        items: page.items.map(
          ({
            importId,
            status,
            fileName,
            counts,
            createdBy,
            createdAt,
            expiresAt,
            committedAt,
          }) => ({
            importId,
            kind: 'fee_batch',
            status,
            fileName,
            counts: {
              rows: counts.rows,
              valid: counts.valid,
              errors: counts.errors,
              warnings: counts.warnings,
            },
            createdBy,
            createdAt,
            expiresAt,
            committedAt,
          }),
        ),
        next: page.next,
      }
    },
  }
}
