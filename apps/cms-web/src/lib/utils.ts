import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The class merge of the shadcn components: later classes win over earlier ones. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

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
