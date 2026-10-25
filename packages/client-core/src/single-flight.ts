/** Runs `fn` once however many callers wait: the others get the same promise (DOC-55 §5.2 rule 1, CL-10). */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined
  return () => {
    inFlight ??= fn().finally(() => {
      inFlight = undefined
    })
    return inFlight
  }
}
