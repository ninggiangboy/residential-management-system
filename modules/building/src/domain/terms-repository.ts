import type { BuildingScope } from '@rms/shared-types'
import type { Bilingual, TermsKind } from '../contracts'

export interface TermsVersionRecord {
  id: string
  kind: TermsKind
  version: number
  text: Bilingual
}

/** A published version with who published it and how many accounts accepted it (E-52). */
export interface TermsVersionListing extends TermsVersionRecord {
  publishedBy: string
  publishedAt: Date
  acceptedCount: number
}

/** The latest version of a kind with its text, and whether one account has accepted it (E-16). */
export interface TermsAcceptanceView extends TermsVersionRecord {
  accepted: boolean
}

export interface TermsRepository {
  /** Every version of the kind (both when `null`), newest first, with the number of acceptances. */
  list(
    scope: BuildingScope,
    kind: TermsVersionRecord['kind'] | null,
  ): Promise<TermsVersionListing[]>
  /** The rows of the gate of DOC-35 §9.2: the latest version of each kind that the account has not accepted. */
  missing(
    scope: BuildingScope,
    accountId: string,
  ): Promise<Array<Pick<TermsVersionRecord, 'id' | 'kind' | 'version'>>>
  /** The latest version of each kind with the account's acceptance, in the order of the gate. */
  latestFor(scope: BuildingScope, accountId: string): Promise<TermsAcceptanceView[]>
  latest(scope: BuildingScope): Promise<Array<Pick<TermsVersionRecord, 'id' | 'kind' | 'version'>>>
  /** The next number of the kind; a lost race is the unique index, which the caller turns into 409. */
  insertNext(
    scope: BuildingScope,
    row: { id: string; kind: TermsKind; text: Bilingual; publishedBy: string },
  ): Promise<number>
  /** The statement of DOC-35 §9.3: `true` when this call inserted the acceptance. */
  accept(
    scope: BuildingScope,
    row: { accountId: string; versionId: string; ip: string | null; appVersion: string | null },
  ): Promise<boolean>
  /** Whether an acceptance of that version already exists (UC-27 E3). */
  isAccepted(scope: BuildingScope, accountId: string, versionId: string): Promise<boolean>
  exists(scope: BuildingScope, versionId: string): Promise<boolean>
}
