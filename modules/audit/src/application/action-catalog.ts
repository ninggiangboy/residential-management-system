import { moduleOf, PII_READ } from '../domain/entry'
import type { AuditActionCatalog } from './ports'

/** The part of a manifest the catalog reads: the module's name and the audit actions it declared. */
export interface DeclaresAuditActions {
  readonly name: string
  readonly auditActions?: readonly string[]
}

/**
 * `AuditApi.record` throws for an action that the module of its first segment did not declare; `pii.read` is the one action
 * every module may write (DOC-35 §3.3). Built once from the manifests of the catalog.
 */
export function auditActionCatalogOf(
  manifests: readonly DeclaresAuditActions[],
): AuditActionCatalog {
  const declared = new Map(manifests.map((m) => [m.name, new Set(m.auditActions ?? [])]))
  return {
    isDeclared: (action) =>
      action === PII_READ || (declared.get(moduleOf(action))?.has(action) ?? false),
  }
}
