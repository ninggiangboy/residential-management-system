import { staffKey } from '@rms/client-core'
import type { Language } from '@rms/shared-types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { languageStore } from '../../lib/i18n'
import { api } from '../client'
import { ifMatch, unwrap } from '../errors'
import type { StaffMe } from './staff-me'

export interface ProfileChanges {
  fullName?: string
  language?: Language
  avatarFileId?: string | null
}

/**
 * E-31 with the `If-Match` of the member's own `version`; only the changed fields are sent. The answer replaces the cached member,
 * so the shell shows the new name and photo at once (UIWO-20).
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ version, changes }: { version: number; changes: ProfileChanges }) =>
      unwrap(await api.staff.me.patch(changes, { headers: ifMatch(version) })),
    onSuccess: (me: StaffMe) => {
      queryClient.setQueryData(staffKey('me'), me)
    },
    onError: () => {
      // A 409 and any failure leave the cached member as it was; refetch so the next save has the fresh version (UX-02).
      void queryClient.invalidateQueries({ queryKey: staffKey('me') })
    },
  })
}

/**
 * The language switch of a signed-in member: the catalog switches at once and the choice is saved; on failure it returns to the
 * old language (DOC-64 shell). The same call is the language card of `W-Profile`.
 */
export function useChangeLanguage(onFailed: () => void) {
  const update = useUpdateProfile()
  return {
    pending: update.isPending,
    change(me: StaffMe, next: Language, onSaved?: () => void) {
      const previous = languageStore.get()
      languageStore.set(next)
      update.mutate(
        { version: me.version, changes: { language: next } },
        {
          onSuccess: () => onSaved?.(),
          onError: () => {
            languageStore.set(previous)
            onFailed()
          },
        },
      )
    },
  }
}
