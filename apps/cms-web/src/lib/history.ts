import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'

/**
 * What goes into the browser history (DOC-54 §17): an address a person would want to come back to is a new entry (a dialog, a
 * detail page, a first visit), a refinement of the page they are on is not (a tab, a filter, a page of a list, a search).
 * Refinements pass `replace: true` to `navigate` or `<Link>`; this file holds the one rule that needs state, closing an overlay.
 *
 * An overlay (a dialog or a panel kept in the URL) is opened with `state: OPENED_HERE`. Closing it then goes back one entry, so
 * Back and the X end up in the same place and no entry is left that reopens the dialog. An overlay reached by a typed or
 * shared address has no entry to go back to, and closing it navigates (with `replace`) to the page behind it.
 */
export const OPENED_HERE = { overlay: true } as const

/** `close(fallback)`: back one entry when this tab opened the overlay, `fallback` (a `replace` navigation) when it did not. */
export function useCloseOverlay() {
  const router = useRouter()
  return useCallback(
    (fallback: () => void) => {
      if (router.state.location.state.overlay) router.history.back()
      else fallback()
    },
    [router],
  )
}
