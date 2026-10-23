import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { BuildingId } from '@rms/shared-types'
import type { StepUpAction } from '../src/contracts'
import { codeOf, createHarness, type Harness, linkTokenOf, PASSWORD } from './support'

let h: Harness
beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})

const HOUR = 3_600_000
const NEW_PASSWORD = 'Brand-new-pass1'
const useCases = new Proxy({} as Harness['identity']['useCases'], {
  get: (_target, name) => h.identity.useCases[name as keyof Harness['identity']['useCases']],
})

/** A building of its own, so a test about "the last Admin" is not disturbed by the Admins of the others. */
const newBuilding = () => h.ids.next() as BuildingId
type Seeded = Awaited<ReturnType<Harness['seedStaff']>>

const seed = (buildingId: BuildingId, role: Parameters<Harness['seedStaff']>[0] = {}) =>
  h.seedStaff({ ...role, buildingId })

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a failure')
}

/** `POST /staff/step-up` and the delivery of its mail: the proof an Admin sends with a sensitive request. */
async function proofOf(admin: Seeded, action: StepUpAction) {
  await h.identity.useCases.requestStepUp.execute(admin.context, action)
  const mail = (await h.deliverMail()).find(
    (m) => m.to === admin.email && /\b\d{6}\b/.test(m.text) && !m.text.includes('token='),
  )
  if (!mail) throw new Error('no step-up mail')
  return { password: PASSWORD, code: codeOf(mail) }
}

/** The invite mail the relay would deliver to `email`; the mail of other tests that is still pending is left alone. */
async function inviteMailTo(email: string) {
  const mail = (await h.deliverMail()).find((m) => m.to === email && m.text.includes('token='))
  if (!mail) throw new Error(`no invite mail for ${email}`)
  return mail
}

const create = (
  actor: Seeded,
  input: { role: 'admin' | 'manager' | 'technician' | 'guard'; email?: string } & Record<
    string,
    unknown
  >,
) =>
  h.identity.useCases.createStaffAccount.execute(actor.context, {
    fullName: 'New Person',
    email: input.email ?? `new-${h.ids.next()}@sunrise.example`,
    ...input,
  } as Parameters<Harness['identity']['useCases']['createStaffAccount']['execute']>[1])

const rowOf = async (id: string) =>
  (
    await h.db
      .sql`SELECT status, role, email, version, locked_until, failed_attempts FROM identity.staff_account WHERE id = ${id}`
  )[0]

const auditOf = (action: string, objectId: string) =>
  h.db
    .sql`SELECT action, details, reason, actor_role FROM audit.audit_log WHERE action = ${action} AND object_id = ${objectId}`

const families = (id: string) =>
  h.db
    .sql`SELECT revoked_reason FROM identity.refresh_family WHERE account_id = ${id} ORDER BY created_at`

describe('staff accounts (DOC-26 §4.4)', () => {
  test('AU-12: a Manager creates a Technician but not an Admin; an Admin creates all four roles', async () => {
    const building = newBuilding()
    const manager = await seed(building, { role: 'manager' })
    const admin = await seed(building, { role: 'admin' })

    const created = await create(manager, { role: 'technician', language: 'en' })
    expect(created.account).toMatchObject({ role: 'technician', status: 'invited', version: 1 })
    expect(Date.parse(created.inviteExpiresAt)).toBe(h.clock.now().getTime() + 24 * HOUR)
    expect(linkTokenOf(await inviteMailTo(created.account.email))).toBeTruthy()

    // Refused before any proof is asked for, even when none is sent.
    for (const role of ['admin', 'manager'] as const)
      expect(await failure(create(manager, { role }))).toMatchObject({ code: 'forbidden' })

    for (const role of ['manager', 'technician', 'guard'] as const)
      expect((await create(admin, { role })).account.role).toBe(role)
    // An Admin for an Admin: without a proof 403 step_up_required, with one 201.
    expect(await failure(create(admin, { role: 'admin' }))).toMatchObject({
      code: 'step_up_required',
      details: { action: 'admin_change' },
    })
    const proof = await proofOf(admin, 'admin_change')
    const second = await create(admin, { role: 'admin', stepUp: proof })
    expect(second.account.role).toBe('admin')
    const rows = await auditOf('identity.staff.create', second.account.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ details: { stepUp: true } })
    expect(JSON.stringify(rows)).not.toContain(second.account.email)
  })

  test('E-40: the language defaults to the building; a taken email is 409 email_in_use and writes nothing', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const created = await create(admin, { role: 'guard' })
    expect(created.account.language).toBe('vi')
    const before = (await h.outboxOf('identity.mail_requested.v1')).length
    const error = await failure(
      create(admin, { role: 'guard', email: created.account.email.toUpperCase() }),
    )
    expect(error).toMatchObject({ code: 'email_in_use' })
    expect((await h.outboxOf('identity.mail_requested.v1')).length).toBe(before)
  })

  test('AU-13: an invite works at 23 h, not at 25 h (status stays invited), and a resent one works', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const early = await create(admin, { role: 'guard' })
    const earlyMail = await inviteMailTo(early.account.email)
    h.clock.advance(23 * HOUR)
    await h.identity.useCases.setPassword.execute({
      token: linkTokenOf(earlyMail),
      password: NEW_PASSWORD,
    })
    expect((await rowOf(early.account.id))?.status).toBe('active')

    const late = await create(admin, { role: 'guard' })
    const lateMail = await inviteMailTo(late.account.email)
    h.clock.advance(25 * HOUR)
    expect(
      await failure(
        h.identity.useCases.setPassword.execute({
          token: linkTokenOf(lateMail),
          password: NEW_PASSWORD,
        }),
      ),
    ).toMatchObject({ code: 'token_invalid' })
    expect((await rowOf(late.account.id))?.status).toBe('invited')
    await h.identity.useCases.resendStaffInvite.execute(admin.context, late.account.id)
    const resent = await inviteMailTo(late.account.email)
    await h.identity.useCases.setPassword.execute({
      token: linkTokenOf(resent),
      password: NEW_PASSWORD,
    })
    expect((await rowOf(late.account.id))?.status).toBe('active')
  })

  test('AU-14: open tickets block a lock; the Admin forces it with reassignTo and a reason', async () => {
    const building = newBuilding()
    const manager = await seed(building, { role: 'manager' })
    const admin = await seed(building, { role: 'admin' })
    const technician = await seed(building, { role: 'technician' })
    const heir = await seed(building, { role: 'technician' })
    h.openTickets.set(
      technician.id,
      ['assigned', 'accepted', 'in_progress', 'on_hold'].map((status, index) => ({
        ticketId: h.ids.next(),
        code: `YC-261012-00${index}`,
        status,
      })),
    )

    const blocked = await failure(useCases.lockStaffAccount.execute(manager.context, technician.id))
    expect(blocked).toMatchObject({ code: 'staff_has_open_tickets' })
    expect((blocked as { details: { tickets: unknown[] } }).details.tickets).toHaveLength(4)
    // A Manager cannot force, and a reason of the right size is needed.
    expect(
      await failure(
        useCases.lockStaffAccount.execute(manager.context, technician.id, {
          reassignTo: heir.id,
          reason: 'Left the company',
        }),
      ),
    ).toMatchObject({ code: 'forbidden' })
    expect(
      await failure(
        useCases.lockStaffAccount.execute(admin.context, technician.id, {
          reassignTo: heir.id,
          reason: 'no',
        }),
      ),
    ).toMatchObject({ code: 'validation_failed' })
    expect((await rowOf(technician.id))?.status).toBe('active')

    const locked = await useCases.lockStaffAccount.execute(admin.context, technician.id, {
      reassignTo: heir.id,
      reason: 'Left the company; tickets move to the colleague',
    })
    expect(locked.status).toBe('locked')
    expect(h.openTickets.get(technician.id)).toBeUndefined()
    expect(h.openTickets.get(heir.id)).toHaveLength(4)
    const rows = await auditOf('identity.staff.force_lock', technician.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('Left the company; tickets move to the colleague')
  })

  test('AU-14b: the assignee must be an active Technician or Guard', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const technician = await seed(building, { role: 'technician' })
    const manager = await seed(building, { role: 'manager' })
    h.openTickets.set(technician.id, [{ ticketId: h.ids.next(), code: 'YC-1', status: 'assigned' }])
    expect(
      await failure(
        useCases.lockStaffAccount.execute(admin.context, technician.id, {
          reassignTo: manager.id,
          reason: 'Left the company',
        }),
      ),
    ).toMatchObject({ code: 'validation_failed', details: [{ code: 'assignee_locked' }] })
  })

  test('AU-15: a role change, then a lock, end every session with one event per family', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const staff = await seed(building, { role: 'guard' })
    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.21' })
    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.22', client: 'web' })
    const eventsBefore = (await h.outboxOf('identity.session_revoked.v1')).length

    const updated = await useCases.updateStaffAccount.execute(admin.context, staff.id, {
      changes: { role: 'technician' },
      version: 1,
    })
    expect(updated).toMatchObject({ role: 'technician', version: 2 })
    expect((await families(staff.id)).map((f) => f.revoked_reason)).toEqual([
      'role_changed',
      'role_changed',
    ])
    expect((await h.outboxOf('identity.session_revoked.v1')).length).toBe(eventsBefore + 2)

    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.23' })
    await useCases.lockStaffAccount.execute(admin.context, staff.id)
    expect((await families(staff.id)).map((f) => f.revoked_reason)).toEqual([
      'role_changed',
      'role_changed',
      'account_locked',
    ])
    expect((await h.outboxOf('identity.session_revoked.v1')).length).toBe(eventsBefore + 3)
    // The guard reads the row on every request (DOC-12 §5.3): the staff member is no longer active.
    expect((await h.identity.api.getStaff([staff.id]))[0]).toMatchObject({ status: 'locked' })
  })

  test('AU-16: promoting to Admin and changing an email need a step-up; creating an Admin too', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const staff = await seed(building, { role: 'manager' })

    expect(
      await failure(
        useCases.updateStaffAccount.execute(admin.context, staff.id, {
          changes: { role: 'admin' },
          version: 1,
        }),
      ),
    ).toMatchObject({ code: 'step_up_required', details: { action: 'admin_change' } })
    expect(
      await failure(
        useCases.updateStaffAccount.execute(admin.context, staff.id, {
          changes: { email: 'renamed@sunrise.example' },
          version: 1,
        }),
      ),
    ).toMatchObject({ code: 'step_up_required', details: { action: 'staff_email' } })
    expect((await rowOf(staff.id))?.role).toBe('manager')

    // A wrong code is step_up_failed and changes nothing.
    const wrong = await proofOf(admin, 'admin_change')
    expect(
      await failure(
        useCases.updateStaffAccount.execute(admin.context, staff.id, {
          changes: { role: 'admin' },
          version: 1,
          stepUp: { ...wrong, code: wrong.code === '000000' ? '000001' : '000000' },
        }),
      ),
    ).toMatchObject({ code: 'step_up_failed' })
    expect((await rowOf(staff.id))?.role).toBe('manager')

    const promoted = await useCases.updateStaffAccount.execute(admin.context, staff.id, {
      changes: { role: 'admin' },
      version: 1,
      stepUp: await proofOf(admin, 'admin_change'),
    })
    expect(promoted.role).toBe('admin')

    // The email: sessions stay (it is the same person) and the audit row masks it.
    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.31' })
    const renamed = await useCases.updateStaffAccount.execute(admin.context, staff.id, {
      changes: { email: 'renamed@sunrise.example' },
      version: promoted.version,
      stepUp: await proofOf(admin, 'staff_email'),
    })
    expect(renamed.email).toBe('renamed@sunrise.example')
    expect((await families(staff.id)).every((f) => f.revoked_reason === null)).toBe(true)
    const rows = await auditOf('identity.staff.update', staff.id)
    expect(JSON.stringify(rows)).not.toContain('renamed@sunrise.example')
    expect(rows.some((row) => row.details?.stepUp === true)).toBe(true)
  })

  test('AU-17: two Admins lock each other at once; one lock wins, the other is last_admin (race)', async () => {
    const building = newBuilding()
    const a = await seed(building, { role: 'admin' })
    const b = await seed(building, { role: 'admin' })
    const results = await Promise.allSettled([
      useCases.lockStaffAccount.execute(a.context, b.id),
      useCases.lockStaffAccount.execute(b.context, a.id),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'last_admin' })
    const statuses = [(await rowOf(a.id))?.status, (await rowOf(b.id))?.status].sort()
    expect(statuses).toEqual(['active', 'locked'])
  })

  test('last_admin: the last active Admin is not disabled or demoted either', async () => {
    const building = newBuilding()
    const last = await seed(building, { role: 'admin' })
    // A locked Admin may still be the actor of a use case: the guard of the route, not the use case, checks the status.
    const locked = await seed(building, { role: 'admin', status: 'locked' })
    expect(
      await failure(useCases.disableStaffAccount.execute(locked.context, last.id)),
    ).toMatchObject({ code: 'last_admin' })
    expect(
      await failure(
        useCases.updateStaffAccount.execute(locked.context, last.id, {
          changes: { role: 'manager' },
          version: 1,
        }),
      ),
    ).toMatchObject({ code: 'last_admin' })
    expect((await rowOf(last.id))?.status).toBe('active')
    expect((await rowOf(last.id))?.role).toBe('admin')
  })

  test('AU-18: nobody locks, disables or changes the role of their own account', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const manager = await seed(building, { role: 'manager' })
    const self = { code: 'forbidden', details: { reason: 'self' } }
    expect(await failure(useCases.lockStaffAccount.execute(admin.context, admin.id))).toMatchObject(
      self,
    )
    expect(
      await failure(useCases.lockStaffAccount.execute(manager.context, manager.id)),
    ).toMatchObject(self)
    expect(
      await failure(useCases.disableStaffAccount.execute(admin.context, admin.id)),
    ).toMatchObject(self)
    expect(
      await failure(
        useCases.updateStaffAccount.execute(admin.context, admin.id, {
          changes: { role: 'manager' },
          version: 1,
        }),
      ),
    ).toMatchObject(self)
  })

  test('AU-19: a Manager locks, edits and unlocks only Technician and Guard accounts', async () => {
    const building = newBuilding()
    const manager = await seed(building, { role: 'manager' })
    const admin = await seed(building, { role: 'admin' })
    const other = await seed(building, { role: 'manager' })
    for (const target of [admin, other]) {
      expect(
        await failure(useCases.lockStaffAccount.execute(manager.context, target.id)),
      ).toMatchObject({
        code: 'forbidden',
      })
      expect(
        await failure(
          useCases.updateStaffAccount.execute(manager.context, target.id, {
            changes: { fullName: 'Renamed' },
            version: 1,
          }),
        ),
      ).toMatchObject({ code: 'forbidden' })
      expect(
        await failure(useCases.unlockStaffAccount.execute(manager.context, target.id)),
      ).toMatchObject({
        code: 'forbidden',
      })
    }
    // A Manager edits name and language of a Guard, not the role or the email.
    const guard = await seed(building, { role: 'guard' })
    const edited = await useCases.updateStaffAccount.execute(manager.context, guard.id, {
      changes: { fullName: 'Renamed', language: 'en' },
      version: 1,
    })
    expect(edited).toMatchObject({ fullName: 'Renamed', language: 'en', version: 2 })
    for (const changes of [{ role: 'technician' as const }, { email: 'x@sunrise.example' }])
      expect(
        await failure(
          useCases.updateStaffAccount.execute(manager.context, guard.id, { changes, version: 2 }),
        ),
      ).toMatchObject({ code: 'forbidden' })
  })

  test('E-42: If-Match is required and a stale one is 409; a second edit with the same version loses', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const guard = await seed(building, { role: 'guard' })
    expect(
      await failure(
        useCases.updateStaffAccount.execute(admin.context, guard.id, {
          changes: { fullName: 'A' },
          version: undefined,
        }),
      ),
    ).toMatchObject({ code: 'precondition_required' })
    const results = await Promise.allSettled(
      ['A', 'B'].map((fullName) =>
        useCases.updateStaffAccount.execute(admin.context, guard.id, {
          changes: { fullName },
          version: 1,
        }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ code: 'version_conflict' })
  })

  test('E-42: an email of another account is 409 email_in_use', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const taken = await seed(building, { role: 'guard' })
    const guard = await seed(building, { role: 'guard' })
    expect(
      await failure(
        useCases.updateStaffAccount.execute(admin.context, guard.id, {
          changes: { email: taken.email },
          version: 1,
          stepUp: await proofOf(admin, 'staff_email'),
        }),
      ),
    ).toMatchObject({ code: 'email_in_use' })
    expect((await rowOf(guard.id))?.email).toBe(guard.email)
  })

  test('AU-08: unlock lifts the manual lock and a temporary lockout; other states are invalid_transition', async () => {
    const building = newBuilding()
    const manager = await seed(building, { role: 'manager' })
    const locked = await seed(building, { role: 'technician', status: 'locked' })
    const temporary = await seed(building, {
      role: 'guard',
      failedAttempts: 5,
      lockedUntil: new Date(h.clock.now().getTime() + 15 * 60_000),
    })
    const plain = await seed(building, { role: 'guard' })

    expect((await useCases.unlockStaffAccount.execute(manager.context, locked.id)).status).toBe(
      'active',
    )
    await h.signIn(locked.email, PASSWORD, { ip: '198.51.100.41' })
    const lifted = await useCases.unlockStaffAccount.execute(manager.context, temporary.id)
    expect(lifted).toMatchObject({ status: 'active', lockedUntil: null })
    await h.signIn(temporary.email, PASSWORD, { ip: '198.51.100.42' })
    expect(
      await failure(useCases.unlockStaffAccount.execute(manager.context, plain.id)),
    ).toMatchObject({
      code: 'invalid_transition',
      details: { entity: 'staff_account', status: 'active', action: 'unlock' },
    })
  })

  test('AU-37: disable ends every session and sign-in; enable returns active, or invited with no password', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin' })
    const staff = await seed(building, { role: 'technician' })
    const invited = await seed(building, { role: 'guard', status: 'invited', password: null })
    await h.signIn(staff.email, PASSWORD, { ip: '198.51.100.51' })

    expect((await useCases.disableStaffAccount.execute(admin.context, staff.id)).status).toBe(
      'disabled',
    )
    expect((await families(staff.id)).map((f) => f.revoked_reason)).toEqual(['account_disabled'])
    expect(await failure(h.signIn(staff.email, PASSWORD, { ip: '198.51.100.52' }))).toMatchObject({
      code: 'invalid_credentials',
    })
    expect(
      await failure(useCases.disableStaffAccount.execute(admin.context, staff.id)),
    ).toMatchObject({
      code: 'invalid_transition',
    })
    expect((await useCases.enableStaffAccount.execute(admin.context, staff.id)).status).toBe(
      'active',
    )
    await useCases.disableStaffAccount.execute(admin.context, invited.id)
    expect((await useCases.enableStaffAccount.execute(admin.context, invited.id)).status).toBe(
      'invited',
    )
    expect(
      await failure(useCases.enableStaffAccount.execute(admin.context, invited.id)),
    ).toMatchObject({
      code: 'invalid_transition',
    })
    // The Manager may not disable or enable.
    const manager = await seed(building, { role: 'manager' })
    expect(
      await failure(useCases.disableStaffAccount.execute(manager.context, staff.id)),
    ).toBeDefined()
    expect(await auditOf('identity.staff.disable', staff.id)).toHaveLength(1)
  })

  test('E-41, E-39: an id of another building is 404; the list filters, searches without diacritics and pages', async () => {
    const building = newBuilding()
    const admin = await seed(building, { role: 'admin', fullName: 'Admin Một' })
    const manager = await seed(building, { role: 'manager', fullName: 'Nguyễn Văn An' })
    await seed(building, {
      role: 'guard',
      fullName: 'Đặng Thị Bình',
      email: 'dang.binh@sunrise.example',
    })
    await seed(building, { role: 'guard', status: 'locked', fullName: 'Lê Cường' })
    const stranger = await seed(newBuilding(), { role: 'guard' })

    expect(await failure(h.identity.queries.staff.get(admin.context, stranger.id))).toMatchObject({
      code: 'not_found',
    })
    expect(
      await failure(useCases.lockStaffAccount.execute(admin.context, stranger.id)),
    ).toMatchObject({
      code: 'not_found',
    })
    const q = (query: Record<string, unknown>) =>
      h.identity.queries.staff.list(manager.context, { page: 1, pageSize: 10, ...query })
    expect((await q({})).total).toBe(4)
    expect((await q({ role: 'guard' })).total).toBe(2)
    expect((await q({ status: 'locked' })).items.map((i) => i.fullName)).toEqual(['Lê Cường'])
    expect((await q({ q: 'nguyen' })).items.map((i) => i.fullName)).toEqual(['Nguyễn Văn An'])
    expect((await q({ q: 'dang.b' })).items.map((i) => i.fullName)).toEqual(['Đặng Thị Bình'])
    expect((await q({ q: '%' })).total).toBe(0)
    const page = await q({ pageSize: 3, page: 2 })
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 3 })
    expect(page.items).toHaveLength(1)
    // Technicians and Guards read nothing.
    const guard = await seed(building, { role: 'guard' })
    expect(
      await failure(h.identity.queries.staff.list(guard.context, { page: 1, pageSize: 10 })),
    ).toMatchObject({
      code: 'forbidden',
    })
  })
})
