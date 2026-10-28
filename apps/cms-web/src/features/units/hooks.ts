import { staffKey } from '@rms/client-core'
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap } from '../../api/errors'

export interface UnitFilters {
  q?: string
  occupancy?: 'occupied' | 'rented' | 'vacant'
  floor?: number
  bedrooms?: number
  cursor?: string
  limit: number
}

const toQuery = (f: UnitFilters) => ({
  ...(f.q ? { q: f.q } : {}),
  ...(f.occupancy ? { occupancy: f.occupancy } : {}),
  ...(f.floor !== undefined ? { floor: String(f.floor) } : {}),
  ...(f.bedrooms !== undefined ? { bedrooms: String(f.bedrooms) } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: String(f.limit),
})

/** E-57. A search (`q`) has no cursor; the summary ignores the filters (DR-212). */
export const unitsQuery = (filters: UnitFilters) =>
  queryOptions({
    queryKey: staffKey('units', filters),
    queryFn: async () => unwrap(await api.staff.units.get({ query: toQuery(filters) })),
    // A new filter or page keeps the rows on screen until its answer arrives (`DataTable busy`).
    placeholderData: keepPreviousData,
  })

export type UnitListItem = NonNullable<
  Awaited<ReturnType<typeof api.staff.units.get>>['data']
>['items'][number]
type UnitBody = NonNullable<Awaited<ReturnType<typeof api.staff.units.post>>['data']>

/** E-59. The read has a 304 branch, so the type is assembled from the write that answers the same unit and the list item. */
export interface UnitMember {
  membershipId: string
  accountId: string
  fullName: string | null
  phone: string
  memberType: 'owner' | 'family' | 'tenant' | 'helper'
  canPay: boolean
  status: 'active' | 'locked'
  lockedBy: 'manager' | 'owner' | null
  startedAt: string
}
export interface UnitDetail extends UnitBody {
  owner: {
    membershipId: string
    accountId: string
    fullName: string | null
    phone: string
    status: 'active' | 'locked'
    lockedBy: 'manager' | 'owner' | null
  } | null
  members: UnitMember[]
  debt: { openChargeCount: number; openAmount: number; oldestDueDate: string | null }
}

export const unitQuery = (unitId: string) =>
  queryOptions({
    queryKey: staffKey('units', 'detail', unitId),
    queryFn: async () =>
      unwrap(await api.staff.units({ id: unitId }).get()) as unknown as UnitDetail,
  })

export interface HistoryItem {
  id: string
  kind: 'owner_changed' | 'moved_in' | 'moved_out' | 'member_added' | 'member_removed'
  actor: { kind: 'staff' | 'resident' | 'system'; name: string | null }
  details: Record<string, unknown>
  at: string
}

export const historyPageQuery = (unitId: string, cursor: string | undefined) =>
  queryOptions({
    queryKey: staffKey('units', 'detail', unitId, 'history', cursor ?? 'first'),
    queryFn: async () =>
      unwrap(
        await api.staff.units({ id: unitId }).history.get({
          query: { limit: '50', ...(cursor ? { cursor } : {}) },
        }),
      ) as { items: HistoryItem[]; nextCursor: string | null },
  })

export interface UnitInput {
  code: string
  floor?: number | null
  bedrooms?: number | null
  areaM2?: string | null
  occupancy?: 'occupied' | 'rented' | 'vacant'
  note?: string | null
}

export function useUnitMutations() {
  const queryClient = useQueryClient()
  const unitsChanged = () => queryClient.invalidateQueries({ queryKey: staffKey('units') })
  const residentsChanged = () => queryClient.invalidateQueries({ queryKey: staffKey('residents') })
  const detailOf = (unitId: string) =>
    queryClient.invalidateQueries({ queryKey: staffKey('units', 'detail', unitId) })

  return {
    create: useMutation({
      mutationFn: async ({ body, key }: { body: UnitInput; key: string }) =>
        unwrap(await api.staff.units.post(body, { headers: { 'idempotency-key': key } })),
      onSettled: unitsChanged,
    }),
    update: useMutation({
      mutationFn: async ({
        id,
        version,
        body,
      }: {
        id: string
        version: number
        body: Partial<UnitInput>
      }) => unwrap(await api.staff.units({ id }).patch(body, { headers: ifMatch(version) })),
      onSettled: (_d, _e, input) => Promise.all([unitsChanged(), detailOf(input.id)]),
    }),
    transfer: useMutation({
      mutationFn: async (input: {
        id: string
        version: number
        phone: string
        fullName: string
        keepMembers: boolean
        reason: string
      }) => {
        const { id, version, ...body } = input
        return unwrap(await api.staff.units({ id }).owner.post(body, { headers: ifMatch(version) }))
      },
      onSettled: (_d, _e, input) =>
        Promise.all([unitsChanged(), residentsChanged(), detailOf(input.id)]),
    }),
    membership: useMutation({
      mutationFn: async ({
        id,
        change,
      }: {
        id: string
        unitId: string
        change:
          | { status: 'locked' | 'active' | 'removed' }
          | { memberType: 'family' | 'tenant' }
          | { canPay: boolean }
      }) => unwrap(await api.staff.memberships({ id }).patch(change)),
      onSettled: (_d, _e, input) =>
        Promise.all([unitsChanged(), residentsChanged(), detailOf(input.unitId)]),
    }),
    changePhone: useMutation({
      mutationFn: async ({
        accountId,
        phone,
      }: {
        accountId: string
        phone: string
        unitId: string
      }) => unwrap(await api.staff.residents({ accountId }).phone.patch({ phone })),
      onSettled: (_d, _e, input) => Promise.all([residentsChanged(), detailOf(input.unitId)]),
    }),
  }
}
