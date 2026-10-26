/** A hook opts a query into the persisted cache with `meta: persistMeta` (DR-190); money, QR, members and vehicles never do (DOC-55 §9.2). */
export const persistMeta = { persist: true } as const

/** The persist rule of DOC-55 §9.2 (CL-16): only a successful query that asked for it. */
export function shouldPersistQuery(query: {
  state: { status: string }
  meta?: Record<string, unknown> | undefined
}): boolean {
  return query.state.status === 'success' && query.meta?.persist === true
}
