import type { IconName } from '@rms/design-tokens'
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { Button } from './button'
import { Icon } from './icon'
import { Tag } from './states'
import { Text } from './text'

export interface ListItemProps {
  title: string
  subtitle?: string
  icon?: IconName
  /** The value at the end of the row: the current language. */
  value?: string
  /** A control at the end of the row, in place of the caret: a `Switch`. */
  trailing?: ReactNode
  onPress?: () => void
  disabled?: boolean
  /** The selected row has its title in the `teal` tone (DOC-60 `Account`). */
  selected?: boolean
  destructive?: boolean
  testID?: string
}

/** A row is 16 dp padded and at least 48 dp high (DOC-54 §8.2). A row with `onPress` shows a caret; with `trailing`, that control. */
export function ListItem({
  title,
  subtitle,
  icon,
  value,
  trailing,
  onPress,
  disabled,
  selected,
  destructive,
  testID,
}: ListItemProps) {
  const content = (
    <View className="min-h-tap-min flex-row items-center gap-3 px-4 py-3">
      {icon ? (
        <Icon name={icon} color={destructive ? 'danger' : selected ? 'teal' : 'ink-muted'} />
      ) : null}
      <View className="flex-1 gap-0.5">
        <Text variant="body" tone={destructive ? 'danger' : selected ? 'teal' : 'ink'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="secondary" tone="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="secondary" tone="muted">
          {value}
        </Text>
      ) : null}
      {trailing ?? (onPress ? <Icon name="caret-right" size="sm" color="ink-muted" /> : null)}
    </View>
  )
  if (!onPress)
    return (
      <View testID={testID} className={disabled ? 'opacity-50' : ''}>
        {content}
      </View>
    )
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      disabled={disabled}
      onPress={onPress}
      className={`active:bg-fill ${disabled ? 'opacity-50' : ''}`}
    >
      {content}
    </Pressable>
  )
}

/** A titled group of rows on a `surface` card; rows are separated by a hairline. */
export function List({ title, children }: { title?: string; children: ReactNode[] | ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children]
  return (
    <View className="gap-2">
      {title ? (
        <Text variant="label" tone="muted" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <View className="overflow-hidden rounded-card bg-surface">
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are a fixed JSX list with no identity of their own
          <View key={index} className={index > 0 ? 'border-t border-line' : ''}>
            {row}
          </View>
        ))}
      </View>
    </View>
  )
}

export interface SessionRow {
  id: string
  /** `device` as the server computed it from the user agent (DOC-26 §3.7). */
  title: string
  subtitle: string
  current: boolean
}

/**
 * The live sessions of an account (DOC-60 `Sessions`, DOC-61 `S-Account`): a phone icon, the device, the last use, a tag on the
 * current device and a revoke control on the others. The current row's revoke is a sign-out and is up to the caller.
 */
export function SessionList({
  rows,
  currentLabel,
  revokeLabel,
  onRevoke,
  disabled,
}: {
  rows: SessionRow[]
  currentLabel: string
  revokeLabel: string
  onRevoke: (row: SessionRow) => void
  disabled?: boolean
}) {
  return (
    <List>
      {rows.map((row) => (
        <View key={row.id} testID={`session-${row.id}`} className="gap-2 px-4 py-3">
          <View className="flex-row items-center gap-3">
            <Icon name="phone" color="ink-muted" />
            <View className="flex-1 gap-0.5">
              <Text variant="body">{row.title}</Text>
              <Text variant="secondary" tone="muted">
                {row.subtitle}
              </Text>
            </View>
          </View>
          {row.current ? (
            <View className="pl-9">
              <Tag tone="info">{currentLabel}</Tag>
            </View>
          ) : (
            <View className="pl-9">
              <Button
                variant="outline"
                size="sm"
                testID={`revoke-${row.id}`}
                disabled={disabled}
                onPress={() => onRevoke(row)}
              >
                {revokeLabel}
              </Button>
            </View>
          )}
        </View>
      ))}
    </List>
  )
}
