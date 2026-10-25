import { staffKey } from '@rms/client-core'
import { queryOptions } from '@tanstack/react-query'
import { api } from '../client'
import { unwrap } from '../errors'

/**
 * E-30: the signed-in member. Its `version` is the `If-Match` of E-31. The read has a 304 branch, which Eden types as `unknown`;
 * the object is the one E-31 answers, which is typed.
 */
export type StaffMe = NonNullable<Awaited<ReturnType<typeof api.staff.me.patch>>['data']>

export const staffMeQuery = () =>
  queryOptions({
    queryKey: staffKey('me'),
    queryFn: async () => unwrap(await api.staff.me.get()) as StaffMe,
    staleTime: 60_000,
  })
