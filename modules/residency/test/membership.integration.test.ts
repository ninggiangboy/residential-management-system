import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import { Membership } from '../src/domain/membership'
import { DrizzleMembershipRepository } from '../src/infrastructure/persistence/drizzle-membership-repository'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/**
 * `ChangeMembership` and the membership table on PostgreSQL 18.6 (DOC-27 §6, §17): the constraints of DOC-16 §5.3, the guarded
 * statements, the outbox row and the audit row of each change, and the races the database decides.
 */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const failure = async (promise: Promise<unknown>): Promise<DomainError> => {
  try {
    await promise
  } catch (error) {
    return error as DomainError
  }
  throw new Error('expected a failure')
}

const change = (
  membershipId: string,
  edit: Parameters<Harness['residency']['useCases']['changeMembership']['execute']>[2],
) => h.residency.useCases.changeMembership.execute(h.staff(), membershipId, edit)

describe('the constraints of the table', () => {
  test('RM-02 a second active owner for a unit is refused by membership_one_owner_per_unit', async () => {
    const first = await h.seedMembership({ memberType: 'owner' })
    const error = await failure(h.seedMembership({ memberType: 'owner', unit: first.unit }))
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain(
      'membership_one_owner_per_unit',
    )
  })

  test('a removed owner does not count: a new owner can be added', async () => {
    const first = await h.seedMembership({ memberType: 'owner', status: 'removed' })
    await h.seedMembership({ memberType: 'owner', unit: first.unit })
  })

  test('one membership per account and unit while it is not removed (and again once it is)', async () => {
    const first = await h.seedMembership()
    const error = await failure(h.seedMembership({ accountId: first.accountId, unit: first.unit }))
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).toContain(
      'membership_one_per_account_unit',
    )
    const gone = await h.seedMembership({ status: 'removed' })
    await h.seedMembership({ accountId: gone.accountId, unit: gone.unit })
  })

  test('RM-14 there is no limit: a unit takes its 26th membership and its 9th helper', async () => {
    const unit = await h.seedUnit()
    for (let at = 0; at < 25; at++) await h.seedMembership({ unit, memberType: 'family' })
    for (let at = 0; at < 8; at++) await h.seedMembership({ unit, memberType: 'helper' })
    await h.seedMembership({ unit, memberType: 'tenant' })
    await h.seedMembership({ unit, memberType: 'helper' })
    const [count] =
      await h.admin`SELECT count(*)::int AS n FROM residency.membership WHERE unit_id = ${unit.id}`
    expect(count?.n).toBe(35)
  })
})

describe('ChangeMembership', () => {
  test('RM-09 lock, unlock, retype and remove each move credential_version by one; can_pay does not', async () => {
    const { id } = await h.seedMembership({ memberType: 'tenant' })
    await change(id, { status: 'locked' })
    expect(await h.row(id)).toMatchObject({
      status: 'locked',
      locked_by: 'manager',
      credential_version: 2,
    })
    await change(id, { status: 'active' })
    expect(await h.row(id)).toMatchObject({
      status: 'active',
      locked_by: null,
      credential_version: 3,
    })
    await change(id, { memberType: 'family' })
    expect(await h.row(id)).toMatchObject({ member_type: 'family', credential_version: 4 })
    await change(id, { memberType: 'tenant' })
    await change(id, { canPay: true })
    expect(await h.row(id)).toMatchObject({
      member_type: 'tenant',
      can_pay: true,
      credential_version: 5,
    })
    await change(id, { status: 'removed' })
    expect(await h.row(id)).toMatchObject({ status: 'removed', credential_version: 6 })
  })

  test('RM-10 the Manager’s lock over the owner’s lock holds, and the owner’s unlock is refused', async () => {
    const { id, unit } = await h.seedMembership({
      status: 'locked',
      lockedBy: 'owner',
      credentialVersion: 2,
    })
    await change(id, { status: 'locked' })
    expect(await h.row(id)).toMatchObject({
      status: 'locked',
      locked_by: 'manager',
      credential_version: 3,
    })
    const memberships = new DrizzleMembershipRepository(h.database)
    const record = await memberships.find({ buildingId: BUILDING }, id)
    expect(() =>
      new Membership(record as NonNullable<typeof record>).unlock({
        kind: 'owner',
        accountId: crypto.randomUUID(),
        unitId: unit.id,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_transition' }))
    await change(id, { status: 'active' })
    expect(await h.row(id)).toMatchObject({
      status: 'active',
      locked_by: null,
      credential_version: 4,
    })
  })

  test('RM-12 a removed member added again is a new row with a later created_at', async () => {
    const first = await h.seedMembership()
    await change(first.id, { status: 'removed' })
    h.clock.advance(60_000)
    const again = await h.seedMembership({ accountId: first.accountId, unit: first.unit })
    const [rows] = await h.admin`
      SELECT (SELECT created_at FROM residency.membership WHERE id = ${again.id}) >
             (SELECT created_at FROM residency.membership WHERE id = ${first.id}) AS later`
    expect(rows?.later).toBe(true)
  })

  test('RM-13 the owner row is neither removed nor retyped by an edit, and the Manager may lock it', async () => {
    const { id } = await h.seedMembership({ memberType: 'owner' })
    expect((await failure(change(id, { status: 'removed' }))).code).toBe('owner_must_transfer')
    expect((await failure(change(id, { memberType: 'family' }))).code).toBe('owner_must_transfer')
    await change(id, { status: 'locked' })
    expect(await h.row(id)).toMatchObject({ status: 'locked', locked_by: 'manager' })
  })

  test('RM-21 can_pay on a family member is 422 can_pay_tenant_only; a helper cannot be retyped (409)', async () => {
    const family = await h.seedMembership({ memberType: 'family' })
    const refused = await failure(change(family.id, { canPay: true }))
    expect(refused.code).toBe('validation_failed')
    expect(JSON.stringify(refused.details)).toContain('can_pay_tenant_only')
    const helper = await h.seedMembership({ memberType: 'helper' })
    expect((await failure(change(helper.id, { memberType: 'family' }))).code).toBe(
      'invalid_transition',
    )
    expect((await h.row(helper.id))?.credential_version).toBe(1)
  })

  test('a membership of another building looks missing, and a Technician is refused', async () => {
    const elsewhere = await h.seedMembership({ unit: await h.seedUnit(OTHER_BUILDING) })
    expect((await failure(change(elsewhere.id, { status: 'locked' }))).code).toBe('not_found')
    const { id } = await h.seedMembership()
    const refused = await failure(
      h.residency.useCases.changeMembership.execute(h.staff('technician'), id, {
        status: 'locked',
      }),
    )
    expect(refused.code).toBe('forbidden')
    expect((await h.row(id))?.status).toBe('active')
  })

  test('each change writes its event and its audit row; a removal also writes the history row', async () => {
    const { id, accountId, unit } = await h.seedMembership({ memberType: 'tenant' })
    await change(id, { status: 'removed' })
    const events = (await h.events('residency.membership_changed.v1')).filter(
      (event) => (event.payload as { membershipId: string }).membershipId === id,
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({
      buildingId: BUILDING,
      unitId: unit.id,
      membershipId: id,
      accountId,
      change: 'removed',
      memberType: 'tenant',
    })
    expect(events[0]?.aggregateId).toBe(unit.id)
    const [audit] = await h.db.sql`
      SELECT action, changes FROM audit.audit_log WHERE object_id = ${id} ORDER BY at DESC LIMIT 1`
    expect(audit?.action).toBe('residency.membership.remove')
    const [history] =
      await h.admin`SELECT kind, actor_kind, details FROM residency.unit_history WHERE unit_id = ${unit.id}`
    expect(history).toMatchObject({
      kind: 'member_removed',
      actor_kind: 'staff',
      details: { accountId, memberType: 'tenant' },
    })
  })

  test('a failed change leaves no event and no audit row (one transaction)', async () => {
    const { id } = await h.seedMembership({ memberType: 'owner' })
    const before = (await h.events('residency.membership_changed.v1')).length
    await failure(change(id, { status: 'removed' }))
    expect((await h.events('residency.membership_changed.v1')).length).toBe(before)
    const [audit] = await h.db
      .sql`SELECT count(*)::int AS n FROM audit.audit_log WHERE object_id = ${id}`
    expect(audit?.n).toBe(0)
  })
})

describe('races', () => {
  test('two parallel locks of one membership: both are the Manager’s, one wins and the other is told invalid_transition', async () => {
    const { id } = await h.seedMembership()
    const results = await Promise.allSettled([
      change(id, { status: 'locked' }),
      change(id, { status: 'locked' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((rejected.reason as DomainError).code).toBe('invalid_transition')
    expect((await h.row(id))?.credential_version).toBe(2)
  })

  test('the owner locks while the Manager locks: the Manager’s lock stands whoever commits last, and the version moves once per change', async () => {
    const { id, unit } = await h.seedMembership()
    const memberships = new DrizzleMembershipRepository(h.database)
    const scope = { buildingId: BUILDING }
    const loaded = await memberships.find(scope, id)
    // The owner decided on the row as it was; the Manager's lock commits first, so the owner's guarded statement finds no row.
    const ownerLock = new Membership(loaded as NonNullable<typeof loaded>).lock({
      kind: 'owner',
      accountId: crypto.randomUUID(),
      unitId: unit.id,
    })
    await change(id, { status: 'locked' })
    expect(await memberships.apply(scope, ownerLock.transition, h.clock.now())).toBeNull()
    expect(await h.row(id)).toMatchObject({
      status: 'locked',
      locked_by: 'manager',
      credential_version: 2,
    })
  })

  test('a lock and a removal in parallel end removed with the version moved twice, never a lock after a removal', async () => {
    for (let round = 0; round < 5; round++) {
      const { id } = await h.seedMembership()
      const results = await Promise.allSettled([
        change(id, { status: 'locked' }),
        change(id, { status: 'removed' }),
      ])
      const state = await h.row(id)
      expect(state?.status).toBe('removed')
      const lockWon = results[0]?.status === 'fulfilled'
      expect(state?.credential_version).toBe(lockWon ? 3 : 2)
    }
  })
})
