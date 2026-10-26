import { type PushRegistration, requestPushToken } from '@rms/mobile-core'
import { Banner, Button, Screen, Text, TopBar } from '@rms/ui-native'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { env } from '../../src/runtime'

/**
 * Developer-only (hidden when `APP_ENV` is `production`): the device checks of compatibility row 14 (DOC-11 §10, formerly spike
 * S-02). It shows what the OS and Expo answer, in plain English, and is not part of the product's text.
 */
export default function DeviceCheck() {
  const router = useRouter()
  const [push, setPush] = useState<PushRegistration | null>(null)
  if (env.isProduction) return null
  return (
    <Screen
      testID="device-check"
      header={<TopBar title="Device check" backLabel="Back" onBack={() => router.back()} />}
    >
      <Banner tone="neutral">Development builds only. A simulator has no push token.</Banner>
      <Button block testID="push-token" onPress={async () => setPush(await requestPushToken())}>
        Get the Expo push token
      </Button>
      {push ? (
        <Text variant="secondary" selectable testID="push-result">
          {push.status === 'ok'
            ? `ok ${push.token}`
            : push.status === 'failed'
              ? `failed ${push.reason}`
              : push.status}
        </Text>
      ) : null}
    </Screen>
  )
}
