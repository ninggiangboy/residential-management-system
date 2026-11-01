import { staffKey } from '@rms/client-core'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap } from '../../api/errors'

export type UnitTypeStatus = 'active' | 'archived'

/**
 * E-180 (DR-314). The key sits under `['staff','units']`, so a unit write, which moves `unitCount`, invalidates the types too
 * (DOC-65 `W-Unit-Types` §5). A building has at most 50 types: one answer, no cursor.
 */
export const unitTypesQuery = (status?: UnitTypeStatus) =>
  queryOptions({
    queryKey: staffKey('units', 'types', status ?? 'all'),
    queryFn: async () =>
      unwrap(await api.staff['unit-types'].get({ query: status ? { status } : {} })),
  })

/** The name in the language of the screen, falling back to Vietnamese, which every type has (DOC-14 §8). */
export const unitTypeName = (name: { vi: string; en?: string | null }, lang: string) =>
  lang === 'en' && name.en ? name.en : name.vi

export type UnitTypeItem = NonNullable<
  Awaited<ReturnType<(typeof api.staff)['unit-types']['get']>>['data']
>['items'][number]

export interface UnitTypeInput {
  code: string
  name: { vi: string; en?: string | null }
  defaultBedrooms?: number | null
  defaultAreaM2?: string | null
}

export interface UnitTypePatch {
  name?: { vi?: string; en?: string | null }
  defaultBedrooms?: number | null
  defaultAreaM2?: string | null
  status?: UnitTypeStatus
}

export function useUnitTypeMutations() {
  const queryClient = useQueryClient()
  const changed = () => queryClient.invalidateQueries({ queryKey: staffKey('units', 'types') })
  return {
    create: useMutation({
      mutationFn: async ({ body, key }: { body: UnitTypeInput; key: string }) =>
        unwrap(await api.staff['unit-types'].post(body, { headers: { 'idempotency-key': key } })),
      onSettled: changed,
    }),
    update: useMutation({
      mutationFn: async ({
        id,
        version,
        body,
      }: {
        id: string
        version: number
        body: UnitTypePatch
      }) =>
        unwrap(await api.staff['unit-types']({ id }).patch(body, { headers: ifMatch(version) })),
      onSettled: changed,
    }),
  }
}
