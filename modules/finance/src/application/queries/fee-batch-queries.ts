import { NotFoundError } from '@core/kernel'
import type { BuildingScope } from '@rms/shared-types'
import type { FeeBatchRecord } from '../../domain/fee-batch'
import type { ChargeWithLines, FeeBatchReader } from '../../domain/fee-batch-reader'

/** Query service of the batch screens (DOC-12 §4.5): no use case file per read. */
export class FeeBatchQueries {
  constructor(private readonly reader: FeeBatchReader) {}

  async batch(scope: BuildingScope, batchId: string): Promise<FeeBatchRecord> {
    const batch = await this.reader.findBatch(scope, batchId)
    if (!batch) throw new NotFoundError()
    return batch
  }

  async charges(scope: BuildingScope, batchId: string): Promise<readonly ChargeWithLines[]> {
    await this.batch(scope, batchId)
    return this.reader.chargesOf(scope, batchId)
  }
}
