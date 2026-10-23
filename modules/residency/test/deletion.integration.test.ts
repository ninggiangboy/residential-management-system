import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Envelope } from '@core/messaging'
import { BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/** The handler of an account deletion (DOC-27 §12, RM-46, RM-47) on PostgreSQL 18.6, in the inbox pattern. */

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const envelope = (accountId: string, id = crypto.randomUUID()): Envelope => ({
  id,
  type: 'identity.account_deletion_executed.v1',
  source: 'identity',
  aggregateId: accountId,
  occurredAt: h.clock.now().toISOString(),
  payload: { buildingId: null, accountId, executedAt: h.clock.now().toISOString() },
  headers: {},
})

const handler = () => {
  const found = h.residency.handlers?.find(
    (candidate) => candidate.eventType === 'identity.account_deletion_executed.v1',
  )
  if (!found) throw new Error('no handler')
  return found
}

describe('residency.clear_profile_on_identity_account_deletion_executed', () => {
  test('RM-46 an account with two memberships: both removed, two history rows by system, the profile cleared, two events', async () => {
    const accountId = crypto.randomUUID()
    const first = await h.seedMembership({ accountId, memberType: 'tenant' })
    const second = await h.seedMembership({ accountId, memberType: 'family', credentialVersion: 3 })
    const other = await h.seedMembership({ memberType: 'tenant' })
    await h.seedProfile(accountId, BUILDING, 'Nguyễn Văn An')
    await handler().handle(envelope(accountId))
    expect(await h.row(first.id)).toMatchObject({ status: 'removed', credential_version: 2 })
    expect(await h.row(second.id)).toMatchObject({ status: 'removed', credential_version: 4 })
    expect((await h.row(other.id))?.status).toBe('active')
    const history = await h.admin`
      SELECT kind, actor_kind, actor_id, details FROM residency.unit_history
       WHERE unit_id IN (${first.unit.id}, ${second.unit.id}) ORDER BY kind`
    expect(history).toHaveLength(2)
    for (const entry of history) {
      expect(entry).toMatchObject({ kind: 'member_removed', actor_kind: 'system', actor_id: null })
      expect(entry.details.source).toBe('account_deletion')
    }
    const [profile] =
      await h.admin`SELECT * FROM residency.resident_profile WHERE account_id = ${accountId}`
    expect(profile).toMatchObject({
      full_name: null,
      email: null,
      cccd_enc: null,
      date_of_birth: null,
      version: 2,
    })
    expect(profile?.cleared_at).not.toBeNull()
    const events = (await h.events('residency.membership_changed.v1')).filter((event) =>
      [first.id, second.id].includes((event.payload as { membershipId: string }).membershipId),
    )
    expect(events).toHaveLength(2)
    expect(
      events.every((event) => (event.payload as { change: string }).change === 'removed'),
    ).toBe(true)
  })

  test('RM-47 a second delivery of the message, and a second message, change nothing', async () => {
    const accountId = crypto.randomUUID()
    const { id } = await h.seedMembership({ accountId })
    await h.seedProfile(accountId)
    const message = envelope(accountId)
    await handler().handle(message)
    await handler().handle(message)
    await handler().handle(envelope(accountId))
    expect((await h.row(id))?.credential_version).toBe(2)
    const [history] =
      await h.admin`SELECT count(*)::int AS n FROM residency.unit_history WHERE details->>'source' = 'account_deletion' AND unit_id = (SELECT unit_id FROM residency.membership WHERE id = ${id})`
    expect(history?.n).toBe(1)
    const [profile] =
      await h.admin`SELECT version FROM residency.resident_profile WHERE account_id = ${accountId}`
    expect(profile?.version).toBe(2)
  })

  test('memberships in every building go, and a profile cleared once keeps its first cleared_at', async () => {
    const accountId = crypto.randomUUID()
    const here = await h.seedMembership({ accountId, unit: await h.seedUnit(BUILDING) })
    const there = await h.seedMembership({ accountId, unit: await h.seedUnit(OTHER_BUILDING) })
    await h.seedProfile(accountId, BUILDING)
    await h.seedProfile(accountId, OTHER_BUILDING)
    await handler().handle(envelope(accountId))
    expect((await h.row(here.id))?.status).toBe('removed')
    expect((await h.row(there.id))?.status).toBe('removed')
    const [before] =
      await h.admin`SELECT cleared_at FROM residency.resident_profile WHERE account_id = ${accountId} AND building_id = ${BUILDING}`
    h.clock.advance(3_600_000)
    await handler().handle(envelope(accountId))
    const [after] =
      await h.admin`SELECT cleared_at FROM residency.resident_profile WHERE account_id = ${accountId} AND building_id = ${BUILDING}`
    expect(after?.cleared_at).toEqual(before?.cleared_at)
  })

  test('an owner row removed here is logged and the unit is left without an owner', async () => {
    const accountId = crypto.randomUUID()
    const { id, unit } = await h.seedMembership({ accountId, memberType: 'owner' })
    await handler().handle(envelope(accountId))
    expect((await h.row(id))?.status).toBe('removed')
    const [owners] =
      await h.admin`SELECT count(*)::int AS n FROM residency.membership WHERE unit_id = ${unit.id} AND member_type = 'owner' AND status <> 'removed'`
    expect(owners?.n).toBe(0)
  })
})
