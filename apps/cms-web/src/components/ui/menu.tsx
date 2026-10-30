import { DropdownMenu, Tooltip as RadixTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import { IconButton } from './button'

export interface MenuItem {
  key: string
  label: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/** The overflow menu of a table row (`dots-three`). */
export function RowMenu({ label, items }: { label: string; items: readonly MenuItem[] }) {
  if (items.length === 0) return null
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton icon="dots-three" label={label} size="sm" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="motion-pop z-[100] min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) rounded-control border border-line bg-surface p-1 shadow-float"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.key}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={`flex min-h-control-sm cursor-pointer items-center rounded-plate px-2.5 text-body outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-disabled data-[highlighted]:bg-fill ${item.danger ? 'text-danger' : 'text-ink'}`}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Tooltip({
  text,
  side,
  disabled,
  children,
}: {
  text: ReactNode
  /** Above the trigger unless said; the rail of the sidebar puts its names to the right. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** The trigger already shows the text (the full sidebar's entries, DR-312): no tooltip repeats it. */
  disabled?: boolean
  children: ReactNode
}) {
  if (disabled) return children
  return (
    <RadixTooltip.Provider delayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className="motion-pop z-[100] origin-(--radix-tooltip-content-transform-origin) rounded-plate bg-plate px-2 py-1 text-caption text-on-plate shadow-float"
          >
            {text}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
