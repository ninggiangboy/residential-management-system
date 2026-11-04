import type { IdentityApi } from '@mod/identity/contracts'

/**
 * The `apps/api` adapter of `finance`'s `StaffDirectory` port (DOC-66 §5, DOC-07 §11A): the creator's full name from
 * `IdentityApi.getStaff`, one call for the ids of a page. An id `identity` does not know is absent from the map, so the caller
 * reads it as `null`. Only `apps/api` imports this file, through `@mod/finance/integrations/identity`.
 */
export function staffDirectory(identity: Pick<IdentityApi, 'getStaff'>) {
  return {
    async names(staffIds: readonly string[]): Promise<Map<string, string | null>> {
      if (staffIds.length === 0) return new Map()
      const rows = await identity.getStaff([...new Set(staffIds)])
      return new Map(rows.map((row) => [row.staffId, row.fullName] as const))
    },
  }
}
