import { Icon } from '../ui/icon'

/**
 * The product mark: the building icon on the hero gradient, the one coloured tile of the shell (DR-311). `#boot` of
 * `index.html` draws the same tile without the icon.
 */
export function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-control bg-gradient-to-br from-hero-from to-hero-to text-on-hero shadow-primary"
    >
      <Icon name="buildings" weight="fill" />
    </span>
  )
}
