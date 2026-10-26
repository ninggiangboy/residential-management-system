import type { IconName } from '@rms/design-tokens'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { View } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { Button } from './button'
import { Icon } from './icon'
import { Screen } from './screen'
import { Text } from './text'

export function EmptyState({
  icon,
  title,
  body,
  actions,
  testID,
}: {
  icon: IconName
  title: string
  body?: string
  actions?: ReactNode
  testID?: string
}) {
  return (
    <View testID={testID} className="items-center gap-4 py-10">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-teal-soft">
        <Icon name={icon} size="lg" color="on-teal-soft" />
      </View>
      <View className="items-center gap-2">
        <Text variant="title-2" className="text-center" accessibilityRole="header">
          {title}
        </Text>
        {body ? (
          <Text variant="body" tone="muted" className="text-center">
            {body}
          </Text>
        ) : null}
      </View>
      {actions ? <View className="w-full gap-3">{actions}</View> : null}
    </View>
  )
}

/** A pulsing block; it stands still when the system asks for reduced motion (A6). */
export function Skeleton({ className = 'h-5 w-full' }: { className?: string }) {
  const reduced = useReducedMotion()
  const opacity = useSharedValue(1)
  useEffect(() => {
    if (!reduced) opacity.value = withRepeat(withTiming(0.4, { duration: 800 }), -1, true)
  }, [reduced, opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
      className={`rounded-plate bg-fill ${className}`}
    />
  )
}

export function Tag({
  children,
  tone = 'neutral',
  icon,
}: {
  children: string
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
  icon?: IconName
}) {
  const style = {
    neutral: ['bg-fill', 'ink'],
    info: ['bg-info-soft', 'on-info-soft'],
    success: ['bg-success-soft', 'on-success-soft'],
    warning: ['bg-lamp-soft', 'on-lamp-soft'],
    danger: ['bg-danger-soft', 'on-danger-soft'],
  } as const
  const [box, color] = style[tone]
  return (
    <View className={`flex-row items-center gap-1 self-start rounded-full px-3 py-1 ${box}`}>
      {icon ? <Icon name={icon} size="sm" color={color} /> : null}
      <Text variant="caption" className={`text-${color}`}>
        {children}
      </Text>
    </View>
  )
}

/** The initials of a name, or the generic user icon when there is none (UIRA-41). */
export function Avatar({ name, size = 'md' }: { name?: string | null; size?: 'md' | 'lg' }) {
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <View
      className={`items-center justify-center rounded-full bg-teal-soft ${size === 'lg' ? 'h-16 w-16' : 'h-11 w-11'}`}
    >
      {initials ? (
        <Text variant={size === 'lg' ? 'title-2' : 'label'} className="text-on-teal-soft">
          {initials}
        </Text>
      ) : (
        <Icon name="user-circle" size={size === 'lg' ? 'lg' : 'md'} color="on-teal-soft" />
      )}
    </View>
  )
}

/** A screen that is only a message with actions: the update screen, the "cannot load" screen, the no-unit state (DOC-55 §16). */
export function FullScreenState(props: {
  icon: IconName
  title: string
  body?: string
  actions?: ReactNode
  testID?: string
}) {
  return (
    <Screen testID={props.testID}>
      <EmptyState {...props} />
    </Screen>
  )
}

/** The blocking update screen: it cannot be dismissed, one button opens the store, nothing else is reachable (DOC-55 §16). */
export function UpgradeScreen(props: {
  title: string
  body: string
  cta: string
  onUpdate: (() => void) | null
}) {
  return (
    <FullScreenState
      testID="upgrade-screen"
      icon="warning"
      title={props.title}
      body={props.body}
      actions={
        props.onUpdate ? (
          <Button block onPress={props.onUpdate}>
            {props.cta}
          </Button>
        ) : null
      }
    />
  )
}

/** "Something went wrong" and a reload, for a render error in a route (DOC-55 §15). */
export function ErrorFallbackScreen(props: {
  title: string
  body: string
  reload: string
  onReload: () => void
}) {
  return (
    <FullScreenState
      testID="error-fallback"
      icon="warning"
      title={props.title}
      body={props.body}
      actions={
        <Button block onPress={props.onReload}>
          {props.reload}
        </Button>
      }
    />
  )
}

/** A session with nothing read and nothing cached: a retry and a way out, never a dead end (UX-11). */
export function CannotLoadScreen(props: {
  title: string
  body: string
  retry: string
  signOut: string
  onRetry: () => void
  onSignOut: () => void
}) {
  return (
    <FullScreenState
      testID="cannot-load"
      icon="warning"
      title={props.title}
      body={props.body}
      actions={
        <>
          <Button block onPress={props.onRetry}>
            {props.retry}
          </Button>
          <Button block variant="ghost" onPress={props.onSignOut}>
            {props.signOut}
          </Button>
        </>
      }
    />
  )
}
