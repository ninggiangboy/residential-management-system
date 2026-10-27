import type { BuildingScope } from '@rms/shared-types'
import type { GatewayDriver, GatewayProvider, ReceivingAccount } from '../contracts'

export interface GatewayConfigRecord {
  id: string
  buildingId: string
  provider: GatewayProvider
  driver: GatewayDriver
  secretsEnc: string
  receivingAccount: ReceivingAccount
  status: 'active' | 'disabled'
  lastCheckAt: Date | null
  lastCheckOk: boolean | null
  version: number
}

export interface GatewayConfigRepository {
  findActive(
    scope: BuildingScope,
    provider: GatewayProvider,
    lock?: 'share' | 'update',
  ): Promise<GatewayConfigRecord | null>
  /** `SELECT … FOR UPDATE` of the row at the version the client read (DOC-36 §7.3 step 3). */
  lockForUpdate(
    scope: BuildingScope,
    id: string,
    expectedVersion: number,
  ): Promise<GatewayConfigRecord | null>
  insert(
    scope: BuildingScope,
    record: Omit<GatewayConfigRecord, 'version' | 'lastCheckAt' | 'lastCheckOk'>,
  ): Promise<void>
  updateGuarded(
    scope: BuildingScope,
    id: string,
    expectedVersion: number,
    fields: Pick<GatewayConfigRecord, 'secretsEnc' | 'receivingAccount' | 'driver' | 'status'>,
  ): Promise<number | null>
  /** The compare-and-set of the key rotation (RB-12): zero rows when someone else wrote first. */
  replaceBlob(scope: BuildingScope, id: string, oldBlob: string, newBlob: string): Promise<boolean>
  /** Boot guard check 2 (DOC-36 §10.1): the `fake` configurations of buildings that are not demo buildings, across buildings by design. */
  // scope-ok: the boot guard looks across buildings by design
  idsOfFakeOutsideDemo(): Promise<string[]>
  /** Boot guard check 6: the key ids of the stored blobs. */
  // scope-ok: the boot guard looks across buildings by design
  keyIds(): Promise<string[]>
}
