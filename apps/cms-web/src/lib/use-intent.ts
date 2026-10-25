import { newIntent } from '@rms/client-core'
import { useRef } from 'react'

/**
 * The `Idempotency-Key` of one user intent (DOC-55 §4.3): created at the first press, kept across every retry and double click, and
 * renewed only when the body changes or `reset()` is called (success, cancel). A new key for the same intent defeats the mechanism.
 */
export function useIntent() {
  const intent = useRef(newIntent(() => crypto.randomUUID()))
  return {
    keyFor: (body: unknown) => intent.current.for(body).key,
    reset: () => intent.current.reset(),
  }
}
