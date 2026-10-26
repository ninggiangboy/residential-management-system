import {
  ApiException,
  accountKey,
  configKey,
  networkError,
  unwrap,
  unwrapEmpty,
} from '@rms/client-core'
import { persistMeta, useRuntime } from '@rms/mobile-core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../runtime'

/** E-03: the building name, the contact and the minimum app version. Read at start and cached for 60 s (DOC-57 `Login`). */
export const useConfig = () =>
  useQuery({
    queryKey: configKey(),
    queryFn: async () => unwrap(await api.public.config.get()),
    staleTime: 60_000,
    meta: persistMeta,
  })

/** E-13: the account and the active memberships; persisted so the app can open offline (DOC-55 §9.2). */
export const useMe = (enabled = true) =>
  useQuery({
    queryKey: accountKey(),
    queryFn: async () => unwrap(await api.me.get()),
    enabled,
    meta: persistMeta,
  })

/** E-16: the latest terms with the acceptance state. Never persisted (DOC-55 §9.2). */
export const useTerms = (enabled = true) =>
  useQuery({
    queryKey: accountKey('terms'),
    queryFn: async () => unwrap(await api.me.terms.get()),
    enabled,
  })

/** E-15: the office contact; persisted, so the number works offline. */
export const useContact = (enabled = true) =>
  useQuery({
    queryKey: accountKey('contact'),
    queryFn: async () => unwrap(await api.me.contact.get()),
    enabled,
    meta: persistMeta,
  })

/** E-20: the live sessions, never persisted. */
export const useSessions = () =>
  useQuery({
    queryKey: accountKey('sessions'),
    queryFn: async () => unwrap(await api.me.sessions.get()),
  })

/** E-09: asks for a code. The answer is the challenge the OTP screen counts down. */
export const useRequestOtp = () =>
  useMutation({ mutationFn: async (phone: string) => unwrap(await api.auth.otp.post({ phone })) })

/** E-10: verifies the code and signs in. */
export function useVerifyOtp() {
  const { session, queryClient } = useRuntime()
  return useMutation({
    mutationFn: async (input: { challengeId: string; code: string }) => {
      const answer = unwrap(await api.auth.otp.verify.post(input))
      // A resident always signs in from the app: the refresh token is in the body (DOC-26 §3.3).
      if (!answer.refreshToken)
        throw new ApiException(networkError('', 'The answer holds no refresh token'))
      // A new sign-in starts from empty caches: nothing of a previous account can show (DOC-55 §5.4).
      queryClient.clear()
      await session.signedIn({
        accessToken: answer.accessToken,
        expiresIn: answer.expiresIn,
        refreshToken: answer.refreshToken,
      })
      queryClient.setQueryData(accountKey(), {
        account: answer.account,
        memberships: answer.memberships,
      })
      return answer
    },
  })
}

/** E-17: accepts every unaccepted version; then the terms query and the interrupted call go on. */
export function useAcceptTerms() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (versionIds: string[]) =>
      unwrapEmpty(await api.me.terms.post({ versionIds })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKey('terms') }),
  })
}

/** E-14: the language and the push toggle; the answer replaces the account of `['me']`. */
export function useUpdateMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (body: { language?: 'vi' | 'en'; pushEnabled?: boolean }) =>
      unwrap(await api.me.patch(body)),
    onSuccess: (account) => {
      queryClient.setQueryData(accountKey(), (previous: { memberships: unknown[] } | undefined) =>
        previous ? { ...previous, account } : previous,
      )
    },
  })
}

/** E-21: ends one session; the current one equals a sign-out. */
export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => unwrapEmpty(await api.me.sessions({ id }).delete()),
    onSettled: () => queryClient.invalidateQueries({ queryKey: accountKey('sessions') }),
  })
}
