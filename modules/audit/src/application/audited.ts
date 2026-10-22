import type { AuditApi, Audited } from '../contracts'
import { checkedReason } from '../domain/entry'
import { applyMasks } from '../domain/masking'

/** The wrapper of DOC-35 §3.2 over an `AuditApi`. The actor is the first argument of the use case. */
export function createAudited(audit: AuditApi): Audited {
  return (spec, body) =>
    async (...args) => {
      const [actor] = args
      // Before the body runs: a missing reason must not cost a single statement (AD-08).
      const reason = checkedReason(spec.action, spec.reason?.(...args))
      const { result, changes } = await body(...args)
      await audit.record({
        actor,
        action: spec.action,
        object: spec.object(result),
        changes: applyMasks(changes, spec.masks),
        ...(reason === undefined ? {} : { reason }),
        details: spec.details?.(result),
      })
      return result
    }
}
