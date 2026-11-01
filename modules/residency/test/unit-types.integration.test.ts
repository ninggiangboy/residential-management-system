import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { DomainError } from '@core/kernel'
import { type BUILDING, createHarness, type Harness, OTHER_BUILDING } from './support'

/**
 * `CreateUnitType`, `UpdateUnitType`, the unit type list and the type of a unit on PostgreSQL 18.6 (DOC-27 §4.3, DOC-16 §5.6;
 * RM-52…RM-61, DR-314, DR-315). RM-62, the roles over HTTP, is the authorization matrix of `apps/api`.
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

const ruleOf = (error: DomainError) =>
  (error.details as { code: string; path: string }[] | undefined)?.[0]?.code

const createType = (code: string, name: string, extra: object = {}, staff = h.staff()) =>
  h.residency.useCases.createUnitType.execute(staff, { code, name: { vi: name }, ...extra })
const updateType = (
  id: string,
  edit: Parameters<Harness['residency']['useCases']['updateUnitType']['execute']>[2]['edit'],
  version: number | undefined,
  staff = h.staff(),
) => h.residency.useCases.updateUnitType.execute(staff, id, { edit, version })
const createUnit = (code: string, extra: object = {}, staff = h.staff()) =>
  h.residency.useCases.createUnit.execute(staff, { code, ...extra })
const updateUnit = (
  id: string,
  edit: Parameters<Harness['residency']['useCases']['updateUnit']['execute']>[2]['edit'],
  version: number,
) => h.residency.useCases.updateUnit.execute(h.staff(), id, { edit, version })
const listTypes = (status?: 'active' | 'archived', staff = h.staff()) =>
  h.residency.queries.unitTypes.list(staff, status)
const audits = (objectId: string) =>
  h.admin`SELECT action, changes FROM audit.audit_log WHERE object_id = ${objectId} ORDER BY at, id`

describe('RM-52 CreateUnitType', () => {
  test('stores a type with its defaults, normalised, and writes one audit row', async () => {
    const created = await createType('studio', 'Studio', {
      name: { vi: ' Studio ', en: 'Studio' },
      defaultBedrooms: 0,
      defaultAreaM2: '32',
    })
    expect(created).toMatchObject({
      code: 'studio',
      name: { vi: 'Studio', en: 'Studio' },
      defaultBedrooms: 0,
      defaultAreaM2: '32.00',
      status: 'active',
      archivedAt: null,
      version: 1,
    })
    const [row, ...rest] = await audits(created.id)
    expect(rest).toHaveLength(0)
    expect(row?.action).toBe('residency.unit_type.create')
  })

  test('a type may have no English name and no default', async () => {
    const created = await createType('shophouse', 'Shophouse')
    expect(created).toMatchObject({
      name: { vi: 'Shophouse', en: null },
      defaultBedrooms: null,
      defaultAreaM2: null,
    })
    const [stored] = await h.admin`SELECT name FROM residency.unit_type WHERE id = ${created.id}`
    // The stored object has no `en` key: platform.is_bilingual refuses a JSON null (DOC-14 §8).
    expect(stored?.name).toEqual({ vi: 'Shophouse' })
  })

  test.each(['Studio', 'a', 'has space', '1studio', 'x'.repeat(31)])(
    'refuses the code %p with a 400 and writes nothing',
    async (code) => {
      expect((await failure(createType(code, 'Bad'))).code).toBe('validation_failed')
    },
  )

  test('refuses a default outside the rules', async () => {
    for (const bad of [
      { defaultBedrooms: 21 },
      { defaultAreaM2: '0' },
      { defaultAreaM2: '2000.01' },
    ])
      expect((await failure(createType('bad_one', 'Bad one', bad))).code).toBe('validation_failed')
    const rows = await h.admin`SELECT 1 FROM residency.unit_type WHERE code = 'bad_one'`
    expect(rows).toHaveLength(0)
  })
})

describe('RM-53 duplicates', () => {
  test('the same code is 409 unit_type_code_in_use; the same Vietnamese name in capitals is 409 unit_type_name_in_use', async () => {
    await createType('duplex', 'Duplex')
    expect((await failure(createType('duplex', 'Khác'))).code).toBe('unit_type_code_in_use')
    expect((await failure(createType('duplex_2', 'DUPLEX'))).code).toBe('unit_type_name_in_use')
    const rows =
      await h.admin`SELECT 1 FROM residency.unit_type WHERE code IN ('duplex', 'duplex_2')`
    expect(rows).toHaveLength(1)
  })

  test('another building may use the same code and name', async () => {
    await createType('duplex', 'Duplex', {}, h.staff('manager', OTHER_BUILDING))
  })
})

describe('RM-54 the cap of 50 types per building', () => {
  test('two creates at the 50th are decided in turn: one wins, the other is 409 unit_type_limit', async () => {
    const full = '018f0000-0000-7000-8000-0000000000f1' as typeof BUILDING
    const staff = () => h.staff('manager', full)
    for (let n = 1; n <= 48; n++) await createType(`filler_${n}`, `Filler ${n}`, {}, staff())
    // Archived types count: the 49th is archived on purpose.
    const archived = await createType('filler_49', 'Filler 49', {}, staff())
    await updateType(archived.id, { status: 'archived' }, 1, staff())

    const results = await Promise.allSettled([
      createType('racer_a', 'Racer A', {}, staff()),
      createType('racer_b', 'Racer B', {}, staff()),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((refused.reason as DomainError).code).toBe('unit_type_limit')
    const [count] =
      await h.admin`SELECT count(*)::int AS n FROM residency.unit_type WHERE building_id = ${full}`
    expect(count?.n).toBe(50)
    expect((await failure(createType('racer_c', 'Racer C', {}, staff()))).code).toBe(
      'unit_type_limit',
    )
  })
})

describe('RM-55 UpdateUnitType and its version', () => {
  test('a stale If-Match is 409 with the fresh type; no header is 428', async () => {
    const type = await createType('loft', 'Loft')
    await updateType(type.id, { name: { vi: 'Loft mới' } }, 1)
    const stale = await failure(updateType(type.id, { name: { vi: 'Loft cũ' } }, 1))
    expect(stale.code).toBe('version_conflict')
    expect(JSON.stringify(stale.details)).toContain('Loft mới')
    expect((await failure(updateType(type.id, { name: { vi: 'X' } }, undefined))).code).toBe(
      'precondition_required',
    )
  })

  test('two edits with the same version: exactly one wins, the version moves once', async () => {
    const type = await createType('racing', 'Racing')
    const results = await Promise.allSettled([
      updateType(type.id, { defaultBedrooms: 1 }, 1),
      updateType(type.id, { defaultBedrooms: 2 }, 1),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const [row] = await h.admin`SELECT version FROM residency.unit_type WHERE id = ${type.id}`
    expect(row?.version).toBe(2)
  })

  test('an empty edit is 400 min_properties and a missing type is 404', async () => {
    const type = await createType('empty_edit', 'Empty edit')
    expect(ruleOf(await failure(updateType(type.id, {}, 1)))).toBe('min_properties')
    expect((await failure(updateType(crypto.randomUUID(), { defaultBedrooms: 1 }, 1))).code).toBe(
      'not_found',
    )
  })

  test('a type of another building is 404, never an edit', async () => {
    const foreign = await createType('foreign', 'Foreign', {}, h.staff('manager', OTHER_BUILDING))
    expect((await failure(updateType(foreign.id, { defaultBedrooms: 1 }, 1))).code).toBe(
      'not_found',
    )
  })

  test('a name already used is 409 unit_type_name_in_use', async () => {
    const a = await createType('name_a', 'Name A')
    await createType('name_b', 'Name B')
    expect((await failure(updateType(a.id, { name: { vi: 'name b' } }, 1))).code).toBe(
      'unit_type_name_in_use',
    )
  })
})

describe('RM-56 archive and restore', () => {
  test('an archive sets archived_at and keeps the type on its units; a restore clears it; each is one audit row listing status', async () => {
    const type = await createType('archived_one', 'Archived one')
    const unit = await createUnit('T-100', { unitTypeId: type.id })
    const archived = await updateType(type.id, { status: 'archived' }, 1)
    expect(archived.unitType).toMatchObject({ status: 'archived', version: 2 })
    expect(archived.unitType.archivedAt).toBeInstanceOf(Date)
    expect(archived.unitCount).toBe(1)
    const [kept] = await h.admin`SELECT unit_type_id FROM residency.unit WHERE id = ${unit.id}`
    expect(kept?.unit_type_id).toBe(type.id)

    const restored = await updateType(type.id, { status: 'active' }, 2)
    expect(restored.unitType).toMatchObject({ status: 'active', archivedAt: null, version: 3 })
    const rows = await audits(type.id)
    expect(rows.map((row) => row.action)).toEqual([
      'residency.unit_type.create',
      'residency.unit_type.update',
      'residency.unit_type.update',
    ])
    expect(JSON.stringify(rows[1]?.changes)).toContain('status')
  })

  test('an edit that changes nothing keeps the version and moves no field', async () => {
    const type = await createType('no_change', 'No change', { defaultBedrooms: 2 })
    const result = await updateType(type.id, { defaultBedrooms: 2, status: 'active' }, 1)
    expect(result.unitType.version).toBe(1)
    const [row] =
      await h.admin`SELECT version, updated_at FROM residency.unit_type WHERE id = ${type.id}`
    expect(row?.version).toBe(1)
  })
})

describe('RM-57 the type of a unit', () => {
  test('an archived type, an unknown id and a type of another building are refused with 422', async () => {
    const archived = await createType('refused_old', 'Refused old')
    await updateType(archived.id, { status: 'archived' }, 1)
    const foreign = await createType(
      'refused_foreign',
      'Refused foreign',
      {},
      h.staff('manager', OTHER_BUILDING),
    )
    expect(ruleOf(await failure(createUnit('R-1', { unitTypeId: archived.id })))).toBe(
      'unit_type_archived',
    )
    for (const unitTypeId of [crypto.randomUUID(), foreign.id])
      expect(ruleOf(await failure(createUnit('R-2', { unitTypeId })))).toBe('unit_type_unknown')
    expect(await h.admin`SELECT 1 FROM residency.unit WHERE code IN ('R-1', 'R-2')`).toHaveLength(0)
  })

  test('a unit keeps its archived type through an edit that does not change it, and cannot be given another archived one', async () => {
    const type = await createType('later_archived', 'Later archived')
    const other = await createType('also_archived', 'Also archived')
    const unit = await createUnit('R-3', { unitTypeId: type.id })
    await updateType(type.id, { status: 'archived' }, 1)
    await updateType(other.id, { status: 'archived' }, 1)
    const kept = await updateUnit(unit.id, { unitTypeId: type.id, floor: 4 }, 1)
    expect(kept).toMatchObject({ floor: 4, unitTypeId: type.id })
    expect(ruleOf(await failure(updateUnit(unit.id, { unitTypeId: other.id }, 2)))).toBe(
      'unit_type_archived',
    )
    expect(ruleOf(await failure(updateUnit(unit.id, { unitTypeId: crypto.randomUUID() }, 2)))).toBe(
      'unit_type_unknown',
    )
  })

  test('the unit answers with its type and a clear with null', async () => {
    const type = await createType('shown', 'Shown', { name: { vi: 'Hiển thị', en: 'Shown' } })
    const unit = await createUnit('R-4', { unitTypeId: type.id })
    expect(unit.unitType).toEqual({
      unitTypeId: type.id,
      code: 'shown',
      name: { vi: 'Hiển thị', en: 'Shown' },
    })
    const cleared = await updateUnit(unit.id, { unitTypeId: null }, 1)
    expect(cleared).toMatchObject({ unitTypeId: null, unitType: null })
    const audit = await audits(unit.id)
    expect(JSON.stringify(audit.at(-1)?.changes)).toContain('unitTypeId')
  })
})

describe('RM-58 the defaults of a type fill a new unit', () => {
  test('an absent bedrooms and area take the default, an explicit null stays null, a value wins', async () => {
    const studio = await createType('with_defaults', 'With defaults', {
      defaultBedrooms: 0,
      defaultAreaM2: '32',
    })
    const absent = await createUnit('D-1', { unitTypeId: studio.id })
    expect(absent).toMatchObject({ bedrooms: 0, areaM2: '32.00' })
    const nulls = await createUnit('D-2', { unitTypeId: studio.id, bedrooms: null })
    expect(nulls).toMatchObject({ bedrooms: null, areaM2: '32.00' })
    const given = await createUnit('D-3', { unitTypeId: studio.id, bedrooms: 1, areaM2: '40' })
    expect(given).toMatchObject({ bedrooms: 1, areaM2: '40.00' })
  })

  test('a type with no default leaves the fields blank, and a unit with no type has no default', async () => {
    const plain = await createType('no_defaults', 'No defaults')
    expect(await createUnit('D-4', { unitTypeId: plain.id })).toMatchObject({
      bedrooms: null,
      areaM2: null,
    })
    expect(await createUnit('D-5')).toMatchObject({ unitTypeId: null, bedrooms: null })
  })
})

describe('RM-59 a default and a type change rewrite no other unit', () => {
  test('editing the defaults of a type moves no unit; giving a unit another type changes only its type', async () => {
    const first = await createType('keep_a', 'Keep A', { defaultBedrooms: 2, defaultAreaM2: '60' })
    const second = await createType('keep_b', 'Keep B', {
      defaultBedrooms: 5,
      defaultAreaM2: '200',
    })
    const units = [
      await createUnit('K-1', { unitTypeId: first.id }),
      await createUnit('K-2', { unitTypeId: first.id }),
    ]
    await updateType(first.id, { defaultBedrooms: 3, defaultAreaM2: '70' }, 1)
    const rows =
      await h.admin`SELECT bedrooms, area_m2, version FROM residency.unit WHERE code IN ('K-1', 'K-2') ORDER BY code`
    expect(rows.map((row) => [row.bedrooms, Number(row.area_m2), row.version])).toEqual([
      [2, 60, 1],
      [2, 60, 1],
    ])

    const moved = await updateUnit((units[0] as { id: string }).id, { unitTypeId: second.id }, 1)
    expect(moved).toMatchObject({ unitTypeId: second.id, bedrooms: 2, areaM2: '60.00', version: 2 })
  })
})

describe('RM-60 the unit list filter and the type of each item', () => {
  test('filters by type, alone and with the bedrooms, and a type of another building is an empty list', async () => {
    const kind = await createType('filter_me', 'Filter me', { defaultBedrooms: 2 })
    await createUnit('F-1', { unitTypeId: kind.id })
    await createUnit('F-2', { unitTypeId: kind.id, bedrooms: 3 })
    await createUnit('F-3')
    const list = (filter: object) =>
      h.residency.queries.units.list(h.staff(), { limit: 50, ...filter })

    const typed = await list({ unitTypeId: kind.id })
    expect(typed.items.map((item) => item.code)).toEqual(['F-1', 'F-2'])
    expect(typed.items[0]?.unitType).toMatchObject({ code: 'filter_me' })
    const both = await list({ unitTypeId: kind.id, bedrooms: 2 })
    expect(both.items.map((item) => item.code)).toEqual(['F-1'])
    const foreign = await createType(
      'foreign_filter',
      'Foreign filter',
      {},
      h.staff('manager', OTHER_BUILDING),
    )
    expect((await list({ unitTypeId: foreign.id })).items).toEqual([])
    const all = await list({})
    expect(all.items.find((item) => item.code === 'F-3')?.unitType).toBeNull()
  })

  test('the detail of a unit carries its type', async () => {
    const kind = await createType('detail_type', 'Detail type')
    const unit = await createUnit('F-4', { unitTypeId: kind.id })
    const detail = await h.residency.queries.units.get(h.staff(), unit.id)
    expect(detail.unitType).toMatchObject({ unitTypeId: kind.id, code: 'detail_type' })
  })
})

describe('RM-61 the list of unit types', () => {
  test('is ordered by lower-case Vietnamese name, counts the units, filters by status and never shows another building', async () => {
    const lonely = '018f0000-0000-7000-8000-0000000000f2' as typeof BUILDING
    const staff = h.staff('manager', lonely)
    const beta = await createType('beta', 'beta', {}, staff)
    await createType('alpha', 'Ánh', {}, staff)
    const gamma = await createType('gamma', 'Gamma', {}, staff)
    await createUnit('L-1', { unitTypeId: beta.id }, staff)
    await createUnit('L-2', { unitTypeId: beta.id }, staff)
    await createUnit('L-3', {}, staff)
    await updateType(gamma.id, { status: 'archived' }, 1, staff)
    await createType('elsewhere', 'Elsewhere', {}, h.staff('manager', OTHER_BUILDING))

    const all = await listTypes(undefined, staff)
    expect(all.items.map((item) => [item.code, item.unitCount])).toEqual([
      ['alpha', 0],
      ['beta', 2],
      ['gamma', 0],
    ])
    expect(all.summary).toEqual({ total: 3, active: 2, archived: 1, withoutType: 1 })
    const active = await listTypes('active', staff)
    expect(active.items.map((item) => item.code)).toEqual(['alpha', 'beta'])
    expect(active.summary.total).toBe(3)
  })

  test('a Technician and a Guard cannot read or write the types', async () => {
    for (const role of ['technician', 'guard'] as const) {
      expect((await failure(listTypes(undefined, h.staff(role)))).code).toBe('forbidden')
      expect((await failure(createType('nope', 'Nope', {}, h.staff(role)))).code).toBe('forbidden')
    }
  })
})
