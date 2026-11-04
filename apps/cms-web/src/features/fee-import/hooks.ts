import { staffKey } from '@rms/client-core'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, authenticatedFetch } from '../../api/client'
import { unwrap } from '../../api/errors'
import { env } from '../../env'
import { saveBlob } from '../../lib/download'
import { languageStore } from '../../lib/i18n'

/**
 * DOC-66 `W-Fee-Import`: the `fee_batch` job behind `/staff/imports` (E-72, E-73, E-74, E-169) and the draft it fills (E-90, E-91).
 * The kind carries `params.batchId`, so the job body is the fee shape (DR-149, DOC-21 §4); the rows and issues it lists have no
 * personal data, so the page shows them whole (DOC-15 §10.1).
 */
export type FeeImportStatus = 'validated' | 'failed' | 'committed' | 'expired'

export interface FeeImportCounts {
  rows: number
  valid: number
  errors: number
  warnings: number
  charges: number
  lines: number
  totalAmount: number
}

export interface FeePreviewRow {
  row: number
  unitCode: string
  itemName: string
  itemNameEn?: string
  kind: 'fee' | 'adjustment'
  quantity: string
  unitPrice: number
  amount: number
}

export interface FeeImportIssue {
  row: number
  unitCode: string | null
  column: string | null
  severity: 'fail' | 'error' | 'warning'
  code: string
  params: Record<string, string | number>
  /** The text of DOC-18 §2.2, rendered by the API in the request language (DR-22). */
  message: string
}

export interface FeeImportJob {
  importId: string
  kind: 'fee_batch'
  status: FeeImportStatus
  fileName: string | null
  createdAt: string
  expiresAt: string
  committedAt: string | null
  /** What the commit wrote (E-74): the charges created and the earlier ones replaced. */
  committed: { created: number; replaced: number } | null
  params: { batchId: string }
  preview: {
    counts: FeeImportCounts
    validRows: FeePreviewRow[]
    issues: FeeImportIssue[]
    issuesTruncated: boolean
  }
}

/** One row of E-169 `kind=fee_batch` (DOC-66 §5); the list does not carry the batch code. */
export interface FeeImportHistoryRow {
  importId: string
  kind: 'fee_batch'
  status: FeeImportStatus
  fileName: string | null
  counts: { rows: number; valid: number; errors: number; warnings: number }
  createdBy: { staffId: string; name: string | null }
  createdAt: string
  expiresAt: string
  committedAt: string | null
}

const importKey = (importId: string) => staffKey('imports', importId)

/** E-73: the stored preview, read again after a reload or from the recent-imports table (DR-21, DR-226). */
export const feeImportQuery = (importId: string) =>
  queryOptions({
    queryKey: importKey(importId),
    queryFn: async () =>
      unwrap(await api.staff.imports({ id: importId }).get()) as unknown as FeeImportJob,
    staleTime: 30_000,
  })

/** E-169: the building's fee jobs of the last 30 days, newest first, ten rows (DOC-66 §5). */
export const recentFeeImportsQuery = () =>
  queryOptions({
    queryKey: staffKey('imports', 'list', 'fee_batch'),
    queryFn: async () => {
      const page = unwrap(
        await api.staff.imports.get({ query: { kind: 'fee_batch', limit: '10' } }),
      )
      return page as unknown as { items: FeeImportHistoryRow[]; nextCursor: string | null }
    },
    staleTime: 30_000,
  })

type FeeBatchesRoute = (typeof api.staff)['fee-batches']

/** E-90, E-72, E-74: the writes of DOC-66 `W-Fee-Import`; each carries its own `Idempotency-Key` (DOC-55 §4.3). */
export function useFeeImportMutations() {
  const queryClient = useQueryClient()
  return {
    /** E-90: creates the draft the file fills; the `feeMonth` is fixed at creation (DR-265). */
    createBatch: useMutation({
      mutationFn: async ({
        body,
        key,
      }: {
        body: Parameters<FeeBatchesRoute['post']>[0]
        key: string
      }) =>
        unwrap(await api.staff['fee-batches'].post(body, { headers: { 'idempotency-key': key } })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: staffKey('fee-batches') }),
    }),
    /** E-72: validates the upload into the draft and stores the preview (DR-21). */
    validate: useMutation({
      mutationFn: async ({
        fileId,
        fileName,
        batchId,
        key,
      }: {
        fileId: string
        fileName: string
        batchId: string
        key: string
      }) =>
        unwrap(
          // The API builds `kind` with `.map`, so Eden infers `never` for it (see features/import/hooks.ts).
          await api.staff.imports.post(
            { kind: 'fee_batch' as never, fileId, fileName, params: { batchId } },
            { headers: { 'idempotency-key': key } },
          ),
        ) as unknown as FeeImportJob,
      onSuccess: (job) => {
        queryClient.setQueryData(importKey(job.importId), job)
        void queryClient.invalidateQueries({ queryKey: staffKey('imports', 'list', 'fee_batch') })
      },
    }),
    /** E-74: one transaction replaces every charge of the draft; the job status answers a second press (DOC-21 §4.5). */
    commit: useMutation({
      mutationFn: async (importId: string) =>
        unwrap(await api.staff.imports({ id: importId }).commit.post()),
      onSettled: (_data, _error, importId) =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: importKey(importId) }),
          queryClient.invalidateQueries({ queryKey: staffKey('imports', 'list', 'fee_batch') }),
          queryClient.invalidateQueries({ queryKey: staffKey('fee-batches') }),
        ]),
    }),
  }
}

/** E-71: the `fee_batch` template as a download. The bearer token goes with it, so it is fetched and saved, not linked. */
export async function downloadFeeTemplate(): Promise<void> {
  const response = await authenticatedFetch(`${env.apiBaseUrl}/staff/imports/templates/fee_batch`, {
    headers: { 'accept-language': languageStore.get() },
  })
  if (!response.ok) throw new Error(`template ${response.status}`)
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'fee-batch-template.xlsx'
  saveBlob(await response.blob(), name)
}
