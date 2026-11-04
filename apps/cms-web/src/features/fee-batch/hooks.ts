import { staffKey } from '@rms/client-core'
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap, unwrapEmpty } from '../../api/errors'

/** The fee-batch routes of DOC-66 `W-Fee-Batch`: the list, one batch, its charges and the notice job. */
type FeeBatchesRoute = (typeof api.staff)['fee-batches']
type FeeBatchRoute = ReturnType<FeeBatchesRoute>

export interface FeeBatchFilters {
  status: 'all' | 'draft' | 'published' | 'closed' | 'recalled'
  month?: string
  q?: string
  limit: number
  cursor?: string
}

const toQuery = (f: FeeBatchFilters) => ({
  status: f.status,
  ...(f.month ? { month: f.month } : {}),
  ...(f.q ? { q: f.q } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: String(f.limit),
})

/** E-89: the batches of the building, newest fee month first, with the counts of the first page (DOC-66 §5). */
export const feeBatchesQuery = (filters: FeeBatchFilters) =>
  queryOptions({
    queryKey: staffKey('fee-batches', 'list', filters),
    queryFn: async () => unwrap(await api.staff['fee-batches'].get({ query: toQuery(filters) })),
    // A new filter or page keeps the rows on screen until its answer arrives (`DataTable busy`).
    placeholderData: keepPreviousData,
  })

/** E-91: one batch with its counts, provenance and import; the query key carries the id (DOC-66 §5). */
export const feeBatchQuery = (id: string) =>
  queryOptions({
    queryKey: staffKey('fee-batches', 'detail', id),
    queryFn: async () => unwrap(await api.staff['fee-batches']({ id }).get()),
  })

export interface BatchChargeFilters {
  view: 'all' | 'missing'
  status?: 'draft' | 'open' | 'paid' | 'void'
  voidKind?: 'recall' | 'single'
  q?: string
  include?: 'lines'
  cursor?: string
  limit: number
}

const toChargesQuery = (f: BatchChargeFilters) => ({
  view: f.view,
  ...(f.status ? { status: f.status } : {}),
  ...(f.voidKind ? { voidKind: f.voidKind } : {}),
  ...(f.q ? { q: f.q } : {}),
  ...(f.include ? { include: f.include } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: String(f.limit),
})

/** E-93: the charges of a batch ordered by unit code; `include=lines` adds each charge's lines (DOC-66 §5). */
export const batchChargesQuery = (id: string, filters: BatchChargeFilters) =>
  queryOptions({
    queryKey: staffKey('fee-batches', 'detail', id, 'charges', filters),
    queryFn: async () =>
      unwrap(
        await api.staff['fee-batches']({ id }).charges.get({ query: toChargesQuery(filters) }),
      ),
    placeholderData: keepPreviousData,
  })

/** E-177: the latest bulk fee-notice job of a batch; a batch with no job (404) reads as `null` (DOC-34 §9.1). */
export const feeNoticeJobQuery = (batchId: string) =>
  queryOptions({
    queryKey: staffKey('fee-batches', 'detail', batchId, 'notice'),
    queryFn: async () => {
      const answer = await api.staff['fee-batches']({ id: batchId }).pdf.get()
      return answer.response.status === 404 ? null : unwrap(answer)
    },
    // Poll while the renderer works; stop on `ready` or `failed`.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'queued' || status === 'running' ? 5000 : false
    },
  })

/** One item of E-89 (DOC-66 §5). */
type FeeBatchListPage = NonNullable<Awaited<ReturnType<FeeBatchesRoute['get']>>['data']>
export type FeeBatchListItem = FeeBatchListPage['items'][number]

/** The body of E-91 (DOC-66 §5). */
export type FeeBatchView = NonNullable<Awaited<ReturnType<FeeBatchRoute['get']>>['data']>

/** One page of E-93 (DOC-66 §5). */
type BatchChargesPage = NonNullable<Awaited<ReturnType<FeeBatchRoute['charges']['get']>>['data']>
export type BatchChargeItem = BatchChargesPage['items'][number]

/** The body of E-177 (DOC-34 §9.1). */
export type FeeNoticeJob = NonNullable<Awaited<ReturnType<FeeBatchRoute['pdf']['get']>>['data']>
export type FeeNoticeLanguage = 'vi' | 'en' | 'both'

/** One line of E-94's body, as E-170 sends it too (DOC-21 §3.2). */
export type ChargeLineInput = NonNullable<
  Parameters<ReturnType<typeof api.staff.charges>['put']>[0]
>['lines'][number]

/** E-90…E-99, E-170…E-172: the writes of DOC-66 `W-Fee-Batch`, `W-Fee-Recall`, `W-Fee-Reissue`, `W-Fee-Notice`. */
export function useFeeBatchMutations(batchId: string) {
  const queryClient = useQueryClient()
  const listKey = staffKey('fee-batches', 'list')
  const batchKey = staffKey('fee-batches', 'detail', batchId)
  // The batch prefix covers its charges and notice queries; the list keeps the new or edited batch current.
  const batchChanged = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: batchKey }),
      queryClient.invalidateQueries({ queryKey: listKey }),
    ])

  return {
    /** E-90: one `Idempotency-Key` per draft, so a retry replays the first create (DOC-55 §4.3). */
    create: useMutation({
      mutationFn: async ({
        body,
        key,
      }: {
        body: Parameters<FeeBatchesRoute['post']>[0]
        key: string
      }) =>
        unwrap(await api.staff['fee-batches'].post(body, { headers: { 'idempotency-key': key } })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
    }),
    /** E-92: a draft takes a new name or due date; a published batch only a later due date. */
    update: useMutation({
      mutationFn: async ({
        version,
        body,
      }: {
        version: number
        body: Parameters<FeeBatchRoute['patch']>[0]
      }) =>
        unwrap(
          await api.staff['fee-batches']({ id: batchId }).patch(body, {
            headers: ifMatch(version),
          }),
        ),
      onSettled: batchChanged,
    }),
    /** E-95: makes every charge of the draft payable at once. */
    publish: useMutation({
      mutationFn: async (version: number) =>
        unwrap(
          await api.staff['fee-batches']({ id: batchId }).publish.post(undefined, {
            headers: ifMatch(version),
          }),
        ),
      onSettled: batchChanged,
    }),
    /** E-172: deletes a draft with its charges; its code is not issued again. */
    discard: useMutation({
      mutationFn: async (version: number) =>
        unwrapEmpty(
          await api.staff['fee-batches']({ id: batchId }).delete(undefined, {
            headers: ifMatch(version),
          }),
        ),
      onSettled: batchChanged,
    }),
    /** E-97: marks a published batch closed; its open charges stay payable. */
    close: useMutation({
      mutationFn: async (version: number) =>
        unwrap(
          await api.staff['fee-batches']({ id: batchId }).close.post(undefined, {
            headers: ifMatch(version),
          }),
        ),
      onSettled: batchChanged,
    }),
    /** E-96: voids every charge of a published batch when none is paid (DOC-66 `W-Fee-Recall`). */
    recall: useMutation({
      mutationFn: async ({ version, reason }: { version: number; reason: string }) =>
        unwrap(
          await api.staff['fee-batches']({ id: batchId }).recall.post(
            { reason },
            { headers: ifMatch(version) },
          ),
        ),
      onSettled: batchChanged,
    }),
    /** E-98: copies a recalled batch into a new draft; no `If-Match` and no key (DOC-66 `W-Fee-Reissue`). */
    reissue: useMutation({
      mutationFn: async (body: Parameters<FeeBatchRoute['reissue']['post']>[0]) =>
        unwrap(await api.staff['fee-batches']({ id: batchId }).reissue.post(body)),
      onSettled: batchChanged,
    }),
    /** E-99: starts the bulk fee-notice job; no `If-Match` (DOC-34 §9.1, DOC-66 `W-Fee-Notice`). */
    requestNoticeZip: useMutation({
      mutationFn: async (body: Parameters<FeeBatchRoute['pdf']['post']>[0]) =>
        unwrap(await api.staff['fee-batches']({ id: batchId }).pdf.post(body)),
      onSettled: batchChanged,
    }),
    /** E-94: replaces the lines of a draft charge (needs the charge version). */
    saveCharge: useMutation({
      mutationFn: async ({
        chargeId,
        version,
        lines,
      }: {
        chargeId: string
        version: number
        lines: ChargeLineInput[]
      }) =>
        unwrap(
          await api.staff.charges({ id: chargeId }).put({ lines }, { headers: ifMatch(version) }),
        ),
      onSettled: batchChanged,
    }),
    /** E-170: adds the charge of one unit to this draft; no headers. */
    addCharge: useMutation({
      mutationFn: async (body: Parameters<FeeBatchRoute['charges']['post']>[0]) =>
        unwrap(await api.staff['fee-batches']({ id: batchId }).charges.post(body)),
      onSettled: batchChanged,
    }),
    /** E-171: deletes a draft charge with its lines (needs the charge version). */
    deleteCharge: useMutation({
      mutationFn: async ({ chargeId, version }: { chargeId: string; version: number }) =>
        unwrapEmpty(
          await api.staff.charges({ id: chargeId }).delete(undefined, {
            headers: ifMatch(version),
          }),
        ),
      onSettled: batchChanged,
    }),
  }
}
