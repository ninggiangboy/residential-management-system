import type { IdGenerator, UnitOfWork } from '@core/kernel'
import { requireRole, VersionConflictError } from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import type { StaffContext, StaffRole } from '@rms/shared-types'
import type { Bilingual, TermsKind } from '../../contracts'
import type { TermsRepository } from '../../domain/terms-repository'
import { TermsVersion } from '../../domain/terms-version'
import type { BuildingDirectory } from '../directory'
import { isUniqueViolation } from '../unique-violation'

export interface PublishTermsInput {
  kind: TermsKind
  text: Bilingual
}

/** The terms are the Admin's alone (DOC-35 §9). The route reads this list for its `audience` (DOC-12 §5.3). */
export const PUBLISH_TERMS_ROLES = ['admin'] as const satisfies readonly StaffRole[]

/**
 * An Admin publishes a version of the terms of use or the privacy notice (DOC-35 §9, DOC-36 §8). A version is write-once; the
 * next request of every resident is refused with `terms_required` until it is accepted.
 */
export class PublishTerms {
  private readonly auditedPublish: ReturnType<PublishTerms['buildAuditedPublish']>

  constructor(
    private readonly uow: UnitOfWork,
    private readonly terms: TermsRepository,
    private readonly directory: BuildingDirectory,
    private readonly audited: Audited,
    private readonly ids: IdGenerator,
  ) {
    this.auditedPublish = this.buildAuditedPublish()
  }

  async execute(staff: StaffContext, input: PublishTermsInput) {
    requireRole(staff, PUBLISH_TERMS_ROLES)
    const isDemo = await this.directory.isDemo(staff.buildingId)
    const draft = TermsVersion.draft(input, { isDemo })
    return this.uow.run(() => this.auditedPublish(staff, draft))
  }

  private buildAuditedPublish() {
    const { audited, terms, ids } = this
    return audited(
      {
        action: 'building.terms.publish',
        object: (r: { id: string; kind: TermsKind; version: number }) => ({
          type: 'terms_version',
          id: r.id,
        }),
        details: (r: { kind: TermsKind; version: number }) => ({
          kind: r.kind,
          version: r.version,
        }),
      },
      async (staff: StaffContext, draft: TermsVersion) => {
        const id = ids.next()
        // Two Admins publishing at once collide on `uq_terms_version_building_kind_version`: the loser gets 409.
        const version = await terms
          .insertNext(staff.scope, {
            id,
            kind: draft.kind,
            text: draft.text,
            publishedBy: staff.staffId,
          })
          .catch((error: unknown) => {
            if (isUniqueViolation(error)) throw new VersionConflictError()
            throw error
          })
        return { result: { id, kind: draft.kind, version }, changes: [] }
      },
    )
  }
}
