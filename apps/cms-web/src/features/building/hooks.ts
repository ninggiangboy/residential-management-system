import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap } from '../../api/errors'
import type { BuildingDocument, BuildingPatch } from './model'

export const settingsQuery = () =>
  queryOptions({
    queryKey: ['settings'] as const,
    queryFn: async () => {
      const answer = await api.staff.settings.get()
      return {
        document: unwrap(answer) as BuildingDocument,
        etag: answer.response.headers.get('etag') ?? '',
      }
    },
  })

export type TermsKind = 'terms' | 'privacy'

export const termsQuery = (kind: TermsKind) =>
  queryOptions({
    queryKey: ['terms', kind] as const,
    queryFn: async () =>
      unwrap(await api.staff.terms.get({ query: { kind } })).items as unknown as TermsVersion[],
  })

export interface TermsVersion {
  versionId: string
  kind: TermsKind
  version: number
  text: { vi: string; en: string | null }
  publishedBy: { id: string; name: string | null }
  publishedAt: string
  acceptedCount: number
}

export function useSaveSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ etag, patch }: { etag: string; patch: BuildingPatch }) => {
      const answer = await api.staff.settings.patch(patch as never, {
        headers: { 'if-match': etag.startsWith('"') ? etag : `"${etag}"` },
      })
      return {
        document: unwrap(answer) as BuildingDocument,
        etag: answer.response.headers.get('etag') ?? '',
      }
    },
    onSuccess: (saved) => queryClient.setQueryData(settingsQuery().queryKey, saved),
    onError: (error) => {
      // A 409 refetches so the Admin's edits can be laid over the fresh document (UX-02).
      if ((error as { error?: { code?: string } }).error?.code === 'version_conflict')
        void queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

export function usePublishTerms() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { kind: TermsKind; vi: string; en: string }) =>
      unwrap(
        await api.staff.terms.post({
          kind: input.kind,
          text: { vi: input.vi, ...(input.en.trim() ? { en: input.en } : {}) },
        }),
      ) as unknown as TermsVersion,
    onSettled: (_data, _error, input) =>
      queryClient.invalidateQueries({ queryKey: ['terms', input.kind] }),
  })
}

export { ifMatch }
