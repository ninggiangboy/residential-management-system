import { randomUUID } from 'node:crypto'
import type { TestDb } from '@rms/test-support'

export const BUILDING_ID = '018f0000-0000-7000-8000-000000000001'
export const PASSWORD = 'Sunrise2026!'

/** The staff the specs sign in with. Each spec may create more through the UI. */
export const STAFF = {
  admin: { email: 'admin@sunrise.example', name: 'Phạm Thu Hà', role: 'admin' },
  admin2: { email: 'admin2@sunrise.example', name: 'Đỗ Hai', role: 'admin' },
  manager: { email: 'manager@sunrise.example', name: 'Lê Văn Quản', role: 'manager' },
  technician: { email: 'tech@sunrise.example', name: 'Trần Kỹ Thuật', role: 'technician' },
  guard: { email: 'guard@sunrise.example', name: 'Vũ Bảo Vệ', role: 'guard' },
} as const

/**
 * One building and its staff, as the integration tests of `apps/api` seed them (the rows are inserted as the migrator because the
 * application role cannot create accounts). The accounts are `active` with a known password.
 */
export async function seed(db: TestDb): Promise<void> {
  await db.sql`
    INSERT INTO building.building (id, code, name, company, address, hotline, working_hours, email, is_demo)
    VALUES (${BUILDING_ID}, 'SUNRISE-A', '{"vi":"Chung cư Sunrise A","en":"Sunrise A Apartments"}',
            '{"name":{"vi":"Công ty Sunrise"},"taxCode":"0312345678"}', '12 Nguyễn Huệ', '1900 1234',
            '{"vi":"Thứ 2 – Thứ 6, 8:00 – 17:00"}', 'bql@sunrise.example', false)`
  await db.sql`INSERT INTO building.building_setting (building_id) VALUES (${BUILDING_ID})`
  const hash = await Bun.password.hash(PASSWORD, {
    algorithm: 'argon2id',
    memoryCost: 256,
    timeCost: 1,
  })
  for (const person of Object.values(STAFF))
    await db.sql`
      INSERT INTO identity.staff_account (id, building_id, email, full_name, role, status, password_hash, language)
      VALUES (${randomUUID()}, ${BUILDING_ID}, ${person.email}, ${person.name}, ${person.role}, 'active', ${hash}, 'vi')`
}
