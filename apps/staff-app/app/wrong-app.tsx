import { useRuntime, useT } from '@rms/mobile-core'
import { Button, FullScreenState } from '@rms/ui-native'

/** An Admin signed in on the staff app: no device is registered, no other route renders, one button signs out (UISM-04). */
export default function WrongApp() {
  const t = useT()
  const { session } = useRuntime()
  return (
    <FullScreenState
      testID="wrong-app"
      icon="lock"
      title={t('staff.login.wrong-app.title')}
      body={t('staff.login.wrong-app.body')}
      actions={
        <Button block testID="wrong-app-sign-out" onPress={() => void session.signOut()}>
          {t('staff.login.wrong-app.cta')}
        </Button>
      }
    />
  )
}
