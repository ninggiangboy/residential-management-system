import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export type PushPermission = 'granted' | 'denied' | 'undetermined'

export type PushRegistration =
  | { status: 'ok'; token: string }
  | { status: 'denied' }
  | { status: 'no_device' }
  | { status: 'no_project' }
  | { status: 'failed'; reason: string }

/**
 * SDK 58 shows a foreground notification by default; the app decides, so the handler is set explicitly (DOC-11 §6.4). Phase 1
 * has no category that should interrupt a foreground screen, so none is shown; a banner for a category comes with its phase.
 */
export function setForegroundNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    }),
  })
}

/** The channels `default` and `urgent` (DR-52) exist before the first permission prompt: Android 13+ asks only then (DOC-55 §10.1). */
export async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
  await Notifications.setNotificationChannelAsync('urgent', {
    name: 'urgent',
    importance: Notifications.AndroidImportance.MAX,
  })
}

export async function pushPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/**
 * The explanation sheet has been shown; now the OS prompt, then the Expo push token (DOC-55 §10.1). A simulator has no token
 * (`no_device`); the project id comes from the app config (`extra.eas.projectId`, DOC-73 §3). Nothing here talks to the API:
 * the caller registers the token (E-22, E-34) once the `notification` module serves them.
 */
export async function requestPushToken(): Promise<PushRegistration> {
  if (!Device.isDevice) return { status: 'no_device' }
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId
  if (!projectId) return { status: 'no_project' }
  try {
    await ensureAndroidChannels()
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync())
    if (status !== 'granted') return { status: 'denied' }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
    return { status: 'ok', token: data }
  } catch (thrown) {
    return { status: 'failed', reason: thrown instanceof Error ? thrown.message : String(thrown) }
  }
}
