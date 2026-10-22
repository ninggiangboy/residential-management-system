import { type ValidationDetail, ValidationError } from '@core/kernel'
import type { GatewayDriver, ReceivingAccount } from '../contracts'
import type { GatewayConfigRecord } from './gateway-config-repository'

/**
 * The fields each driver needs (DOC-36 §7). payOS is DOC-36's own example; the VietQR names are provisional until DOC-24 meets
 * the gateway sandbox (DR-25) and change only this table, not the schema (a new driver adds no column, DR-33).
 */
export const GATEWAY_DRIVERS: Readonly<Record<GatewayDriver, { fields: readonly string[] }>> = {
  payos: { fields: ['clientId', 'apiKey', 'checksumKey'] },
  vietqr: { fields: ['clientId', 'apiKey'] },
  fake: { fields: [] },
}

const MASKED_DOTS = '••••'

/** `••••` plus the last 4 characters; a secret shorter than 8 characters shows `••••` only, so it is not revealed (BD-18). */
export const maskSecret = (value: string): string =>
  value.length < 8 ? MASKED_DOTS : `${MASKED_DOTS}${value.slice(-4)}`

/** `0011001234567` → `0011…4567`: enough to recognise the account in the log, not enough to use it (DOC-35 §3.4). */
export const maskAccountNumber = (value: string): string =>
  value.length >= 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : `…${value.slice(-4)}`

/** One line of an audit row: the field and its two values, never a secret (DOC-35 §3.4). */
export interface FieldChange {
  field: string
  before: string | null
  after: string | null
}

/** What a save wants the configuration to become. */
export interface GatewayTarget {
  driver: GatewayDriver
  status: 'active' | 'disabled'
  receivingAccount: ReceivingAccount
  /** A field present replaces the stored one; an absent field keeps it. */
  secrets?: Record<string, string>
}

const BANK_BIN = /^[0-9]{6}$/
const ACCOUNT_NUMBER = /^[0-9]{6,20}$/
const ACCOUNT_NAME = /^[A-Z0-9 ]{1,50}$/

function assertAccount(account: ReceivingAccount): void {
  const problems: ValidationDetail[] = []
  if (!BANK_BIN.test(account.bankBin))
    problems.push({ path: 'receivingAccount.bankBin', code: 'pattern', message: 'six digits' })
  if (!ACCOUNT_NUMBER.test(account.accountNumber))
    problems.push({
      path: 'receivingAccount.accountNumber',
      code: 'pattern',
      message: '6 to 20 digits',
    })
  if (!ACCOUNT_NAME.test(account.accountName))
    problems.push({
      path: 'receivingAccount.accountName',
      code: 'pattern',
      message: '1 to 50 upper-case letters, digits and spaces',
    })
  if (problems.length > 0) throw new ValidationError(problems)
}

/** Field by field: a `jsonb` column does not keep the order of the keys it was given. */
const sameAccount = (a: ReceivingAccount, b: ReceivingAccount) =>
  a.bankBin === b.bankBin && a.accountNumber === b.accountNumber && a.accountName === b.accountName

function diffAccount(before: ReceivingAccount | null, after: ReceivingAccount): FieldChange[] {
  const out: FieldChange[] = []
  const shown = (key: keyof ReceivingAccount, value: string | undefined) =>
    value === undefined ? null : key === 'accountNumber' ? maskAccountNumber(value) : value
  for (const key of ['bankBin', 'accountNumber', 'accountName'] as const)
    if (before?.[key] !== after[key])
      out.push({
        field: `receivingAccount.${key}`,
        before: shown(key, before?.[key]),
        after: shown(key, after[key]),
      })
  return out
}

function requireFields(fields: readonly string[], secrets: Record<string, string>): void {
  const missing = fields.filter((field) => !secrets[field])
  if (missing.length > 0)
    throw new ValidationError(
      missing.map((field) => ({
        path: `secrets.${field}`,
        code: 'required',
        message: 'required by the driver',
      })),
    )
}

/**
 * The payment-gateway configuration of one provider in one building (DOC-36 §7, DR-33). The rules that need no I/O live here:
 * which fields a driver needs, what a change of target is, how stored and given secrets merge, and what the audit row says.
 * The encryption, the lock and the conditional `UPDATE` stay with the use case and the repository.
 */
export class GatewayConfig {
  constructor(readonly record: GatewayConfigRecord) {}

  /** The receiving account is well formed (DOC-36 §7.2); checked before the step-up is asked. */
  static assertAccount(account: ReceivingAccount): void {
    assertAccount(account)
  }

  /** Every given secret is a field of the driver (DOC-36 §7.3). */
  static assertKnownSecrets(target: Pick<GatewayTarget, 'driver' | 'secrets'>): void {
    const wanted = GATEWAY_DRIVERS[target.driver]
    const unknown = Object.keys(target.secrets ?? {}).filter((key) => !wanted.fields.includes(key))
    if (unknown.length > 0)
      throw new ValidationError(
        unknown.map((key) => ({
          path: `secrets.${key}`,
          code: 'unknown_key',
          message: 'not a field of the driver',
        })),
      )
  }

  /** A first configuration needs every secret of the driver; the audit row names what was set, masked. */
  static create(target: GatewayTarget): {
    secrets: Record<string, string>
    changes: FieldChange[]
  } {
    const secrets = { ...target.secrets }
    requireFields(GATEWAY_DRIVERS[target.driver].fields, secrets)
    return {
      secrets,
      changes: [
        { field: 'secrets', before: null, after: '[masked]' },
        { field: 'driver', before: null, after: target.driver },
        { field: 'status', before: null, after: target.status },
        ...diffAccount(null, target.receivingAccount),
      ],
    }
  }

  /** The driver, the status or the receiving account moves: a payment in progress would be paid to the old one (FR-38.3). */
  changesTarget(target: GatewayTarget): boolean {
    return (
      target.driver !== this.record.driver ||
      target.status !== this.record.status ||
      !sameAccount(target.receivingAccount, this.record.receivingAccount)
    )
  }

  /** The secrets after a save, and the lines of the audit row. A new driver starts from the given secrets only. */
  merge(
    target: GatewayTarget,
    stored: Record<string, string>,
  ): { secrets: Record<string, string>; changes: FieldChange[] } {
    const driverChanged = target.driver !== this.record.driver
    const secrets = driverChanged ? { ...target.secrets } : { ...stored, ...target.secrets }
    requireFields(GATEWAY_DRIVERS[target.driver].fields, secrets)
    const secretsChanged =
      driverChanged ||
      Object.entries(target.secrets ?? {}).some(([key, value]) => stored[key] !== value)
    return {
      secrets,
      changes: [
        // The row says the secrets changed, never what they were; a re-save of the same values changes nothing.
        ...(secretsChanged ? [{ field: 'secrets', before: '[masked]', after: '[masked]' }] : []),
        ...diffAccount(this.record.receivingAccount, target.receivingAccount),
        ...(driverChanged
          ? [{ field: 'driver', before: this.record.driver, after: target.driver }]
          : []),
        ...(target.status !== this.record.status
          ? [{ field: 'status', before: this.record.status, after: target.status }]
          : []),
      ],
    }
  }
}
