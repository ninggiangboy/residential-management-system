import { staffKey } from '@rms/client-core'
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { api, authenticatedFetch } from '../../api/client'
import { unwrap } from '../../api/errors'
import { env } from '../../env'
import { languageStore } from '../../lib/i18n'

export type ImportJob = NonNullable<Awaited<ReturnType<typeof api.staff.imports.post>>['data']>

const importKey = (importId: string) => staffKey('imports', importId)

/** E-73: the stored preview, read again after a reload or from the recent-imports table (DR-21, DR-226). */
export const importQuery = (importId: string) =>
  queryOptions({
    queryKey: importKey(importId),
    queryFn: async () => unwrap(await api.staff.imports({ id: importId }).get()) as ImportJob,
    staleTime: 30_000,
  })

/** E-169: the building's jobs of the last 30 days, newest first, 10 per page. */
export const recentImportsQuery = () =>
  infiniteQueryOptions({
    queryKey: staffKey('imports', 'list'),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.staff.imports.get({
          query: { limit: '10', ...(pageParam ? { cursor: pageParam } : {}) },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

export function useImportMutations() {
  const queryClient = useQueryClient()
  return {
    /** E-72: one `Idempotency-Key` per file, so a retry replays the first preview (DOC-55 §4.3). */
    create: useMutation({
      mutationFn: async ({
        fileId,
        fileName,
        key,
      }: {
        fileId: string
        fileName: string
        key: string
      }) =>
        unwrap(
          await api.staff.imports.post(
            // The API builds the `kind` union with `.map`, which its type cannot see: Eden infers `never` for it.
            { kind: 'unit_owner' as never, fileId, fileName },
            { headers: { 'idempotency-key': key } },
          ),
        ),
      onSuccess: (job) => {
        queryClient.setQueryData(importKey(job.importId), job)
        void queryClient.invalidateQueries({ queryKey: staffKey('imports', 'list') })
      },
    }),
    /** E-74: no body and no key; the job status is the arbiter, so a second press answers the same 200 (UIWR-33). */
    commit: useMutation({
      mutationFn: async (importId: string) =>
        unwrap(await api.staff.imports({ id: importId }).commit.post()),
      onSettled: (_data, _error, importId) =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: importKey(importId) }),
          queryClient.invalidateQueries({ queryKey: staffKey('imports', 'list') }),
          queryClient.invalidateQueries({ queryKey: staffKey('units') }),
          queryClient.invalidateQueries({ queryKey: staffKey('residents') }),
        ]),
    }),
  }
}

/** E-71: the template as a download. The bearer token goes with it, so it is fetched and saved, not linked (DOC-65 `W-Import` §5). */
export async function downloadTemplate(): Promise<void> {
  const response = await authenticatedFetch(
    `${env.apiBaseUrl}/staff/imports/templates/unit_owner`,
    {
      headers: { 'accept-language': languageStore.get() },
    },
  )
  if (!response.ok) throw new Error(`template ${response.status}`)
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'unit-owner-template.xlsx'
  saveBlob(await response.blob(), name)
}

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
