/**
 * The sign-out side of the usage tracker, apart from the tracker itself: `auth/session.ts` is on the first load of `/login`, which has a
 * byte budget (DOC-55 §3), and the tracker is not. `lib/usage.ts` registers the real function when the `_app` layout loads it; before
 * that there is no tracker, so there is nothing to clear.
 */
let end: () => void = () => {}

export const onUsageEnd = (clear: () => void): void => {
  end = clear
}

/** Clears the queue before the token goes, so nothing leaves with the token of the next account (DOC-104 §5.3). */
export const endUsage = (): void => end()
