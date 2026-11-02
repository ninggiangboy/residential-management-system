import { cloneTemplate, type TestDb } from '@rms/test-support'

/**
 * The fixture of the finance DDL tests (DOC-15 §13.2): one building with the batch `PH-2610-01` and the charges A-1508,
 * A-1509 and A-1510, plus a second building for the cross-building rows. The ids are fixed UUIDv7-shaped literals in the
 * style of `modules/building/test/support.ts`, so a test names the row it means.
 */

export const B1 = '018f0000-0000-7000-8000-000000000001'
export const B2 = '018f0000-0000-7000-8000-000000000002'
export const BATCH1 = '018f0000-0000-7000-8000-000000000003'
export const UNIT_1508 = '018f0000-0000-7000-8000-000000000004'
export const UNIT_1509 = '018f0000-0000-7000-8000-000000000005'
export const UNIT_1510 = '018f0000-0000-7000-8000-000000000006'
export const UNIT_B2 = '018f0000-0000-7000-8000-000000000007'
export const CHARGE_1508 = '018f0000-0000-7000-8000-000000000008'
export const CHARGE_1509 = '018f0000-0000-7000-8000-000000000009'
export const CHARGE_1510 = '018f0000-0000-7000-8000-00000000000a'
export const CHARGE_121 = '018f0000-0000-7000-8000-00000000000b'
export const STAFF = '018f0000-0000-7000-8000-00000000000c'
export const PAYMENT_K = '018f0000-0000-7000-8000-00000000000d'
export const PAYMENT_K2 = '018f0000-0000-7000-8000-00000000000e'
export const ALLOC_1508 = '018f0000-0000-7000-8000-00000000000f'
export const ALLOC_1509 = '018f0000-0000-7000-8000-000000000010'
export const ALLOC_1508_NEW = '018f0000-0000-7000-8000-000000000011'
export const RECEIPT_1508 = '018f0000-0000-7000-8000-000000000012'
export const RECEIPT_1509 = '018f0000-0000-7000-8000-000000000013'
export const PDF_FILE = '018f0000-0000-7000-8000-000000000014'
export const LINE_1508_1 = '018f0000-0000-7000-8000-000000000015'
export const LINE_1508_2 = '018f0000-0000-7000-8000-000000000016'
export const LINE_1508_ADJ = '018f0000-0000-7000-8000-000000000017'
export const LINE_1509 = '018f0000-0000-7000-8000-000000000018'
export const LINE_1510 = '018f0000-0000-7000-8000-000000000019'
export const INTENT_1 = '018f0000-0000-7000-8000-00000000001a'
export const INTENT_2 = '018f0000-0000-7000-8000-00000000001b'
export const INTENT_CANCELLING = '018f0000-0000-7000-8000-00000000001c'
export const ITEM_1509 = '018f0000-0000-7000-8000-00000000001d'
export const EVENT_PENDING = '018f0000-0000-7000-8000-00000000001e'
export const EVENT_SHORT = '018f0000-0000-7000-8000-00000000001f'
export const IMPORT_DOC = '018f0000-0000-7000-8000-000000000020'
export const STMT_LINE = '018f0000-0000-7000-8000-000000000021'
export const IMPORT_JOB = '018f0000-0000-7000-8000-000000000022'
export const NOTICE_JOB = '018f0000-0000-7000-8000-000000000023'
export const NOTICE_JOB_READY = '018f0000-0000-7000-8000-000000000024'
export const REMINDER = '018f0000-0000-7000-8000-000000000025'
export const FAKE_LINK = '018f0000-0000-7000-8000-000000000026'
export const REJECTION = '018f0000-0000-7000-8000-000000000027'
export const GATEWAY_CONFIG = '018f0000-0000-7000-8000-000000000028'

export const BATCH_NAME = JSON.stringify({ vi: 'Phí tháng 10/2026', en: 'October 2026 fees' })
export const FEE_ITEM = JSON.stringify({ vi: 'Phí quản lý', en: 'Management fee' })
export const ADJUST_ITEM = JSON.stringify({ vi: 'Điều chỉnh', en: 'Adjustment' })
/** A lowercase hex SHA-256 of 64 characters (`ck_statement_line_dedup`). */
export const DEDUP_KEY = 'a'.repeat(64)
export const SNAPSHOT = JSON.stringify({ unitCode: 'A-1508', amount: 2638000 })

/** Each test file clones the migrated template database (DOC-88 §6). */
export const openTestDb = (): Promise<TestDb> => cloneTemplate('empty')
