import {
  ApiException,
  configKey,
  ifMatch,
  networkError,
  staffKey,
  unwrap,
  unwrapEmpty,
} from '@rms/client-core'
import { persistMeta, useRuntime } from '@rms/mobile-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../runtime'

/** E-03: the building name for the context line and the minimum app version. */
export const useConfig = () =>
  useQuery({
    queryKey: configKey(),
    queryFn: async () => unwrap(await api.public.config.get()),
    staleTime: 60_000,
    meta: persistMeta,
  })

/** E-31 answers the object E-30 reads; the read has a 304 branch that Eden types as unknown. */
export type StaffMe = NonNullable<Awaited<ReturnType<typeof api.staff.me.patch>>['data']>

/** E-30: the signed-in member; its `version` is the `If-Match` of E-31. Persisted so the account opens offline (DOC-55 §9.2). */
export const useStaffMe = (enabled = true) =>
  useQuery({
    queryKey: staffKey('me'),
    queryFn: async () => unwrap(await api.staff.me.get()) as StaffMe,
    enabled,
    meta: persistMeta,
  })

/** E-32: the live sessions, never persisted. */
export const useStaffSessions = () =>
  useQuery({
    queryKey: staffKey('sessions'),
    queryFn: async () => unwrap(await api.staff.sessions.get()),
  })

/** E-05 with `client: "app"`: the refresh token is in the body; E-30 is read next by the flow. */
export function useStaffLogin() {
  const { session, queryClient } = useRuntime()
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const answer = unwrap(await api.auth.staff.login.post({ ...input, client: 'app' }))
      if (!answer.refreshToken)
        throw new ApiException(networkError('', 'The answer holds no refresh token'))
      // A new sign-in starts from empty caches: nothing of a previous account can show (DOC-55 §5.4).
      queryClient.clear()
      await session.signedIn({
        accessToken: answer.accessToken,
        expiresIn: answer.expiresIn,
        refreshToken: answer.refreshToken,
      })
      return answer
    },
  })
}

/** E-06: answers 202 for every email, known or not (FR-13.4). */
export const useStaffPasswordReset = () =>
  useMutation({
    mutationFn: async (email: string) =>
      unwrap(await api.auth.staff['password-reset'].post({ email })),
  })

/** E-31 with `If-Match`: the answer replaces `['staff', 'me']`; a 409 shows the fresh object (DOC-55 §8.4). */
export function useUpdateStaffMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      version: number
      body: { fullName?: string; language?: 'vi' | 'en'; pushEnabled?: boolean }
    }) => unwrap(await api.staff.me.patch(input.body, { headers: ifMatch(input.version) })),
    onSuccess: (me) => queryClient.setQueryData(staffKey('me'), me),
    onError: () => queryClient.invalidateQueries({ queryKey: staffKey('me') }),
  })
}

/** E-33: ends one session; the current one equals a sign-out. */
export function useRevokeStaffSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => unwrapEmpty(await api.staff.sessions({ id }).delete()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: staffKey('sessions') }),
  })
}
