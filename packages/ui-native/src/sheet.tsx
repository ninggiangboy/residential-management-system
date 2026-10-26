import type { ReactNode } from 'react'
import { Modal, Pressable, View } from 'react-native'
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'
import { IconButton } from './button'
import { Text } from './text'

export interface BottomSheetProps {
  visible: boolean
  onClose: () => void
  title: string
  closeLabel: string
  children: ReactNode
  /** Actions in the foot, large buttons stacked (DOC-54 §8.2). */
  actions?: ReactNode
  testID?: string
}

/**
 * Scrim, a 32 dp top radius, a grip, a title and a close button (DOC-54 §8.2). The React Native `Modal` carries it and Reanimated
 * animates it (no extra sheet library, DOC-54 §7.1); the hardware back button closes it (A9).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  closeLabel,
  children,
  actions,
  testID,
}: BottomSheetProps) {
  return (
    <Modal transparent visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end" testID={testID}>
        <Animated.View entering={FadeIn} exiting={FadeOut} className="absolute inset-0 bg-scrim">
          <Pressable accessibilityLabel={closeLabel} className="flex-1" onPress={onClose} />
        </Animated.View>
        <Animated.View
          entering={SlideInDown}
          exiting={SlideOutDown}
          accessibilityViewIsModal
          className="rounded-t-sheet bg-surface"
        >
          <SafeAreaView edges={['bottom']} className="gap-4 p-6">
            <View className="h-1 w-10 self-center rounded-full bg-line-strong" />
            <View className="flex-row items-center">
              <Text variant="title-2" className="flex-1" accessibilityRole="header">
                {title}
              </Text>
              <IconButton icon="x" label={closeLabel} onPress={onClose} />
            </View>
            {children}
            {actions ? <View className="gap-3 pt-2">{actions}</View> : null}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  )
}

export interface DialogProps {
  visible: boolean
  onClose: () => void
  title: string
  body?: string
  /** Large buttons stacked; the destructive one is `danger` (DOC-54 §8.2). */
  actions: ReactNode
  testID?: string
}

/** Centered, `card` radius, announced as an alert dialog (A9). */
export function Dialog({ visible, onClose, title, body, actions, testID }: DialogProps) {
  return (
    <Modal transparent visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-gutter" testID={testID}>
        <Animated.View entering={FadeIn} exiting={FadeOut} className="absolute inset-0 bg-scrim" />
        <Animated.View
          entering={FadeIn}
          exiting={FadeOut}
          accessibilityRole="alert"
          accessibilityViewIsModal
          className="w-full gap-4 rounded-card bg-surface p-6"
        >
          <Text variant="title-2" accessibilityRole="header">
            {title}
          </Text>
          {body ? (
            <Text variant="body" tone="muted">
              {body}
            </Text>
          ) : null}
          <View className="gap-3 pt-2">{actions}</View>
        </Animated.View>
      </View>
    </Modal>
  )
}
