import { useT } from '@rms/mobile-core'
import { ErrorFallbackScreen } from '@rms/ui-native'

/** EAS Observe has recorded the error and its component stack; the resident can reload (DOC-55 §15). */
export function ErrorFallback({ onReload }: { onReload: () => void }) {
  const t = useT()
  return (
    <ErrorFallbackScreen
      title={t('common.error.boundary.title')}
      body={t('common.error.boundary.body')}
      reload={t('common.action.reload')}
      onReload={onReload}
    />
  )
}
