import {
  MobileProvider,
  setForegroundNotificationHandler,
  setupConnectivity,
  useRuntime,
} from '@rms/mobile-core'
import { FONT_SOURCES } from '@rms/ui-native'
import { useFonts } from 'expo-font'
import { ObserveErrorBoundary, ObserveRoot, useObserve } from 'expo-observe'
import { Stack, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef } from 'react'
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
  const router = useRouter()
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

  // The gate of `terms_required` opens the update screen over whatever is open (DOC-57 `Terms-Update`).
  useEffect(() => {
    if (flow.gateOpen && flow.phase === 'ready') router.push('/terms?mode=update')
  }, [flow.gateOpen, flow.phase, router])

  // The stack reopens on the first screen of its sorted routes when the sign-in screens go away, and that is Contact, not Unit-Pick.
  // Entering the unit phase opens Unit-Pick by name (UIRA-33); a later visit to Contact from its empty state stays where it is.
  const previousPhase = useRef(flow.phase)
  useEffect(() => {
    const entering = flow.phase === 'unit' && previousPhase.current !== 'unit'
    previousPhase.current = flow.phase
    if (!entering) return
    // Not in the commit that flips the guards: the stack is rebuilt in it and would take the replace for the old route.
    const frame = requestAnimationFrame(() => router.replace('/unit-pick'))
    return () => cancelAnimationFrame(frame)
  }, [flow.phase, router])

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
      <Stack.Protected guard={phase === 'terms' || (phase === 'ready' && flow.gateOpen)}>
        <Stack.Screen name="terms" />
        <Stack.Screen name="terms-full" />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'ready'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={phase === 'unit' || phase === 'ready'}>
        <Stack.Screen name="unit-pick" />
        <Stack.Screen name="contact" />
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
