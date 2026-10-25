import { Tabs as RadixTabs } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export function TabList({
  tabs,
  label,
}: {
  tabs: readonly { value: string; label: ReactNode }[]
  label: string
}) {
  return (
    <RadixTabs.List aria-label={label} className="flex gap-1 border-b border-line">
      {tabs.map((tab) => (
        <RadixTabs.Trigger
          key={tab.value}
          value={tab.value}
          className={cn(
            'relative h-control-md px-4 text-label text-ink-muted outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus data-[state=active]:text-ink',
            'data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-teal',
          )}
        >
          {tab.label}
        </RadixTabs.Trigger>
      ))}
    </RadixTabs.List>
  )
}

export const Tabs = RadixTabs.Root
export const TabPanel = RadixTabs.Content
