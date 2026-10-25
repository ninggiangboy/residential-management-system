import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { pick, publicConfigQuery } from '../../api/hooks/public-config'
import { useI18n } from '../../lib/i18n'
import { Skeleton } from '../ui/skeleton'
import { LanguageSwitch } from './language-switch'

/** The building name from E-03; a failure leaves it empty and the page keeps working (UIWO-09). */
export function useBrand() {
  const { lang } = useI18n()
  const config = useQuery(publicConfigQuery())
  return {
    loading: config.isPending,
    name: pick(config.data?.contact.name, lang),
    contact: config.data?.contact,
    config: config.data,
  }
}

/** The top row (building name, "Web quản lý", language) and the centered card column of `W-Forgot-Sent` and `W-Reset`. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const brand = useBrand()
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 px-8 py-5">
        <div>
          {brand.loading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <p className="text-title-3 text-ink">{brand.name}</p>
          )}
          <p className="text-secondary text-ink-muted">{t('web.shell.brand.subtitle')}</p>
        </div>
        <LanguageSwitch />
      </header>
      <main
        id="main"
        className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-center px-4 pb-16"
      >
        {children}
      </main>
    </div>
  )
}
