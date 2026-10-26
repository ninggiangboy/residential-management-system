import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from './theme'

export interface ScreenProps {
  children: ReactNode
  /** Scrolls the content; the footer stays above the keyboard (DOC-54 §8.2). */
  scroll?: boolean
  /** Fixed at the bottom, above the keyboard: the primary action of the screen. */
  footer?: ReactNode
  /** Rendered above the content, outside the scroll: a `TopBar`, an offline `Banner`. */
  header?: ReactNode
  testID?: string
}

/**
 * Every screen starts on `ground` with the `Glow` wash at the top (DOC-54 §2.2 rule 1, §8.2): side margin `gutter`, blocks 32 dp
 * apart, bottom padding that clears a tab bar. The wash is the `glow` token as a vertical gradient (documented React Native
 * `backgroundImage`, DOC-54 §2.1).
 */
export function Screen({ children, scroll = true, footer, header, testID }: ScreenProps) {
  const { colors } = useTheme()
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="gap-8 px-gutter pb-14 pt-4"
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1 gap-8 px-gutter pb-6 pt-4">{children}</View>
  )
  return (
    <SafeAreaView testID={testID} className="flex-1 bg-ground">
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 280,
          backgroundImage: `linear-gradient(${colors.glow}, transparent)`,
          opacity: 0.55,
        }}
      />
      {header}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        {footer ? <View className="gap-3 px-gutter pb-4 pt-2">{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
