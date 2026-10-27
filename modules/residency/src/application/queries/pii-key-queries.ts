import type { PiiKeyReader } from '../../domain/pii-key-reader'

/** The read behind `ResidencyApi.piiKeyIds`: no rule, no transaction. */
export class PiiKeyQueries {
  constructor(private readonly reader: PiiKeyReader) {}

  keyIds(): Promise<string[]> {
    return this.reader.keyIds()
  }
}
