import { useRuntime, useT } from '@rms/mobile-core'
import { CannotLoadScreen } from '@rms/ui-native'
import { useFlow } from '../src/features/use-flow'

export default function CannotLoad() {
  const t = useT()
  const { session } = useRuntime()
  const flow = useFlow()
  return (
    <CannotLoadScreen
      title={t('common.error.page.title')}
      body={t('offline.banner')}
      retry={t('common.action.retry')}
      signOut={t('common.action.sign-out')}
      onRetry={flow.retry}
      onSignOut={() => void session.signOut()}
    />
  )
}
