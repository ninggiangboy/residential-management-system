import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import { createHarness, type Harness } from './support'

/** `TransferOwnership` on PostgreSQL 18.6 (DOC-27 §7, DOC-51 E-61; RM-23…RM-28, RM-25 as two parallel calls). */

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

const transfer = (
  unitId: string,
  input: Partial<
    Parameters<Harness['residency']['useCases']['transferOwnership']['execute']>[2]
  > = {},
  staff = h.staff(),
) =>
  h.residency.useCases.transferOwnership.execute(staff, unitId, {
    phone: '0912345678',
    fullName: 'Trần Thị Bình',
    keepMembers: false,
    reason: 'Sold on 2026-10-15; contract 15/2026',
    version: 1,
    ...input,
  })

/** A unit with an owner and three members of the other types, as the units page of a building has them. */
async function crowded(code: string) {
  const unit = await h.seedUnit(undefined, code)
  const owner = await h.seedMembership({ unit, memberType: 'owner' })
  const members = [
    await h.seedMembership({ unit, memberType: 'family' }),
    await h.seedMembership({ unit, memberType: 'tenant', canPay: true }),
    await h.seedMembership({ unit, memberType: 'helper' }),
  ]
  return { unit, owner, members }
}

const live = (unitId: string) =>
  h.admin`SELECT id, account_id, member_type, status, credential_version, created_at
            FROM residency.membership WHERE unit_id = ${unitId} AND status <> 'removed' ORDER BY created_at, id`

describe('TransferOwnership', () => {
  test('RM-23 removes the old owner and the 3 members, adds the new owner, writes history, events and the audit row', async () => {
    const { unit, owner, members } = await crowded('T-1')
    const result = await transfer(unit.id)
    expect(result).toMatchObject({
      removedMembers: 4,
      accountCreated: true,
      unit: { code: 'T-1', version: 2 },
    })
    const rows = await live(unit.id)
    expect(rows).toMatchObject([
      { member_type: 'owner', status: 'active', account_id: result.owner.accountId },
    ])
    for (const old of [owner, ...members]) expect((await h.row(old.id))?.status).toBe('removed')
    const [history] =
      await h.admin`SELECT kind, actor_kind, details FROM residency.unit_history WHERE unit_id = ${unit.id}`
    expect(history).toMatchObject({
      kind: 'owner_changed',
      actor_kind: 'staff',
      details: {
        from: owner.accountId,
        to: result.owner.accountId,
        keepMembers: false,
        removedMembers: 4,
      },
    })
    expect(
      (await h.events('residency.owner_changed.v1')).filter((e) => e.aggregateId === unit.id),
    ).toHaveLength(1)
    const removed = (await h.events('residency.membership_changed.v1')).filter(
      (e) => e.aggregateId === unit.id && (e.payload as { change: string }).change === 'removed',
    )
    expect(removed).toHaveLength(4)
    const [audit] =
      await h.admin`SELECT action, reason, details, changes FROM audit.audit_log WHERE object_id = ${unit.id}`
    expect(audit).toMatchObject({
      action: 'residency.owner.transfer',
      reason: 'Sold on 2026-10-15; contract 15/2026',
      details: { removedOthers: 4 },
      changes: [{ field: 'owner', before: owner.id, after: result.owner.membershipId }],
    })
    // No invitation SMS (DR-137) and the credential of each removed membership moved (DR-48).
    expect((await h.row(owner.id))?.credential_version).toBe(2)
  })

  test('RM-24 keepMembers removes only the old owner; members keep their rows and created_at', async () => {
    const { unit, owner, members } = await crowded('T-2')
    const before = await live(unit.id)
    const result = await transfer(unit.id, { keepMembers: true })
    expect(result.removedMembers).toBe(1)
    expect((await h.row(owner.id))?.status).toBe('removed')
    const after = await live(unit.id)
    expect(after).toHaveLength(4)
    for (const member of members) {
      const was = before.find((row) => row.id === member.id)
      const is = after.find((row) => row.id === member.id)
      expect(is?.created_at).toEqual(was?.created_at)
      expect(is?.credential_version).toBe(1)
    }
  })

  test('RM-25 two transfers with the same If-Match: one wins, the other is 409 version_conflict; one owner', async () => {
    const { unit } = await crowded('T-3')
    const results = await Promise.allSettled([
      transfer(unit.id, { phone: '0912000031' }),
      transfer(unit.id, { phone: '0912000032' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const [loser] = results.filter((r) => r.status === 'rejected')
    const error = (loser as PromiseRejectedResult).reason as DomainError
    expect(error.code).toBe('version_conflict')
    const owners = (await live(unit.id)).filter((row) => row.member_type === 'owner')
    expect(owners).toHaveLength(1)
    // The loser rolled back: its account was not created.
    const accounts =
      await h.admin`SELECT phone FROM identity.resident_account WHERE phone IN ('+84912000031', '+84912000032')`
    expect(accounts).toHaveLength(1)
  })

  test('RM-26 a transfer to a current tenant promotes the same row: created_at kept, credential_version + 1', async () => {
    const { unit, members } = await crowded('T-4')
    const tenant = members[1]
    if (!tenant) throw new Error('seed')
    const phone = '+84913000041'
    await h.admin`INSERT INTO identity.resident_account (id, phone, display_name) VALUES (${tenant.accountId}, ${phone}, 'Tenant')`
    const [was] =
      await h.admin`SELECT created_at, credential_version FROM residency.membership WHERE id = ${tenant.id}`
    const result = await transfer(unit.id, { phone, keepMembers: true })
    expect(result).toMatchObject({
      owner: { membershipId: tenant.id, accountId: tenant.accountId },
      accountCreated: false,
    })
    const [now] =
      await h.admin`SELECT member_type, status, created_at, credential_version FROM residency.membership WHERE id = ${tenant.id}`
    expect(now).toMatchObject({ member_type: 'owner', status: 'active' })
    expect(now?.created_at).toEqual(was?.created_at)
    expect(now?.credential_version).toBe((was?.credential_version as number) + 1)
  })

  test('RM-26 a locked tenant promoted by a transfer is active again', async () => {
    const unit = await h.seedUnit(undefined, 'T-5')
    const locked = await h.seedMembership({
      unit,
      memberType: 'tenant',
      status: 'locked',
      lockedBy: 'owner',
    })
    const phone = '+84913000051'
    await h.admin`INSERT INTO identity.resident_account (id, phone, display_name) VALUES (${locked.accountId}, ${phone}, 'Locked')`
    await transfer(unit.id, { phone })
    expect(await h.row(locked.id)).toMatchObject({
      member_type: 'owner',
      status: 'active',
      locked_by: null,
    })
  })

  test('RM-27 a missing or short reason is 422 reason_too_short; a missing If-Match is 428; nothing is written', async () => {
    const { unit } = await crowded('T-6')
    const short = await failure(transfer(unit.id, { reason: 'four' }))
    expect(short.code).toBe('validation_failed')
    expect(JSON.stringify(short.details)).toContain('reason_too_short')
    expect((await failure(transfer(unit.id, { reason: '' }))).code).toBe('validation_failed')
    expect((await failure(transfer(unit.id, { version: undefined }))).code).toBe(
      'precondition_required',
    )
    expect(await live(unit.id)).toHaveLength(4)
    const [stored] = await h.admin`SELECT version FROM residency.unit WHERE id = ${unit.id}`
    expect(stored?.version).toBe(1)
  })

  test("RM-28 a transfer to the current owner's phone is 409 member_exists and rolls everything back", async () => {
    const unit = await h.seedUnit(undefined, 'T-7')
    const owner = await h.seedMembership({ unit, memberType: 'owner' })
    const phone = '+84913000071'
    await h.admin`INSERT INTO identity.resident_account (id, phone, display_name) VALUES (${owner.accountId}, ${phone}, 'Owner')`
    const error = await failure(transfer(unit.id, { phone }))
    expect(error.code).toBe('member_exists')
    expect(JSON.stringify(error.details)).toContain(owner.id)
    expect((await h.row(owner.id))?.status).toBe('active')
    const [stored] = await h.admin`SELECT version FROM residency.unit WHERE id = ${unit.id}`
    expect(stored?.version).toBe(1)
  })

  test("a stale If-Match is 409 version_conflict with the fresh unit; another building's unit and an unknown one are 404", async () => {
    const { unit } = await crowded('T-8')
    const stale = await failure(transfer(unit.id, { version: 7 }))
    expect(stale.code).toBe('version_conflict')
    expect(JSON.stringify(stale.details)).toContain('"version":1')
    const foreign = await h.seedUnit('018f0000-0000-7000-8000-0000000000b1' as never, 'T-9')
    expect((await failure(transfer(foreign.id))).code).toBe('not_found')
    expect((await failure(transfer(crypto.randomUUID()))).code).toBe('not_found')
  })

  test('an ownerless unit gets its first owner with history from null; a number valid nowhere is 400', async () => {
    const unit = await h.seedUnit(undefined, 'T-10')
    expect((await failure(transfer(unit.id, { phone: '123' }))).code).toBe('validation_failed')
    await transfer(unit.id)
    const [history] =
      await h.admin`SELECT details FROM residency.unit_history WHERE unit_id = ${unit.id}`
    expect(history?.details).toMatchObject({ from: null, removedMembers: 0 })
  })

  test('a Technician and a Guard are refused before anything is written', async () => {
    const { unit } = await crowded('T-11')
    for (const role of ['technician', 'guard'] as const)
      expect((await failure(transfer(unit.id, {}, h.staff(role)))).code).toBe('forbidden')
    expect(await live(unit.id)).toHaveLength(4)
  })
})
