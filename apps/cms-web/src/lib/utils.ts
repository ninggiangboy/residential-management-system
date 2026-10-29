import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** The ten text styles and the four plate styles of the tokens (DOC-54 §4.2): they are font sizes, not colors, so `text-label` and `text-on-teal` both stay. */
const TEXT_STYLES = [
  'display',
  'title-1',
  'title-2',
  'title-3',
  'body',
  'body-strong',
  'label',
  'secondary',
  'caption',
  'micro',
  'plate-xl',
  'plate-lg',
  'plate-md',
  'plate-sm',
]

/**
 * The size, radius and shadow names of the tokens (DOC-54 §5.2–5.5, `theme.css`). Without them the merge does not see
 * `h-control-md` and `h-auto` as one property, keeps both, and the stylesheet order picks the winner: a `TextAreaField`
 * stayed one line high whatever its `rows`.
 */
const SIZES = [
  'tap-min',
  'control-lg',
  'control-md',
  'control-sm',
  'icon-sm',
  'icon-md',
  'icon-lg',
  'gutter',
  'topbar-height',
  'tabbar-height',
]
const RADII = ['plate', 'control', 'card', 'sheet']
const SHADOWS = [
  'card',
  'glow',
  'bar',
  'float',
  'sheet',
  'raised',
  'panel',
  'primary',
  'field',
  'focus',
  'invalid',
]

const merge = extendTailwindMerge({
  extend: {
    theme: { spacing: SIZES, radius: RADII, shadow: SHADOWS },
    classGroups: { 'font-size': [{ text: TEXT_STYLES }] },
  },
})

/** The class merge of the shadcn components: later classes win over earlier ones. */
export const cn = (...inputs: ClassValue[]) => merge(clsx(inputs))

/** Reads and writes that may throw (private window, blocked site data) never break the page (DOC-55 §5.1). */
export function safeStorage(kind: 'local' | 'session' = 'local') {
  const storage = () => (kind === 'local' ? window.localStorage : window.sessionStorage)
  return {
    get(key: string): string | null {
      try {
        return storage().getItem(key)
      } catch {
        return null
      }
    },
    set(key: string, value: string): void {
      try {
        storage().setItem(key, value)
      } catch {
        // The value is a convenience; the page works without it.
      }
    },
    remove(key: string): void {
      try {
        storage().removeItem(key)
      } catch {
        // See above.
      }
    },
  }
}
