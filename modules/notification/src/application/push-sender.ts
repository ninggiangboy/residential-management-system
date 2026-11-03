/**
 * The Expo push port (DOC-31 §6.3, DR-301). A `fetch` client in `infrastructure/push/` implements it; the application layer
 * (the `SendExpoPush` handler and the `push_receipts` job) speaks only these types, so no Expo or HTTP detail leaks in.
 */

/** One element of a `POST /send` body: the fields of DOC-31 §6.3, and nothing else (`badge`, `collapseId`, `ttl` are not sent). */
export interface ExpoMessage {
  readonly to: string
  readonly title: string
  readonly body: string
  /** Exactly `{route, unitId, entityId}` (DR-52, FR-29.3); `unitId` is the recipient's own unit (DR-301). */
  readonly data: {
    readonly route: string
    readonly unitId: string | null
    readonly entityId: string | null
  }
  readonly channelId: 'default' | 'urgent'
  /** `high` on `urgent`, `default` otherwise (DOC-31 §6.3). */
  readonly priority: 'default' | 'high'
  readonly sound: 'default'
}

/** One element of the `/send` answer, in the order of the messages (DOC-31 §6.3). */
export type ExpoTicket =
  | { readonly status: 'ok'; readonly id: string }
  | {
      readonly status: 'error'
      readonly message: string
      readonly details?: { readonly error?: string }
    }

/** One value of the `/getReceipts` answer (DOC-31 §6.3); a receipt id with no receipt yet is absent from the map. */
export type ExpoReceipt =
  | { readonly status: 'ok' }
  | {
      readonly status: 'error'
      readonly message: string
      readonly details?: { readonly error?: string }
    }

/**
 * The Expo push client (DOC-31 §6.3). `send` takes the messages of one `notification.push_requested.v1` command and answers
 * one ticket per message; `getReceipts` answers the receipts of the given ticket ids. A provider failure is signalled as an
 * exception — `RetryLaterError` for a rate limit or a bad token, a plain `Error` otherwise — so the outbox retries
 * (DOC-09 §4.4, DOC-42 §7.1).
 */
export interface PushSender {
  send(messages: ExpoMessage[]): Promise<ExpoTicket[]>
  getReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>>
}
