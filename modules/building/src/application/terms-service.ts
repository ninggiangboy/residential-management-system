import type { IdGenerator } from '@core/kernel'
import {
  ForbiddenError,
  NotFoundError,
  type UnitOfWork,
  ValidationError,
  VersionConflictError,
} from '@core/kernel'
import type { Audited } from '@mod/audit/contracts'
import {
  type BuildingId,
  isTermsError,
  parseTermsMarkdown,
  type StaffContext,
} from '@rms/shared-types'
import type { Bilingual, MissingTerm, TermsKind } from '../contracts'
import { TermsVersionSupersededError } from '../domain/errors'
import type { BuildingDirectory } from './directory'
import type { TermsRepository } from './ports'

const scopeOf = (buildingId: string) => ({ buildingId: buildingId as BuildingId })

const KINDS: readonly TermsKind[] = ['terms', 'privacy']

export interface PublishTermsInput {
  kind: TermsKind
  text: Bilingual
}

export interface AcceptTermsInput {
  accountId: string
  buildingId: string
  versionIds: string[]
  ip: string | null
  appVersion: string | null
}

export interface TermsDeps {
  uow: UnitOfWork
  terms: TermsRepository
  directory: BuildingDirectory
  audited: Audited
  ids: IdGenerator
}

/**
 * Terms of use and the privacy notice (DOC-35 §9, DOC-36 §8): the gate's two reads, an Admin's publish and a resident's
 * acceptance. A version is write-once; the next request of every resident is refused with `terms_required` until it is accepted.
 */
export class TermsService {
  private readonly auditedPublish: ReturnType<TermsService['buildAuditedPublish']>

  constructor(private readonly deps: TermsDeps) {
    this.auditedPublish = this.buildAuditedPublish()
  }

  /** No cache: the very next request after a publish must be refused, and two API containers cannot share an invalidation (DR-125). */
  async missing(accountId: string, buildingId: string): Promise<MissingTerm[]> {
    const rows = await this.deps.terms.missing(scopeOf(buildingId), accountId)
    return rows.map((row) => ({ kind: row.kind, version: row.version, versionId: row.id }))
  }

  async hasAcceptedLatest(accountId: string, buildingId: string): Promise<boolean> {
    return (await this.missing(accountId, buildingId)).length === 0
  }

  async publish(staff: StaffContext, input: PublishTermsInput) {
    if (staff.role !== 'admin') throw new ForbiddenError()
    if (!KINDS.includes(input.kind))
      throw new ValidationError([{ path: 'kind', code: 'enum', message: 'terms or privacy' }])
    const demo = await this.deps.directory.isDemo(staff.buildingId)
    // Both languages are required for a real building (the dossier supplies vi and en, P0-06); the demo building may publish vi only.
    if (!demo && !input.text.en?.trim())
      throw new ValidationError([
        { path: 'text.en', code: 'required', message: 'both languages are required' },
      ])
    for (const language of ['vi', 'en'] as const) {
      const text = input.text[language]
      if (text === undefined) continue
      const parsed = parseTermsMarkdown(text)
      if (isTermsError(parsed))
        throw new ValidationError([
          { path: `text.${language}:${parsed.line}`, code: 'terms_text', message: parsed.rule },
        ])
    }
    return this.deps.uow.run(() => this.auditedPublish(staff, input))
  }

  private buildAuditedPublish() {
    const { audited, terms, ids } = this.deps
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
      async (staff: StaffContext, input: PublishTermsInput) => {
        const id = ids.next()
        // Two Admins publishing at once collide on `uq_terms_version_building_kind_version`: the loser gets 409.
        const version = await terms
          .insertNext(staff.scope, {
            id,
            kind: input.kind,
            text: input.text,
            publishedBy: staff.staffId,
          })
          .catch((error: unknown) => {
            if (isUnique(error)) throw new VersionConflictError()
            throw error
          })
        return { result: { id, kind: input.kind, version }, changes: [] }
      },
    )
  }

  /**
   * `POST /me/terms`: accepts several versions at once. An acceptance of the latest version inserts a row (and stores the IP,
   * which is personal data); one that already exists is kept and answers the same; a version that is no longer the latest is 409
   * with the current ones; an unknown or foreign id is 404 (DOC-35 §9.3).
   */
  async accept(input: AcceptTermsInput): Promise<void> {
    const scope = scopeOf(input.buildingId)
    const { terms, uow } = this.deps
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

const isUnique = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505')
