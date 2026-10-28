import { staffKey } from '@rms/client-core'
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap } from '../../api/errors'
import { digitsOf, nationalDigits } from '../../lib/phone'

export type MemberType = 'owner' | 'family' | 'tenant' | 'helper'

export interface ResidentFilters {
  q?: string
  unitId?: string
  memberType?: MemberType
  status?: 'active' | 'locked'
  deletion?: 'requested'
  neverSignedIn?: boolean
  cursor?: string
  limit: number
}

const toQuery = (f: ResidentFilters) => ({
  ...(f.q ? { q: f.q } : {}),
  ...(f.unitId ? { unitId: f.unitId } : {}),
  ...(f.memberType ? { memberType: f.memberType } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.deletion ? { deletion: f.deletion } : {}),
  ...(f.neverSignedIn ? { neverSignedIn: 'true' as const } : {}),
  ...(f.cursor ? { cursor: f.cursor } : {}),
  limit: String(f.limit),
})

export const residentsQuery = (filters: ResidentFilters) =>
  queryOptions({
    queryKey: staffKey('residents', filters),
    queryFn: async () => unwrap(await api.staff.residents.get({ query: toQuery(filters) })),
    // A new filter or page keeps the rows on screen until its answer arrives (`DataTable busy`).
    placeholderData: keepPreviousData,
  })

export type ResidentListItem = NonNullable<
  Awaited<ReturnType<typeof api.staff.residents.get>>['data']
>['items'][number]

export interface ResidentDetail {
  accountId: string
  phone: string
  accountStatus: 'active' | 'deletion_requested'
  profile: {
    fullName: string | null
    email: string | null
    cccd: string | null
    dateOfBirth: string | null
    note: string | null
    version: number
  }
  memberships: Array<{
    membershipId: string
    unitId: string
    unitCode: string
    memberType: MemberType
    status: 'active' | 'locked'
    startedAt: string
  }>
  deletion: { requestedAt: string | null; approvedAt: string | null; executeAfter: string | null }
}

/** E-65 writes `pii.read`: it is never cached, never prefetched and never refetched on focus (DOC-65 `W-Residents` §5, UIWR-20). */
export const residentDetailQuery = (accountId: string) =>
  queryOptions({
    queryKey: staffKey('residents', 'detail', accountId),
    queryFn: async () =>
      unwrap(await api.staff.residents({ accountId }).get()) as unknown as ResidentDetail,
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    refetchOnReconnect: false,
  })

/**
 * The account of a typed phone, for the link case of `W-Resident-Add` and the transfer dialog: E-63 is a suffix search, so the match
 * is the item whose number is exactly the typed one (DOC-65 `W-Resident-Add` §5). Nothing is looked up before 9 digits (DR-215).
 */
export function usePhoneLookup(typed: string) {
  const digits = digitsOf(typed)
  const enabled = digits.length >= 9
  const wanted = nationalDigits(typed)
  return useQuery({
    queryKey: staffKey('residents', 'lookup', digits),
    enabled,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const page = unwrap(await api.staff.residents.get({ query: { q: digits, limit: '20' } }))
      return page.items.find((item) => item.phone.replace(/\D/g, '') === wanted) ?? null
    },
  })
}

export function useResidentMutations() {
  const queryClient = useQueryClient()
  // The lists and the units refetch; the profile detail never does: E-65 writes a `pii.read`, so a save is not followed by a read (UIWR-21).
  const changed = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: staffKey('residents'),
        predicate: (query) => query.queryKey[2] !== 'detail',
      }),
      queryClient.invalidateQueries({ queryKey: staffKey('units') }),
    ])
  return {
    create: useMutation({
      mutationFn: async ({
        body,
        key,
      }: {
        body: {
          unitId: string
          phone: string
          fullName: string
          memberType: MemberType
          canPay?: boolean
          email?: string | null
          note?: string | null
        }
        key: string
      }) => unwrap(await api.staff.residents.post(body, { headers: { 'idempotency-key': key } })),
      onSettled: changed,
    }),
    /** E-68. It answers the dates, so the open profile takes them without a second `pii.read`; a stale state refetches the lists. */
    approveDeletion: useMutation({
      mutationFn: async (accountId: string) =>
        unwrap(await api.staff.residents({ accountId }).deletion.approve.post()),
      onSuccess: (approved) =>
        queryClient.setQueryData(
          residentDetailQuery(approved.accountId).queryKey,
          (current: ResidentDetail | undefined) =>
            current && {
              ...current,
              deletion: {
                requestedAt: approved.deletionRequestedAt,
                approvedAt: approved.deletionApprovedAt,
                executeAfter: approved.executeAfter,
              },
            },
        ),
      onSettled: changed,
    }),
    update: useMutation({
      mutationFn: async ({
        accountId,
        version,
        body,
      }: {
        accountId: string
        version: number
        body: {
          fullName?: string
          email?: string | null
          cccd?: string | null
          dateOfBirth?: string | null
          note?: string | null
        }
      }) =>
        unwrap(await api.staff.residents({ accountId }).patch(body, { headers: ifMatch(version) })),
      onSettled: changed,
    }),
  }
}
