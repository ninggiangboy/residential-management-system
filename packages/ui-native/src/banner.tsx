import type { IconName } from '@rms/design-tokens'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Icon } from './icon'
import { Text } from './text'

const TONE = {
  info: { box: 'bg-info-soft', text: 'text-on-info-soft', icon: 'info', color: 'on-info-soft' },
  neutral: { box: 'bg-fill', text: 'text-ink', icon: 'info', color: 'ink' },
  warning: {
    box: 'bg-lamp-soft',
    text: 'text-on-lamp-soft',
    icon: 'warning',
    color: 'on-lamp-soft',
  },
  danger: {
    box: 'bg-danger-soft',
    text: 'text-on-danger-soft',
    icon: 'x-circle',
    color: 'on-danger-soft',
  },
} as const satisfies Record<string, { box: string; text: string; icon: IconName; color: string }>

export interface BannerProps {
  tone?: keyof typeof TONE
  title?: string
  children?: ReactNode
  /** A control under the text: "Hủy yêu cầu xóa", "Thử lại". */
  action?: ReactNode
  testID?: string
}

/** State that stays: a mismatch, the offline strip, a lock. Text first, the icon only reinforces (DOC-54 §2.2 rule 3). */
export function Banner({ tone = 'info', title, children, action, testID }: BannerProps) {
  const style = TONE[tone]
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      className={`flex-row gap-3 rounded-control p-4 ${style.box}`}
    >
      <Icon name={style.icon} size="sm" color={style.color} />
      <View className="flex-1 gap-1">
        {title ? (
          <Text variant="body-strong" className={style.text}>
            {title}
          </Text>
        ) : null}
        {children ? (
          <Text variant="secondary" className={style.text}>
            {children}
          </Text>
        ) : null}
        {action}
      </View>
    </View>
  )
}
