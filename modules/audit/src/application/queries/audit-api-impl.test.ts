import { describe, expect, test } from 'bun:test'
import { RuleViolationError } from '@core/kernel'
import type { BuildingId, StaffContext, StaffId } from '@rms/shared-types'
import type { SystemActor } from '../../contracts'
import type { AuditRow } from '../../domain/audit-log-repository'
import {
  NoTransactionError,
  UndeclaredAuditActionError,
  UnmaskedAuditFieldError,
} from '../../domain/errors'
import { auditActionCatalogOf } from '../action-catalog'
import { createAudited } from '../audited'
import { RecordAuditEntry } from '../use-cases/record-audit-entry'
import { AuditApiImpl } from './audit-api-impl'

const building = '018f0000-0000-7000-8000-000000000001' as BuildingId
const staff: StaffContext = {
  buildingId: building,
  staffId: '018f0000-0000-7000-8000-0000000000a1' as StaffId,
  role: 'manager',
  scope: { buildingId: building },
}
const system: SystemActor = { kind: 'system', source: 'webhook', buildingId: building }
const objectId = '018f0000-0000-7000-8000-0000000000b1'

function harness(options: { inTransaction?: boolean; failInsert?: boolean } = {}) {
  const rows: Array<AuditRow & { buildingId: string }> = []
  const lines: { fields: Record<string, unknown>; message: string }[] = []
  const transaction = { inTransaction: options.inTransaction ?? true }
  let failures = 0
  const log = (level: string) => (fields: object, message: string) =>
    lines.push({ fields: { level, ...fields }, message })
  const writer = new AuditApiImpl(
    new RecordAuditEntry({
      repository: {
        async insert(scope, row) {
          if (options.failInsert) throw new Error('insert failed')
          rows.push({ ...row, buildingId: scope.buildingId })
        },
      },
      transaction,
      ids: {
        next: () => `018f0000-0000-7000-8000-00000000${String(rows.length + 1).padStart(4, '0')}`,
      },
      actions: auditActionCatalogOf([
        { name: 'finance', auditActions: ['finance.payment.void', 'finance.payment.post'] },
        { name: 'residency', auditActions: ['residency.unit.update'] },
      ]),
      requestInfo: () => ({ requestId: 'req-1', ip: '203.0.113.9', userAgent: 'RmsApp/1.0' }),
      logger: { info: log('info'), warn: log('warn'), error: log('error') },
      metrics: { writeFailed: () => failures++ },
    }),
  )
  return { writer, rows, lines, transaction, failures: () => failures }
}

describe('AuditApi.record (DOC-35 §3)', () => {
  test('AD-04 record with no open transaction throws NoTransactionError and writes nothing', async () => {
    const { writer, rows } = harness({ inTransaction: false })
    await expect(
      writer.record({
        actor: staff,
        action: 'finance.payment.void',
        object: { type: 'payment', id: objectId },
        changes: [],
        reason: 'wrong unit',
      }),
    ).rejects.toBeInstanceOf(NoTransactionError)
    expect(rows).toHaveLength(0)
  })

  test('AD-05 an action the module did not declare is refused; pii.read is open to every module', async () => {
    const { writer, rows } = harness()
    const entry = { actor: staff, object: { type: 'payment', id: objectId }, changes: [] }
    await expect(
      writer.record({ ...entry, action: 'finance.payment.destroy' }),
    ).rejects.toBeInstanceOf(UndeclaredAuditActionError)
    // declared by `finance`, written under another module's name
    await expect(
      writer.record({ ...entry, action: 'residency.payment.void' }),
    ).rejects.toBeInstanceOf(UndeclaredAuditActionError)
    expect(rows).toHaveLength(0)
    await writer.record({ ...entry, action: 'pii.read', details: { view: 'detail' } })
    expect(rows).toHaveLength(1)
  })

  test('AD-07 a staff row carries the actor, role, request context, object, changes and reason', async () => {
    const { writer, rows } = harness()
    await writer.record({
      actor: staff,
      action: 'finance.payment.void',
      object: { type: 'payment', id: objectId },
      changes: [{ field: 'status', before: 'posted', after: 'void' }],
      reason: ' wrong unit ',
    })
    expect(rows).toEqual([
      {
        id: expect.any(String),
        buildingId: building,
        actorKind: 'staff',
        actorId: staff.staffId,
        actorRole: 'manager',
        ip: '203.0.113.9',
        userAgent: 'RmsApp/1.0',
        requestId: 'req-1',
        action: 'finance.payment.void',
        objectType: 'payment',
        objectId,
        changes: [{ field: 'status', before: 'posted', after: 'void' }],
        details: {},
        reason: 'wrong unit',
      },
    ])
  })

  test('AD-14 a system row has no actor id and no role', async () => {
    const { writer, rows } = harness()
    await writer.record({
      actor: system,
      action: 'finance.payment.post',
      object: { type: 'payment', id: objectId },
      changes: [],
      details: { source: 'webhook', amount: 2838000 },
    })
    expect(rows[0]).toMatchObject({
      actorKind: 'system',
      actorId: null,
      actorRole: null,
      buildingId: building,
      details: { source: 'webhook', amount: 2838000 },
    })
  })

  test('AD-09 a plain secret is refused before anything is written', async () => {
    const { writer, rows } = harness()
    await expect(
      writer.record({
        actor: staff,
        action: 'residency.unit.update',
        object: { type: 'unit', id: objectId },
        changes: [{ field: 'secrets', before: 'abc', after: 'def' }],
      }),
    ).rejects.toBeInstanceOf(UnmaskedAuditFieldError)
    expect(rows).toHaveLength(0)
  })

  test('AD-08 record itself also refuses a reason action without a reason', async () => {
    const { writer, rows } = harness()
    await expect(
      writer.record({
        actor: staff,
        action: 'finance.payment.void',
        object: { type: 'payment', id: objectId },
        changes: [],
        reason: 'no',
      }),
    ).rejects.toBeInstanceOf(RuleViolationError)
    expect(rows).toHaveLength(0)
  })

  test('AD-03 a failed insert propagates, is counted and is logged without the changes', async () => {
    const { writer, lines, failures } = harness({ failInsert: true })
    await expect(
      writer.record({
        actor: staff,
        action: 'residency.unit.update',
        object: { type: 'unit', id: objectId },
        changes: [{ field: 'floor', before: '1', after: '2' }],
      }),
    ).rejects.toThrow('insert failed')
    expect(failures()).toBe(1)
    expect(lines.map((l) => l.message)).toEqual(['audit.record_failed'])
    expect(JSON.stringify(lines)).not.toContain('floor')
  })

  test('AD-29 the log line of a recorded row names the action and object and never the changes', async () => {
    const { writer, lines } = harness()
    await writer.record({
      actor: staff,
      action: 'residency.unit.update',
      object: { type: 'unit', id: objectId },
      changes: [{ field: 'phone', before: '+84•••••567', after: '+84•••••999' }],
    })
    expect(lines).toEqual([
      {
        fields: {
          level: 'info',
          action: 'residency.unit.update',
          objectType: 'unit',
          requestId: 'req-1',
        },
        message: 'audit.record',
      },
    ])
  })
})

describe('audited (DOC-35 §3.2)', () => {
  test('AD-08 a short reason stops the use case before its body runs', async () => {
    const { writer, rows } = harness()
    let ran = false
    const voidPayment = createAudited(writer)(
      {
        action: 'finance.payment.void',
        object: (r: { id: string }) => ({ type: 'payment', id: r.id }),
        reason: (_actor, cmd) => cmd.reason,
      },
      async (_actor: StaffContext, _cmd: { reason: string }) => {
        ran = true
        return { result: { id: objectId }, changes: [] }
      },
    )
    await expect(voidPayment(staff, { reason: 'four' })).rejects.toBeInstanceOf(RuleViolationError)
    expect(ran).toBe(false)
    expect(rows).toHaveLength(0)
  })

  test('AD-07 it records what the body returns, masked as the spec says, and returns the result', async () => {
    const { writer, rows } = harness()
    const updateUnit = createAudited(writer)(
      {
        action: 'residency.unit.update',
        object: (r: { id: string }) => ({ type: 'unit', id: r.id }),
        masks: { ownerPhone: 'phone' },
        details: () => ({ edited: 1 }),
      },
      async (_actor: StaffContext, _cmd: { floor: number }) => ({
        result: { id: objectId },
        changes: [
          { field: 'floor', before: 1, after: 2 },
          { field: 'ownerPhone', before: '+84901234567', after: '+84907654999' },
        ],
      }),
    )
    expect(await updateUnit(staff, { floor: 2 })).toEqual({ id: objectId })
    expect(rows[0]?.changes).toEqual([
      { field: 'floor', before: 1, after: 2 },
      { field: 'ownerPhone', before: '+84•••••567', after: '+84•••••999' },
    ])
    expect(rows[0]?.details).toEqual({ edited: 1 })
  })

  test('AD-01 a body that throws writes no row', async () => {
    const { writer, rows } = harness()
    const failing = createAudited(writer)(
      { action: 'residency.unit.update', object: () => ({ type: 'unit', id: objectId }) },
      async (_actor: StaffContext) => {
        throw new Error('the mutation failed')
      },
    )
    await expect(failing(staff)).rejects.toThrow('the mutation failed')
    expect(rows).toHaveLength(0)
  })
})
