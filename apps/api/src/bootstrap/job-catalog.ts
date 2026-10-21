import type { JobMode, Schedule } from '@core/runtime'

/**
 * The 23 jobs of DOC-38 §4.1 as data: name, owning module, schedule and mode. A module's `jobs` must match its rows (the
 * catalog test of P1-05 checks the names, the schedules and the 32 distinct lock hashes, JB-10); the grace window of a clock
 * job is the key `JOB_<NAME>_GRACE_MINUTES` of DOC-41 §11. The catalog builds nothing, so a script can read it.
 */
export interface JobCatalogEntry {
  name: string
  module: string
  schedule: Schedule
  mode: JobMode
}

const every = (seconds: number): Schedule => ({ kind: 'every', seconds })
const hourly = (minute: number): Schedule => ({ kind: 'hourly', minute })
const daily = (at: string): Schedule => ({ kind: 'daily', at })
const sunday = (at: string): Schedule => ({ kind: 'weekly', day: 'sun', at })
const monday = (at: string): Schedule => ({ kind: 'weekly', day: 'mon', at })

export const JOB_CATALOG: readonly JobCatalogEntry[] = [
  { name: 'notice_scheduler', module: 'notices', schedule: every(30), mode: 'claim' },
  { name: 'notice_reclaim', module: 'notices', schedule: every(60), mode: 'claim' },
  { name: 'intent_requery', module: 'finance', schedule: every(30), mode: 'claim' },
  { name: 'push_receipts', module: 'notification', schedule: every(300), mode: 'claim' },
  { name: 'export_run', module: 'reporting', schedule: every(5), mode: 'claim' },
  { name: 'fee_notice_run', module: 'finance', schedule: every(5), mode: 'claim' },
  { name: 'storage_quota', module: 'building', schedule: hourly(5), mode: 'lock' },
  { name: 'orphan_uploads', module: 'building', schedule: hourly(15), mode: 'lock' },
  { name: 'import_expire', module: 'residency', schedule: hourly(25), mode: 'lock' },
  { name: 'export_purge', module: 'reporting', schedule: hourly(35), mode: 'lock' },
  { name: 'realtime_purge', module: 'realtime', schedule: hourly(45), mode: 'lock' },
  { name: 'invariant_check', module: 'finance', schedule: daily('03:00'), mode: 'snapshot' },
  { name: 'qr_scan_purge', module: 'access', schedule: daily('03:45'), mode: 'lock' },
  { name: 'otp_purge', module: 'identity', schedule: daily('03:45'), mode: 'lock' },
  { name: 'token_purge', module: 'identity', schedule: daily('03:45'), mode: 'lock' },
  { name: 'account_deletion', module: 'identity', schedule: daily('03:45'), mode: 'lock' },
  { name: 'demo_reset', module: 'building', schedule: daily('04:00'), mode: 'lock' },
  { name: 'integrity_weekly', module: 'residency', schedule: monday('03:30'), mode: 'snapshot' },
  { name: 'integrity_notices', module: 'notices', schedule: monday('03:30'), mode: 'snapshot' },
  { name: 'inbox_purge', module: 'notification', schedule: sunday('04:00'), mode: 'lock' },
  { name: 'import_purge', module: 'residency', schedule: sunday('04:00'), mode: 'lock' },
  { name: 'finance_purge', module: 'finance', schedule: sunday('04:00'), mode: 'lock' },
  {
    name: 'audit_purge',
    module: 'audit',
    schedule: { kind: 'monthly', day: 1, at: '04:30' },
    mode: 'lock',
  },
]

/** The cleanup locks of the relay, one per publishing schema (DOC-38 §2.5), which must not collide with a job lock. */
export const OUTBOX_CLEANUP_SOURCES = [
  'finance',
  'residency',
  'identity',
  'tickets',
  'vehicles',
  'notices',
  'notification',
  'reporting',
  'building',
] as const
