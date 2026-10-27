import {
  type Clock,
  type IdGenerator,
  NotFoundError,
  requireRole,
  type SecretBox,
  type UnitOfWork,
} from '@core/kernel'
import type { OutboxWriter } from '@core/messaging'
import type { Audited } from '@mod/audit/contracts'
import type { BuildingApi, FilesApi } from '@mod/building/contracts'
import type { IdentityApi } from '@mod/identity/contracts'
import {
  buildingToday,
  type MetricsPort,
  NO_METRICS,
  type StaffContext,
  type StaffRole,
} from '@rms/shared-types'
import { type OwnerChangedPayload, RESIDENCY_EVENTS } from '../../contracts'
import { type ImportPlan, type PlannedRow, sameCounts } from '../../domain/import/plan'
import {
  ImportExpiredError,
  ImportIntegrityError,
  ImportNotReadyError,
  ImportStaleError,
} from '../../domain/import-errors'
import {
  type CommittedCounts,
  committedOf,
  type ImportJobRecord,
  statusAt,
} from '../../domain/import-job'
import type { ImportJobRepository } from '../../domain/import-job-repository'
import type { MembershipRepository, NewMembership } from '../../domain/membership-repository'
import { cccdAad } from '../../domain/resident-profile'
import type { UnitHistoryEntry, UnitHistoryRepository } from '../../domain/unit-history-repository'
import type {
  ProfileFill,
  UnitFields,
  UnitImportRepository,
} from '../../domain/unit-import-repository'
import { vacancyChange } from '../../domain/unit-occupancy'
import { fileActorOf } from '../file-actor'
import type { ImportPlanner } from '../import-planner'

/** The Manager's and the Admin's alone (DOC-27 §3.3). */
export const COMMIT_UNIT_OWNER_IMPORT_ROLES = [
  'admin',
  'manager',
] as const satisfies readonly StaffRole[]

type DomainEvent = Parameters<OutboxWriter['add']>[0][number]

/** What the commit decided to write, collected during the walk over the rows and written in batches. */
interface Batch {
  newUnits: ({ id: string; code: string } & UnitFields)[]
  memberships: NewMembership[]
  history: UnitHistoryEntry[]
  events: DomainEvent[]
  profiles: Map<
    string,
    ProfileFill & {
      email: string | null
      cccdEnc: string | null
      cccdLast4: string | null
      dateOfBirth: string | null
    }
  >
  /** The units written or updated, for DQ-60. */
  touched: string[]
}

export interface CommitResult {
  job: ImportJobRecord
  committed: CommittedCounts
}

/**
 * `POST /staff/imports/{id}/commit` (E-74, DOC-27 §9.2, DOC-18 §1.6): one transaction that claims the job, reads the file again,
 * checks it against the stored counts and writes the units, accounts, profiles and owner memberships of the valid rows. A second
 * "Save" finds the job `committed` and gets the first result. The file is read before the transaction opens; accounts are
 * created through `IdentityApi` in the same transaction. The commit, its events, its history and its audit row commit together,
 * and DQ-60 rolls everything back when the write does not match the preview.
 */
export class CommitUnitOwnerImport {
  private readonly auditedWrite: ReturnType<CommitUnitOwnerImport['buildAudited']>

  constructor(
    private readonly files: Pick<FilesApi, 'read' | 'remove'>,
    private readonly planner: ImportPlanner,
    private readonly jobs: ImportJobRepository,
    private readonly units: UnitImportRepository,
    private readonly memberships: MembershipRepository,
    private readonly history: UnitHistoryRepository,
    private readonly outbox: OutboxWriter,
    private readonly identity: Pick<IdentityApi, 'findOrCreateResidentAccount'>,
    private readonly building: Pick<BuildingApi, 'getBuilding'>,
    private readonly pii: () => SecretBox,
    audited: Audited,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly metrics: MetricsPort = NO_METRICS,
  ) {
    this.auditedWrite = this.buildAudited(audited)
  }

  /** `import_commits_total{outcome}`: what a refused "Save" came to. */
  private refused<E extends Error>(outcome: 'expired' | 'stale' | 'not_ready', error: E): E {
    this.metrics.inc('import_commits_total', { outcome })
    return error
  }

  async execute(staff: StaffContext, importId: string): Promise<CommitResult> {
    requireRole(staff, COMMIT_UNIT_OWNER_IMPORT_ROLES)
    const now = this.clock.now()
    const job = await this.jobs.find(staff.scope, importId)
    if (!job) throw new NotFoundError()
    const answer = this.answerFor(job, now)
    if (answer) return answer

    const actor = fileActorOf(staff)
    const bytes = await this.files.read(actor, job.fileId, {
      module: 'residency',
      purpose: 'import',
      ownerRef: `import:${job.id}`,
    })
    const building = await this.building.getBuilding(staff.buildingId)
    const today = buildingToday(now, building?.timeZone ?? 'Asia/Ho_Chi_Minh')
    const read = await this.planner.read(bytes, today)
    // The stored job was `validated`, so the file read well then; a file that no longer does cannot match its preview.
    if (read.kind !== 'read') throw this.refused('stale', new ImportStaleError(0))

    return this.uow.run(async () => {
      // The conditional statement of DOC-16 §5.5: of two presses of "Save" one claims the job, the other finds it committed.
      const claimed = await this.jobs.claim(staff.scope, job.id, now)
      if (!claimed) return this.replay(staff, job.id, now)
      const plan = await this.planner.plan(staff.scope, read)
      if (!sameCounts(plan.preview.counts, claimed.result.counts))
        throw this.refused('stale', new ImportStaleError(plan.preview.counts.rows))
      const { importId: _importId, ...committed } = await this.auditedWrite(staff, claimed, plan)
      this.metrics.inc('import_commits_total', { outcome: 'committed' })
      return { job: claimed, committed }
    })
  }

  /** The answer a job gives without a write: the first result of a committed one, or why it cannot be committed. */
  private answerFor(job: ImportJobRecord, now: Date): CommitResult | null {
    const status = statusAt(job, now)
    if (status === 'committed') return { job, committed: committedOf(job.result.counts) }
    if (status === 'expired') throw this.refused('expired', new ImportExpiredError())
    if (status !== 'validated') throw this.refused('not_ready', new ImportNotReadyError(status))
    return null
  }

  /** The claim found no `validated` row: another request got there first, or the job expired in the meantime. */
  private async replay(staff: StaffContext, id: string, now: Date): Promise<CommitResult> {
    const current = await this.jobs.find(staff.scope, id)
    if (!current) throw new NotFoundError()
    const answer = this.answerFor(current, now)
    // `validated` and not expired yet no claim: the job moved between the two statements; ask the caller to retry.
    if (!answer) throw this.refused('not_ready', new ImportNotReadyError(current.status))
    return answer
  }

  private buildAudited(audited: Audited) {
    return audited(
      {
        action: 'residency.import.commit',
        object: (committed: CommittedCounts & { importId: string }) => ({
          type: 'import_job',
          id: committed.importId,
        }),
        details: ({ importId: _importId, ...counts }) => ({ ...counts }),
      },
      async (staff: StaffContext, job: ImportJobRecord, plan: ImportPlan) => ({
        result: { importId: job.id, ...(await this.write(staff, job, plan)) },
        changes: [],
      }),
    )
  }

  /**
   * Steps 3 to 8 of DOC-27 §9.2. The rows are walked once to decide what to write, then each kind of row is written in batches:
   * a 2,000-row file is a few dozen statements, not ten thousand. The accounts are the exception: the contract has no batch form.
   */
  private async write(
    staff: StaffContext,
    job: ImportJobRecord,
    plan: ImportPlan,
  ): Promise<CommittedCounts> {
    const { scope } = staff
    const now = this.clock.now()
    const batch: Batch = {
      newUnits: [],
      memberships: [],
      history: [],
      events: [],
      profiles: new Map(),
      touched: [],
    }
    const written: CommittedCounts = {
      unitsCreated: 0,
      unitsUpdated: 0,
      accountsCreated: 0,
      accountsLinked: 0,
      ownersAdded: 0,
    }
    const accounts = new Map<string, string>()
    const linked = new Set<string>()
    for (const planned of plan.rows) {
      const unitId = await this.planUnit(staff, planned, batch, written, now)
      const { owner } = planned
      if (!owner) continue
      const accountId = await this.accountOf(owner, accounts, linked, written)
      await this.planProfile(staff, accountId, owner, batch)
      if (owner.action === 'add')
        this.planOwner(staff, planned, unitId, accountId, batch, written, now)
    }
    written.accountsLinked = linked.size

    // Units first: the history and the memberships point at them.
    await this.units.insertUnits(scope, batch.newUnits, now)
    await this.units.fillProfiles(scope, [...batch.profiles.values()], now)
    await this.memberships.insertMany(scope, batch.memberships, now)
    await this.history.addMany(scope, batch.history, now)
    await this.outbox.add(batch.events)
    await this.files.remove(fileActorOf(staff), job.fileId)
    await this.verify(staff, job, written, batch.touched)
    return written
  }

  /** S8: an existing unit is updated now (a blank cell keeps its value); a new one joins the batch. Returns the unit's id. */
  private async planUnit(
    staff: StaffContext,
    planned: PlannedRow,
    batch: Batch,
    written: CommittedCounts,
    now: Date,
  ): Promise<string> {
    const { parsed, unit } = planned
    const fields = {
      floor: parsed.floor,
      bedrooms: parsed.bedrooms,
      areaM2: parsed.areaM2,
      occupancy: parsed.occupancy,
    }
    if (!unit) {
      const id = this.ids.next()
      batch.newUnits.push({ id, code: parsed.unitCode as string, ...fields })
      batch.touched.push(id)
      written.unitsCreated++
      return id
    }
    await this.units.updateUnit(staff.scope, unit.unitId, fields, now)
    batch.touched.push(unit.unitId)
    written.unitsUpdated++
    const moved = vacancyChange(unit.occupancy, parsed.occupancy)
    if (moved)
      batch.history.push({
        id: this.ids.next(),
        unitId: unit.unitId,
        kind: moved,
        actor: { kind: 'staff', id: staff.staffId },
        details: { from: unit.occupancy, to: parsed.occupancy },
      })
    return unit.unitId
  }

  /** Step 4: an existing account is linked and keeps its name; a new phone gets an account, once however many rows name it. */
  private async accountOf(
    owner: NonNullable<PlannedRow['owner']>,
    accounts: Map<string, string>,
    linked: Set<string>,
    written: CommittedCounts,
  ): Promise<string> {
    const known = accounts.get(owner.phone)
    if (known) return known
    let accountId = owner.accountId
    if (accountId) linked.add(owner.phone)
    else {
      const account = await this.identity.findOrCreateResidentAccount(owner.phone, owner.name)
      accountId = account.accountId
      if (account.created) written.accountsCreated++
      else linked.add(owner.phone)
    }
    accounts.set(owner.phone, accountId)
    return accountId
  }

  /**
   * Step 5 (S9): the profile of a person, filled where it is empty (DR-114 (8)). A person named by two rows has one entry: the
   * first non-empty value of each field wins, because one statement cannot touch a row twice.
   */
  private async planProfile(
    staff: StaffContext,
    accountId: string,
    owner: NonNullable<PlannedRow['owner']>,
    batch: Batch,
  ) {
    const fill = batch.profiles.get(accountId)
    if (fill) {
      fill.email ??= owner.email
      fill.dateOfBirth ??= owner.dateOfBirth
      if (fill.cccdEnc === null && owner.idNumber) {
        fill.cccdEnc = await this.sealed(staff, accountId, owner.idNumber)
        fill.cccdLast4 = owner.idNumber.slice(-4)
      }
      return
    }
    batch.profiles.set(accountId, {
      accountId,
      fullName: owner.name,
      email: owner.email,
      cccdEnc: owner.idNumber ? await this.sealed(staff, accountId, owner.idNumber) : null,
      cccdLast4: owner.idNumber ? owner.idNumber.slice(-4) : null,
      dateOfBirth: owner.dateOfBirth,
    })
  }

  private sealed(staff: StaffContext, accountId: string, idNumber: string) {
    return this.pii().seal(cccdAad(staff.buildingId, accountId), idNumber)
  }

  /** Step 6: the owner membership, its history row and its event, for a row the classification marks `add`. */
  private planOwner(
    staff: StaffContext,
    planned: PlannedRow,
    unitId: string,
    accountId: string,
    batch: Batch,
    written: CommittedCounts,
    now: Date,
  ) {
    batch.memberships.push({
      id: this.ids.next(),
      accountId,
      unitId,
      memberType: 'owner',
      addedByKind: 'staff',
      addedBy: staff.staffId,
    })
    batch.history.push({
      id: this.ids.next(),
      unitId,
      kind: 'owner_changed',
      actor: { kind: 'staff', id: staff.staffId },
      details: { from: null, to: accountId, source: 'import' },
    })
    batch.events.push({
      type: RESIDENCY_EVENTS.ownerChanged,
      aggregateId: unitId,
      payload: {
        buildingId: staff.buildingId,
        unitId,
        unitCode: planned.parsed.unitCode as string,
        newOwnerAccountId: accountId,
        previousOwnerAccountId: null,
        keepMembers: false,
      } satisfies OwnerChangedPayload,
      occurredAt: now,
    })
    written.ownersAdded++
  }

  /** DQ-60: no unit with two owners, and the write is what the preview said. */
  private async verify(
    staff: StaffContext,
    job: ImportJobRecord,
    written: CommittedCounts,
    touched: readonly string[],
  ) {
    const expected = committedOf(job.result.counts)
    const same = (Object.keys(expected) as (keyof CommittedCounts)[]).every(
      (key) => expected[key] === written[key],
    )
    if (!same) throw new ImportIntegrityError('counts differ from the preview')
    const doubled = await this.units.unitsWithManyOwners(staff.scope, touched)
    if (doubled.length > 0) throw new ImportIntegrityError('a unit has more than one owner')
  }
}
