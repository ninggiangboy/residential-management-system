/**
 * What other modules ask `finance` (DOC-09 §7.2). It grows with the use cases that serve it: the debt and report reads join with
 * P2-10 and P2-15.
 */
export interface FinanceApi {
  /**
   * Whether the building has an intent whose link may still be paid (`creating`, `pending` or `cancelling`) under the provider:
   * `building` refuses to switch or remove a gateway configuration while one exists (DOC-36 §7.3, DR-126).
   */
  hasActiveIntent(buildingId: string, provider: string): Promise<boolean>
}
