import type { UnitOfWork } from '@core/kernel'
import { NotFoundError } from '@core/kernel'
import { TermsVersionSupersededError } from '../../domain/errors'
import type { TermsRepository } from '../../domain/terms-repository'
import { scopeOf } from '../scope-of'

export interface AcceptTermsInput {
  accountId: string
  buildingId: string
  versionIds: string[]
  ip: string | null
  appVersion: string | null
}

/**
 * `POST /me/terms`: accepts several versions at once. An acceptance of the latest version inserts a row (and stores the IP,
 * which is personal data); one that already exists is kept and answers the same; a version that is no longer the latest is 409
 * with the current ones; an unknown or foreign id is 404 (DOC-35 §9.3).
 */
export class AcceptTerms {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly terms: TermsRepository,
  ) {}

  async execute(input: AcceptTermsInput): Promise<void> {
    const scope = scopeOf(input.buildingId)
    const { terms, uow } = this
    await uow.run(async () => {
      for (const versionId of input.versionIds) {
        if (!(await terms.exists(scope, versionId))) throw new NotFoundError()
      }
      for (const versionId of input.versionIds) {
        const inserted = await terms.accept(scope, {
          accountId: input.accountId,
          versionId,
          ip: input.ip,
          appVersion: input.appVersion,
        })
        if (inserted || (await terms.isAccepted(scope, input.accountId, versionId))) continue
        const latest = await terms.latest(scope)
        throw new TermsVersionSupersededError(
          latest.map((row) => ({ kind: row.kind, version: row.version, versionId: row.id })),
        )
      }
    })
  }
}
