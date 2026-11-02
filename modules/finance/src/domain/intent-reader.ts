/** Reads of `finance.payment_intent` that answer other modules (DOC-15 §6.1). */
export interface IntentReader {
  /** An intent of the building under the provider in `creating`, `pending` or `cancelling` exists. */
  hasActive(buildingId: string, provider: string): Promise<boolean>
}
