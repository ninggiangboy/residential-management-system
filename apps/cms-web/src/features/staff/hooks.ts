import { staffKey } from '@rms/client-core'
import type { StaffRole } from '@rms/shared-types'
import { keepPreviousData, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ifMatch, unwrap, unwrapEmpty } from '../../api/errors'
import type { Proof } from '../../auth/step-up'

type StaffStatus = 'invited' | 'active' | 'locked' | 'disabled'

export interface StaffFilters {
  role?: StaffRole
  status?: StaffStatus
  q?: string
  page: number
  pageSize: number
}

const toQuery = (filters: StaffFilters) => ({
  ...(filters.role ? { role: filters.role } : {}),
  ...(filters.status ? { status: filters.status } : {}),
  ...(filters.q ? { q: filters.q } : {}),
  page: String(filters.page),
  pageSize: String(filters.pageSize),
})

/** E-39 with the URL params; the previous page stays on screen while the next loads (DOC-55 §8.2). */
export const staffListQuery = (filters: StaffFilters) =>
  queryOptions({
    queryKey: staffKey('accounts', filters),
    queryFn: async () => unwrap(await api.staff.accounts.get({ query: toQuery(filters) })),
    placeholderData: keepPreviousData,
  })

export type StaffAccount = NonNullable<
  Awaited<ReturnType<typeof api.staff.accounts.get>>['data']
>['items'][number]

/** The chip counts and the subtitle come from one unfiltered call, `pageSize=50` (DR-217). */
export const staffSummaryQuery = () =>
  queryOptions({
    queryKey: staffKey('accounts', 'summary'),
    queryFn: async () =>
      unwrap(await api.staff.accounts.get({ query: { page: '1', pageSize: '50' } })),
  })

/** E-41: one account with the version for `If-Match`; the edit dialog reads it when it opens. */
export const staffAccountQuery = (id: string) =>
  queryOptions({
    queryKey: staffKey('account', id),
    queryFn: async () => unwrap(await api.staff.accounts({ id }).get()) as StaffAccount,
    gcTime: 0,
  })

/** The active Technicians and Guards who can take the open tickets of a locked account (DOC-67 §5). */
export const assigneesQuery = () =>
  queryOptions({
    queryKey: staffKey('accounts', 'assignees'),
    queryFn: async () => {
      const [technicians, guards] = await Promise.all([
        api.staff.accounts.get({
          query: { role: 'technician', status: 'active', page: '1', pageSize: '50' },
        }),
        api.staff.accounts.get({
          query: { role: 'guard', status: 'active', page: '1', pageSize: '50' },
        }),
      ])
      return [...unwrap(technicians).items, ...unwrap(guards).items]
    },
    gcTime: 0,
  })

export interface Reassign {
  reassignTo?: string
  reason?: string
}

/** Every write of this screen refetches the lists; a 409 refetches too and keeps the dialog open (UX-02). */
export function useStaffMutations() {
  const queryClient = useQueryClient()
  const settle = () => queryClient.invalidateQueries({ queryKey: staffKey('accounts') })
  const settleOne = (id: string) =>
    queryClient.invalidateQueries({ queryKey: staffKey('account', id) })

  return {
    create: useMutation({
      mutationFn: async (input: {
        body: { fullName: string; email: string; role: StaffRole; language?: 'vi' | 'en' }
        proof?: Proof
        key: string
      }) =>
        unwrap(
          await api.staff.accounts.post(
            { ...input.body, ...(input.proof ? { stepUp: input.proof } : {}) },
            { headers: { 'idempotency-key': input.key } },
          ),
        ),
      onSettled: settle,
    }),
    update: useMutation({
      mutationFn: async (input: {
        id: string
        version: number
        body: {
          fullName?: string
          language?: 'vi' | 'en'
          role?: StaffRole
          email?: string
          reassignTo?: string
          reason?: string
        }
        proof?: Proof
      }) =>
        unwrap(
          await api.staff
            .accounts({ id: input.id })
            .patch(
              { ...input.body, ...(input.proof ? { stepUp: input.proof } : {}) },
              { headers: ifMatch(input.version) },
            ),
        ),
      onSettled: (_data, _error, input) => Promise.all([settle(), settleOne(input.id)]),
    }),
    lock: useMutation({
      mutationFn: async ({ id, ...reassign }: { id: string } & Reassign) =>
        unwrap(await api.staff.accounts({ id }).lock.post(reassign)),
      onSettled: settle,
    }),
    unlock: useMutation({
      mutationFn: async (id: string) => unwrap(await api.staff.accounts({ id }).unlock.post()),
      onSettled: settle,
    }),
    disable: useMutation({
      mutationFn: async ({ id, ...reassign }: { id: string } & Reassign) =>
        unwrap(await api.staff.accounts({ id }).disable.post(reassign)),
      onSettled: settle,
    }),
    enable: useMutation({
      mutationFn: async (id: string) => unwrap(await api.staff.accounts({ id }).enable.post()),
      onSettled: settle,
    }),
    resendInvite: useMutation({
      mutationFn: async (staffId: string) =>
        unwrapEmpty(await api.auth.staff.invite.resend.post({ staffId })),
    }),
  }
}
