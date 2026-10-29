import { Avatar as RadixAvatar } from 'radix-ui'
import { cn } from '../../lib/utils'

const SIZES = { sm: 'size-7 text-micro', md: 'size-8 text-caption', lg: 'size-16 text-title-2' } as const

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string
  src?: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <RadixAvatar.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-teal-soft text-on-teal-soft',
        SIZES[size],
        className,
      )}
    >
      {src && <RadixAvatar.Image src={src} alt="" className="size-full object-cover" />}
      <RadixAvatar.Fallback aria-hidden="true">{initialsOf(name)}</RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}
