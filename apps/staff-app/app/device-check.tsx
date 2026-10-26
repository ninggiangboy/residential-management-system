import { type PushRegistration, requestPushToken } from '@rms/mobile-core'
import { Banner, Button, Screen, Text, TopBar } from '@rms/ui-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { env } from '../src/runtime'

/**
 * Developer-only (hidden when `APP_ENV` is `production`): the device checks of compatibility row 14 (DOC-11 §10, formerly spike
 * S-02): the Expo push token and a QR scan with the camera. It shows what the OS and Expo answer, in plain English, and is not
 * part of the product's text. The Guard's scanner (P5) is a different screen.
 */
export default function DeviceCheck() {
  const router = useRouter()
  const [push, setPush] = useState<PushRegistration | null>(null)
  const [permission, requestPermission] = useCameraPermissions()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<string | null>(null)
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
      <Button
        block
        testID="scan-qr"
        variant="outline"
        onPress={async () => {
          if (!permission?.granted && !(await requestPermission()).granted) return
          setScanned(null)
          setScanning(true)
        }}
      >
        Scan a QR code
      </Button>
      {scanning ? (
        <View className="h-72 overflow-hidden rounded-card">
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              setScanned(data)
              setScanning(false)
            }}
          />
        </View>
      ) : null}
      {scanned ? (
        <Text variant="secondary" selectable testID="scan-result">
          {`scanned ${scanned}`}
        </Text>
      ) : null}
    </Screen>
  )
}
