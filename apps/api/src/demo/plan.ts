import {
  DEMO_SEED_VERSION,
  type DemoPlan,
  type DemoResidentSeed,
  type DemoStaffSeed,
  type DemoUnitSeed,
  type DemoUnitTypeSeed,
} from '@rms/shared-types'

export { DEMO_SEED_VERSION }

/**
 * The seed of the demo building `DEMO-A` as data (DOC-36 §9.1): `buildDemoPlan()` is pure, so the same plan fills `local`
 * (`bun run seed:demo`), is reset every night at 04:00 and by `POST /staff/demo/reset`. The ids are fixed UUIDv7-shaped constants
 * (DOC-36 §10.2 item 5): a link in the demo script or a store reviewer's note stays valid after a reset. A module reads its own
 * part of the plan; the parts that belong to modules not built yet (finance, tickets, notices, vehicles, wiki, access) join with
 * their tasks.
 */

/** `018f0d<kind>-0000-7000-8000-<sequence>`: the kind keeps the families of ids apart, the sequence is the row. */
const demoId = (kind: number, sequence: number) =>
  `018f0d${kind.toString(16).padStart(2, '0')}-0000-7000-8000-${sequence.toString(16).padStart(12, '0')}`

const KIND = {
  building: 1,
  gateway: 2,
  terms: 3,
  staff: 4,
  account: 5,
  unit: 6,
  membership: 7,
  unitType: 8,
} as const

export const DEMO_BUILDING_ID = demoId(KIND.building, 1)

const FLOORS = 15
const UNITS_PER_FLOOR = 16

const pad = (value: number) => String(value).padStart(2, '0')
const unitCode = (floor: number, number: number) => `A-${pad(floor)}${pad(number)}`

/** The five kinds of unit of the demo building and the defaults of each (DOC-36 §9, DR-314, DR-315). */
const UNIT_TYPES: readonly Omit<DemoUnitTypeSeed, 'id'>[] = [
  {
    code: 'apartment',
    name: { vi: 'Căn hộ', en: 'Apartment' },
    defaultBedrooms: 2,
    defaultAreaM2: 68,
  },
  { code: 'studio', name: { vi: 'Studio', en: 'Studio' }, defaultBedrooms: 0, defaultAreaM2: 32 },
  { code: 'duplex', name: { vi: 'Duplex', en: 'Duplex' }, defaultBedrooms: 3, defaultAreaM2: 120 },
  {
    code: 'penthouse',
    name: { vi: 'Penthouse', en: 'Penthouse' },
    defaultBedrooms: 4,
    defaultAreaM2: 180,
  },
  {
    code: 'shophouse',
    name: { vi: 'Shophouse', en: 'Shophouse' },
    defaultBedrooms: null,
    defaultAreaM2: 90,
  },
]

/**
 * The type of a unit by its place: floor 1 units 01 to 08 are shophouses, floor 14 units 01 to 12 duplexes, floor 15 units 13 to
 * 16 penthouses, units 01 and 02 of floors 2 to 13 studios, every other unit an apartment: 192, 24, 12, 8 and 4 of the 240.
 */
function unitTypeOf(floor: number, number: number): string {
  if (floor === 1 && number <= 8) return 'shophouse'
  if (floor === 14 && number <= 12) return 'duplex'
  if (floor === 15 && number >= 13) return 'penthouse'
  if (floor >= 2 && floor <= 13 && number <= 2) return 'studio'
  return 'apartment'
}

/**
 * 240 units `A-0101`…`A-1516`: 200 occupied, 25 rented, 15 vacant. The last unit of each floor is vacant; the rented ones are the
 * fourteenth of each floor, the twelfth of floors 1 to 8, and the two units of the demo whose household has a tenant.
 */
function demoUnits(): DemoUnitSeed[] {
  const rentedByHand = new Set([unitCode(15, 8), unitCode(3, 2)])
  const units: DemoUnitSeed[] = []
  for (let floor = 1; floor <= FLOORS; floor++)
    for (let number = 1; number <= UNITS_PER_FLOOR; number++) {
      const code = unitCode(floor, number)
      const unitTypeCode = unitTypeOf(floor, number)
      // A type other than the apartment takes its own defaults; an apartment keeps the rotation of 1 to 3 bedrooms.
      const type = UNIT_TYPES.find(
        (candidate) => candidate.code === unitTypeCode,
      ) as (typeof UNIT_TYPES)[number]
      const rotation = 1 + ((floor + number) % 3)
      const bedrooms = unitTypeCode === 'apartment' ? rotation : type.defaultBedrooms
      const areaM2 =
        unitTypeCode === 'apartment'
          ? 30 + rotation * 15 + (number % 4) * 2.5
          : (type.defaultAreaM2 as number)
      const occupancy =
        number === UNITS_PER_FLOOR
          ? 'vacant'
          : number === 14 || (number === 12 && floor <= 8) || rentedByHand.has(code)
            ? 'rented'
            : 'occupied'
      units.push({
        id: demoId(KIND.unit, (floor - 1) * UNITS_PER_FLOOR + number),
        code,
        floor,
        unitTypeCode,
        bedrooms,
        areaM2,
        occupancy,
      })
    }
  return units
}

const STAFF: readonly Omit<DemoStaffSeed, 'id'>[] = [
  { email: 'admin@demo.rms.invalid', fullName: 'Quản trị Demo', role: 'admin' },
  { email: 'manager@demo.rms.invalid', fullName: 'Quản lý Demo', role: 'manager' },
  { email: 'technician@demo.rms.invalid', fullName: 'Kỹ thuật Demo', role: 'technician' },
  { email: 'guard@demo.rms.invalid', fullName: 'Bảo vệ Demo', role: 'guard' },
]

/** The eight accounts of DOC-36 §9.1: fictional numbers of the North American range reserved for fiction (`555-0100…0199`). */
const RESIDENTS: readonly {
  phone: string
  displayName: string
  memberships: readonly {
    unitCode: string
    memberType: DemoResidentSeed['memberships'][number]['memberType']
    canPay: boolean
  }[]
}[] = [
  {
    phone: '+12025550101',
    displayName: 'Demo Owner',
    memberships: [{ unitCode: 'A-1508', memberType: 'owner', canPay: true }],
  },
  {
    phone: '+12025550102',
    displayName: 'Demo Family',
    memberships: [{ unitCode: 'A-1508', memberType: 'family', canPay: true }],
  },
  {
    phone: '+12025550103',
    displayName: 'Demo Tenant',
    memberships: [{ unitCode: 'A-1508', memberType: 'tenant', canPay: true }],
  },
  {
    phone: '+12025550104',
    displayName: 'Demo Helper',
    memberships: [{ unitCode: 'A-1508', memberType: 'helper', canPay: false }],
  },
  {
    phone: '+12025550105',
    displayName: 'Demo Owner 2',
    memberships: [{ unitCode: 'A-0302', memberType: 'owner', canPay: true }],
  },
  {
    phone: '+12025550106',
    displayName: 'Demo Tenant 2',
    memberships: [{ unitCode: 'A-0302', memberType: 'tenant', canPay: false }],
  },
  {
    phone: '+12025550107',
    displayName: 'Demo Owner 3',
    memberships: [
      { unitCode: 'A-0505', memberType: 'owner', canPay: true },
      { unitCode: 'A-0506', memberType: 'owner', canPay: true },
    ],
  },
  {
    phone: '+12025550108',
    displayName: 'Store review',
    memberships: [{ unitCode: 'A-0101', memberType: 'owner', canPay: true }],
  },
]

export function buildDemoPlan(): DemoPlan {
  const staff = STAFF.map((person, at) => ({ ...person, id: demoId(KIND.staff, at + 1) }))
  let membershipCount = 0
  const residents: DemoResidentSeed[] = RESIDENTS.map((resident, at) => ({
    id: demoId(KIND.account, at + 1),
    phone: resident.phone,
    displayName: resident.displayName,
    memberships: resident.memberships.map((member) => ({
      ...member,
      id: demoId(KIND.membership, ++membershipCount),
    })),
  }))
  const admin = staff[0]
  if (!admin) throw new Error('the demo plan has no admin')
  return {
    building: {
      id: DEMO_BUILDING_ID,
      code: 'DEMO-A',
      name: { vi: 'Chung cư Demo A', en: 'Demo A Apartments' },
      company: {
        name: { vi: 'Công ty TNHH Quản lý Demo', en: 'Demo Management Co.' },
        taxCode: '0000000000',
        address: '1 Đường Demo, Quận 1, TP. Hồ Chí Minh',
        phone: '1900 0000',
        email: 'company@demo.rms.invalid',
        representative: 'Nguyễn Văn Demo',
      },
      address: '1 Đường Demo, Quận 1, TP. Hồ Chí Minh',
      hotline: '1900 0000',
      email: 'bql@demo.rms.invalid',
      workingHours: { vi: 'Thứ 2 – Thứ 6, 8:00 – 17:00', en: 'Mon – Fri, 8:00 – 17:00' },
      timeZone: 'Asia/Ho_Chi_Minh',
    },
    gateway: {
      id: demoId(KIND.gateway, 1),
      provider: 'payos',
      driver: 'fake',
      receivingAccount: {
        bankBin: '970436',
        accountNumber: '0000000000',
        accountName: 'DEMO APARTMENTS',
      },
    },
    terms: [
      {
        id: demoId(KIND.terms, 1),
        kind: 'terms',
        text: {
          vi: '## DEMO — không phải văn bản pháp lý\n\nĐiều khoản dùng thử của tòa nhà demo.',
        },
      },
      {
        id: demoId(KIND.terms, 2),
        kind: 'privacy',
        text: {
          vi: '## DEMO — không phải văn bản pháp lý\n\nThông báo quyền riêng tư dùng thử của tòa nhà demo.',
        },
      },
    ],
    termsPublisherId: admin.id,
    unitTypes: UNIT_TYPES.map((type, at) => ({ ...type, id: demoId(KIND.unitType, at + 1) })),
    units: demoUnits(),
    staff,
    residents,
  }
}
