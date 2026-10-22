import { ForbiddenError } from './errors'

/**
 * The role gate of a use case (DOC-12 §5.3, §14 item 3): the actor's role must be one of `allowed`, else 403 `forbidden`.
 * `allowed` is the `*_ROLES` constant that the route reads for its `audience`, so the two cannot drift apart. The actor is
 * structural (`StaffContext` has a `role`), because this package imports no project type.
 */
export function requireRole<R extends string>(
  actor: { readonly role: R },
  allowed: readonly R[],
): void {
  if (!allowed.includes(actor.role)) throw new ForbiddenError()
}
