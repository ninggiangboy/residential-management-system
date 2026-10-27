import type { ConfigSlice } from '@core/config'
import type { IntegrationEventHandler, OutboxSource, RetryClass } from '@core/messaging'
import type { JobDefinition } from './job'

/** A section of the API docs: the `tags` of the module's routes, described once. */
export interface ApiDocTag {
  name: string
  description: string
}

/**
 * What the composition root needs from every business module. Each factory returns this plus its own API
 * (`api`, `verifier`, `reconcile`, `prune`…), so a new module is one more entry in the container's list.
 */
export interface AppModule<Name extends string = string, Routes = unknown> {
  readonly name: Name
  /** An Elysia instance. `app.ts` mounts it with a static `.use()` so Eden can infer the client types. */
  readonly routes?: Routes
  /** The API doc sections the module's routes are filed under. */
  readonly docs?: readonly ApiDocTag[]
  readonly handlers?: readonly IntegrationEventHandler[]
  readonly outbox?: OutboxSource
  /** Its jobs (DOC-38 §3): started, paused for maintenance and stopped by the runtime as a group. */
  readonly jobs?: readonly JobDefinition[]
  /** Gauges read from the module's tables at a scrape (DOC-40 §4 rule 3); the host registers them and caches, times out and counts failures. */
  readonly gauges?: readonly ModuleGauge[]
  /** Releases live resources (SSE connections, LISTEN). Called BEFORE the HTTP server is stopped. */
  close?(): Promise<void>
}

/**
 * What a host app needs to know about a module without building it: where its migrations and schema are, its outbox table
 * and its configuration. Static data, so CLI scripts (`db:migrate`, `outbox:list`) and drizzle-kit can read it without
 * pulling in the container. Every module package exports one as `@mod/<name>/manifest`.
 */
/** A gauge whose value is a query: `otp_challenges_24h`, `units_without_owner`. */
export interface ModuleGauge {
  readonly name: string
  readonly help: string
  readonly labelNames?: readonly string[]
  read(): Promise<ReadonlyArray<{ labels?: Record<string, string>; value: number }>>
}

export interface ModuleManifest {
  readonly name: string
  /** The module's folder: it holds its own `drizzle.config.ts`. */
  readonly dir: string
  /** Absolute path of the folder with the module's generated migrations. */
  readonly migrations: string
  /** Absolute path of the Drizzle schema file drizzle-kit reads. */
  readonly schemaFile: string
  /** The module's outbox table, or `null` when it emits no events. */
  readonly outbox: OutboxSource['table'] | null
  /** The module's configuration slice, read under `config.<name>`; `undefined` when it has no variables of its own. */
  readonly config: ConfigSlice | undefined
  /**
   * The event types the module may write and the retry class of each that is not `default` (DOC-09 §4.2): a type that is not
   * a key here cannot be written (JB-23).
   */
  readonly outboxPolicies?: Readonly<Record<string, RetryClass>>
  /**
   * The audit actions the module may write, `<module>.<object>.<verb>` (DOC-35 §3.3): `AuditApi.record` throws for an action that
   * the module of its first segment did not declare.
   */
  readonly auditActions?: readonly string[]
}
