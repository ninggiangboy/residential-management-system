import {
  MobileProvider,
  setForegroundNotificationHandler,
  setupConnectivity,
  useRuntime,
} from '@rms/mobile-core'
import { FONT_SOURCES } from '@rms/ui-native'
import { useFonts } from 'expo-font'
import { ObserveErrorBoundary, ObserveRoot, useObserve } from 'expo-observe'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ErrorFallback } from '../src/features/error-fallback'
import { UpgradeScreen } from '../src/features/upgrade-screen'
import { useFlow } from '../src/features/use-flow'
import { useUpgradeCheck } from '../src/features/use-upgrade'
import { runtime } from '../src/runtime'
import '../global.css'

void SplashScreen.preventAutoHideAsync()
setForegroundNotificationHandler()

function Routes() {
  const { session } = useRuntime()
  const flow = useFlow()
  const upgrade = useUpgradeCheck()
  const { markInteractive } = useObserve()
  const settled = flow.phase !== 'booting' && flow.phase !== 'loading'

  useEffect(() => {
    void session.boot()
  }, [session])

  useEffect(() => {
    if (!settled) return
    void SplashScreen.hideAsync()
    markInteractive()
  }, [settled, markInteractive])

  if (upgrade) return <UpgradeScreen {...upgrade} />
  if (!settled) return null

  const { phase } = flow
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={phase === 'signedOut'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'error'}>
        <Stack.Screen name="offline" />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'wrongApp'}>
        <Stack.Screen name="wrong-app" />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'ready'}>
        <Stack.Screen name="(app)" />
        <Stack.Screen name="device-check" />
      </Stack.Protected>
    </Stack>
  )
}

function RootLayout() {
  const [fontsLoaded] = useFonts(FONT_SOURCES)
  useEffect(() => setupConnectivity(), [])
  if (!fontsLoaded) return null
  return (
    <SafeAreaProvider>
      <MobileProvider runtime={runtime}>
        <StatusBar style="auto" />
        <ObserveErrorBoundary
          fallback={({ resetError }) => <ErrorFallback onReload={resetError} />}
        >
          <Routes />
        </ObserveErrorBoundary>
      </MobileProvider>
    </SafeAreaProvider>
  )
}

export default ObserveRoot.wrap(RootLayout)
