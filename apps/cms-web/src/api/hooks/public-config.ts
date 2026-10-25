import { configKey } from '@rms/client-core'
import type { Language } from '@rms/shared-types'
import { queryOptions } from '@tanstack/react-query'
import { api } from '../client'
import { unwrap } from '../errors'

/** E-03: the brand block of the sign-in pages and the shell, cached 60 s (DOC-64 `W-Login` §5). Never hard-coded (N8). */
export const publicConfigQuery = () =>
  queryOptions({
    queryKey: configKey(),
    queryFn: async () => unwrap(await api.public.config.get()),
    staleTime: 60_000,
    retry: false,
  })

export type PublicConfig = NonNullable<Awaited<ReturnType<typeof api.public.config.get>>['data']>

/** A bilingual value falls back to Vietnamese when the English text is missing (DR-71). */
export const pick = (
  value: { vi: string; en: string | null } | null | undefined,
  lang: Language,
) => (value ? (lang === 'en' ? (value.en ?? value.vi) : value.vi) : '')
