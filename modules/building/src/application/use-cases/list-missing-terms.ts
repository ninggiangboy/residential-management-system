import type { MissingTerm } from '../../contracts'
import type { TermsRepository } from '../../domain/terms-repository'
import { scopeOf } from '../scope-of'

/**
 * The gate of DOC-35 §9.2: the latest version of each kind that the account has not accepted. No cache: the very next request
 * after a publish must be refused, and two API containers cannot share an invalidation (DR-125).
 */
export class ListMissingTerms {
  constructor(private readonly terms: TermsRepository) {}

  async execute(accountId: string, buildingId: string): Promise<MissingTerm[]> {
    const rows = await this.terms.missing(scopeOf(buildingId), accountId)
    return rows.map((row) => ({ kind: row.kind, version: row.version, versionId: row.id }))
  }
}
