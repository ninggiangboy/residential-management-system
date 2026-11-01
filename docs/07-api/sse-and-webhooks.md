# SSE and webhooks

> Status: **Draft** · Updated: 2026-10-28 (P1-26: first version, the SSE part; DR-287…290) · DOC-52
> Depends on: original SDD §6.1, §10.4, [DR](../00-decision-register.md) (DR-52, 64, 67, 75, 76, 83, 87, 104, 115, 116, 118, 120, 129, 263, 264), [ADR-0024](../04-adr/0024-real-time-for-the-web-cms-with-the-reference-realtime-module.md), [ADR-0011](../04-adr/0011-tokens-refresh-families-and-cookies.md), [ADR-0014](../04-adr/0014-schema-per-module-no-cross-module-foreign-keys.md), [DOC-06](../02-glossary.md), [DOC-07](../03-architecture/system-context-and-containers.md) §3, §5.3, [DOC-09](../03-architecture/messaging-contracts.md) §4.3, §5.4, §6, [DOC-10](../03-architecture/quality-attributes.md) §6.3, [DOC-12](../03-architecture/code-architecture.md) §4.4, §6.2, [DOC-14](../05-data/data-conventions.md) §5, [DOC-17](../05-data/operations-model.md) §9, [DOC-20](../05-data/data-lifecycle.md), [DOC-26](../06-design/identity-and-sessions.md) §3.1, §3.8, [DOC-38](../06-design/jobs-and-outbox-runtime.md) §2, §4, §5.4, [DOC-39](../06-design/security.md) §5, §6, [DOC-40](../06-design/observability.md), [DOC-41](../06-design/configuration-reference.md), [DOC-42](../06-design/error-handling.md) §6, §8, [DOC-50](api-guidelines.md) §4, §5.3, §7, [DOC-51](api-endpoints.md) §2.2, [DOC-55](../08-ux-ui/client-architecture.md) §13, [DOC-70](../09-operations/deploy-staging-and-production.md) §7.1; DOC-31 (push, written in parallel by P1-26), DOC-23, DOC-24 (webhook)
> Main readers: P2-12 (the `realtime` module and E-75), the P4 web task that opens the stream (DR-264), P3-03 (the webhook route, §12), DOC-31, DOC-55, DOC-64, DOC-70, DOC-88, EXP-10

This document is the contract of the two channels the server pushes or receives outside the request and answer of DOC-51: the **server-sent events stream** of the web CMS (`GET /staff/events`, E-75) and the **payment webhook** (`POST /payments/webhooks/{provider}/{gatewayConfigId}`, E-117). It gives the endpoint, the frames on the wire, the six event types with their payloads and recipients, the replay with `Last-Event-ID`, the limits, what happens inside the server between an outbox event and a frame, and the tests `SE-`. It also summarizes the Expo push contract, whose source is DOC-31.

It does not hold: the outbox events that feed the stream (DOC-09 §6), the inbox, templates and push (DOC-31), the web's use of the events and its cache map (DOC-55 §13), the Caddy file (DOC-70 §7.1), the DDL of `realtime.events` (DOC-17 §9), the retention period (DOC-20), the metric rows (DOC-40) and the keys (DOC-41).

**Draft.** The SSE part follows DR-75 (decided) and four decisions made while writing (§20): DR-287 waits for the Owner, so the document stays `Draft`. **The webhook part (§12) is owed to P3** (gate P3, DR-25 waits for a gateway sandbox); only its frame is written here.

**Statements run on 2026-10-28** on `postgres:18.6` (x86_64, Docker): the table of §9.2, its 11 constraint checks, the publish statement with its `NOTIFY` and the replay query (§19). Latency and connection figures are *planned* until P2-12 measures them.

## 1. Reading guide

| Question | Answer lives in |
| --- | --- |
| When is each piece built? | §2 |
| What does one event go through, from the outbox to the browser? | §3 |
| How is the stream opened, and what can it answer? | §4 (E-75) |
| What does a frame look like? | §5 |
| Which events exist, what do they carry, and who gets them? | §6, §7 |
| How does a reconnecting tab catch up? | §8 |
| What does the server do between an outbox event and a frame? | §9 |
| How long does a stream live, and what ends it? | §10 |
| What does the web client do? | §11 |
| The payment webhook | §12 (P3) |
| Push to the apps | §13 (summary of DOC-31) |
| Keys, metrics, logs, errors | §14…§16 |
| Tests | §18 |

## 2. Scope and phases

| Piece | Owner | Built in | Source |
| --- | --- | --- | --- |
| `@mod/realtime`: the hub (`LISTEN`), the route E-75, the generic handler, `realtime.events`, the job `realtime_purge` | `realtime` | **P2-12** | DR-76 item 4, DR-287 |
| The six `integrations/realtime.ts` mappings | each producer (`notification`, `finance`, `identity`, `tickets`, `reporting`) | with the producer's event: `identity` and `notification` in P2-12, `finance` (`money_unposted`) in P2, `tickets` in P4, `reporting` in P6 | DOC-09 §5.4 |
| The web client: the stream in the `_app` layout, the bell, the cache map, `session.revoked` | `apps/cms-web` | **P4** | DR-264 item 5, DR-287 |
| The payment webhook E-117 | `finance` with the driver of DOC-24 | **P2-23** (*DR-325; was P3-03*) | DR-25, DR-32, DR-326 |
| Push to the apps | `notification` | P2-12 | DR-52, DOC-31 |

DR-76 builds "the SSE module for the web CMS inbox in P2"; DR-264 (2026-10-25) leaves "the stream, the bell and `session.revoked`" of the web for P4. They do not conflict once the server and the client are told apart: the server side is built and tested over `app.handle` in P2-12 (test-strategy row `realtime`), and the web opens the stream in P4 (DR-287, proposed for the Owner). Until P4 the web shows a change at the next focus or navigation and a revoked session ends at the next refresh (DOC-55 §13); FL-07's arrow "SSE `money_log.opened`" (DOC-44) is live from P4.

Mobile apps never use SSE: they refetch on focus and on push, and the payment screen polls (DR-75, UX-17).

## 3. The path of one event

```mermaid
sequenceDiagram
  autonumber
  participant P as "producer (finance)"
  participant OB as "finance.outbox_messages"
  participant R as "worker: relay"
  participant H as "realtime handler"
  participant DB as "realtime.events"
  participant A1 as "api-1: hub (LISTEN)"
  participant A2 as "api-2: hub (LISTEN)"
  participant W as "web tab (Manager)"
  P->>OB: "money_unposted.v1 in the business transaction"
  R->>OB: "claim (≤ 500 ms when idle)"
  R->>H: "realtime.sse_on_finance_money_unposted"
  H->>DB: "INSERT … ON CONFLICT (source_message_id) DO NOTHING + pg_notify (one statement)"
  DB-->>A1: "NOTIFY realtime (at commit)"
  DB-->>A2: "NOTIFY realtime (at commit)"
  A1->>A1: "filter: building, role ∈ {manager, admin}"
  A1-->>W: "event: money_log.opened"
  Note over A2: "no matching stream: drops it"
```

Commit and acknowledgement points: the event exists once the producer's transaction commits (DOC-09). The handler's single statement writes the replay row and queues the `NOTIFY`; PostgreSQL delivers the notification **at commit**, so no `api` instance ever sees an event that is not yet in the buffer. A repeat of the handler (relay retry) finds the row and sends nothing (§9.1). Delivery to a browser is best-effort: a tab that is not connected at that moment catches up through the replay of §8.

## 4. E-75 `GET /staff/events` · `streamStaffEvents`

- **Purpose / UC:** One long-lived stream per visible web tab that tells the web CMS that something changed, so it refetches (UC-19 inbox, UC-26 sessions, UX-17). The stream carries ids, never the data itself.
- **Authorization:** `staff: any` (DOC-51 §2.2). The staff guard runs once, at open: it verifies the access token (DOC-26 §3.1), reads the account's role and status from the database, and fixes the stream's `accountId`, `role`, `buildingId` (the `bid` claim) and `sessionId` (the `sid` claim). A resident token is 401 (a token of the wrong kind, DOC-39 §4.4). The web CMS opens it only for Manager and Admin (Technician and Guard reach `/wrong-app`, DR-174); another role gets a stream that carries only its own events (§7).
- **Headers:**

  | Name | Required | Value |
  | --- | --- | --- |
  | `Authorization` | yes | `Bearer <access token>`; an `EventSource` cannot send it, so the web uses the fetch-based client of `@core/web` (§11) |
  | `Accept` | no | `text/event-stream` |
  | `Last-Event-ID` | no | The `id` of the last event the tab received, or the `cursor` of the last `ready` (§8). A value that is not a UUIDv7 is ignored, not refused |

- **Parameters:** none.
- **Request example:**

  ```http
  GET /api/v1/staff/events
  Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6ImsyIn0.…
  Accept: text/event-stream
  Last-Event-ID: 01a181cb-b2ea-7cf3-ac5f-5ebac47634bb
  ```

- **Response 200:** `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, `X-Request-Id`. The body is a stream of frames (§5) that starts with `ready`, then the replayed events, then live events and heartbeats:

  ```text
  event: ready
  data: {"cursor":"01a181d0-0a3c-7e11-9b2f-6c1d22e0f001","sessionId":"0192f3c4-5a1e-7000-8000-000000000062","resumed":true}

  id: 01a181cb-b2fb-71c5-9d6a-b419259602f3
  event: inbox.created
  data: {"id":"01a181cb-b2fb-71c5-9d6a-b419259602f3","type":"inbox.created","data":{"entryId":"0192f3c4-5a1e-7000-8000-000000000075","templateKey":"finance.money_unposted"},"at":"2026-10-28T09:16:12.922Z"}

  : hb

  ```

- **Errors** (before the first byte, the usual JSON shape of DOC-42 §3):

  | Status | Code | When |
  | --- | --- | --- |
  | 401 | `unauthenticated` | No token, an expired or invalid one, a resident token, a disabled account |
  | 429 | `rate_limited` | `details.scope = "sse_streams"`: this `api` process already holds `SSE_MAX_STREAMS_PER_ACCOUNT` streams of the account (§10.3); `Retry-After: 30` |
  | 503 | `maintenance` | The maintenance flag is on (DOC-50 §7, gate 2); `Retry-After` |

  Once the stream has started there is no error answer: it ends by closing (§10.2).
- **Data source:** the in-memory streams of the `api` process; `realtime.events` for the replay (§8, DOC-17 §9); `identity.staff_account` through the staff guard at open.
- **Cache:** `no-store`. No `ETag`.
- **Performance (planned, measured in P2-12):** `ready` within 200 ms of the request at p95; an outbox event reaches an open stream within 2 s at p95 while the relay is idle (§9.4).
- **Events:** none written. Closing a stream writes nothing.
- **Idempotency:** not applicable (a `GET`).
- **Tests:** SE-01…SE-26 (§18); EXP-10 counts E-75 as a `staff` route.

## 5. Frames

The stream follows the WHATWG server-sent events format. Three kinds of frame exist:

| Frame | Lines | When |
| --- | --- | --- |
| `ready` | `event: ready`, `data: {cursor, sessionId, resumed}` | Once, first, on every open |
| An event | `id: <event id>`, `event: <type>`, `data: {id, type, data, at}` | Replayed (§8) or live |
| Heartbeat | `: hb` (a comment) | Every `SSE_HEARTBEAT_SECONDS` (25 s) of silence |

- **`ready.data`:** `cursor` is a UUIDv7 the server mints at open, before it reads the replay (§8.2); `sessionId` is the stream's `sid`, which the client compares with `session.revoked` (§6.6); `resumed` is `true` only when the replay of §8 delivered everything missed since `Last-Event-ID`, so the client may skip its blanket refetch.
- **An event's `data`** is one JSON object on one line: `id` (UUIDv7, the same as the `id:` line), `type` (§6), `data` (the payload of §6, at most 2 KB), `at` (the instant the event was written to the buffer, DOC-50 §6). The client reads `id` from the JSON (`@core/web` does); the `id:` line is there for standard tooling.
- **A heartbeat** is a comment: the client's parser skips it, and the bytes keep Cloudflare from closing a silent proxied request after 100 s (DR-83 item 10). `SSE_HEARTBEAT_SECONDS < 30` is boot rule 8 of DOC-41.
- **No `retry:` field.** The client owns its backoff (§11).

## 6. Event catalog

Six types (DR-75). Each comes from one outbox event through one handler that lives in the producer's `integrations/realtime.ts` (DOC-09 §5.4, DOC-12 §4.4). Payloads carry ids, codes and enumerated words only: no name, phone, amount or text (DR-52 rule applied to staff screens too; §17).

| Type | Source event (DOC-09) | Handler | Recipients (§7) | Web reaction (DOC-55 §13) |
| --- | --- | --- | --- | --- |
| `inbox.created` | `notification.staff_inbox_created.v1` | `realtime.sse_on_notification_staff_inbox_created` | the account `staffId` | bell and inbox list |
| `ticket.created` | `tickets.ticket_changed.v1` with `change = created` | `realtime.sse_on_tickets_ticket_changed` | roles `manager`, `admin` | tickets, dashboard |
| `ticket.changed` | `tickets.ticket_changed.v1`, any other `change` | the same | roles `manager`, `admin` | tickets, dashboard |
| `money_log.opened` | `finance.money_unposted.v1` | `realtime.sse_on_finance_money_unposted` | roles `manager`, `admin` | money log, dashboard |
| `export.ready` | `reporting.export_ready.v1` | `realtime.sse_on_reporting_export_ready` | the account `requestedBy` | exports list, a toast |
| `session.revoked` | `identity.session_revoked.v1` with `accountKind = staff` | `realtime.close_stream_on_identity_session_revoked` | the account `accountId`; closes the streams of `sessionId` | sign out if it is this tab's session; refetch the sessions list otherwise |

A new type is a row here, a value in the `CHECK` of `realtime.events` (DOC-17 §9), a mapping in the producer's `integrations/realtime.ts` and a line in the web's map, in one change.

### 6.1 `inbox.created`

| Field | Type | Meaning |
| --- | --- | --- |
| `entryId` | uuid | The `notification.inbox_entry` (DOC-31) |
| `templateKey` | string | Its template key (DR-53), so the bell can show the right icon before it refetches |

```json
{"entryId":"0192f3c4-5a1e-7000-8000-000000000075","templateKey":"finance.money_unposted"}
```

### 6.2 `ticket.created`

| Field | Type | Meaning |
| --- | --- | --- |
| `ticketId` | uuid | The ticket |
| `code` | string | `YC-YYMMDD-NNN` (DR-10) |
| `unitId` | uuid | The unit that raised it |
| `toStatus` | string | The status after creation (DOC-28 literal) |

```json
{"ticketId":"0192f3c4-5a1e-7000-8000-000000000070","code":"YC-261019-004","unitId":"0192f3c4-5a1e-7000-8000-000000000021","toStatus":"submitted"}
```

### 6.3 `ticket.changed`

| Field | Type | Meaning |
| --- | --- | --- |
| `ticketId`, `code`, `unitId` | as §6.2 | |
| `change` | `assigned` · `status_changed` · `message_added` · `rated` | What happened (DOC-09 §6.4) |
| `fromStatus`, `toStatus` | string | The statuses around it; equal for `message_added` and `rated` |

An internal note (`messageVisibility = internal`) does send `ticket.changed`: the staff screens show internal notes, and the event carries no text (FR-24.1). Only the resident notification skips it (FR-24.2, DOC-09 MC-19).

```json
{"ticketId":"0192f3c4-5a1e-7000-8000-000000000070","code":"YC-261019-004","unitId":"0192f3c4-5a1e-7000-8000-000000000021","change":"assigned","fromStatus":"submitted","toStatus":"assigned"}
```

### 6.4 `money_log.opened`

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `gateway_event` · `statement_line` | Which table holds the row |
| `rowId` | uuid | The row |
| `outcome` | string | `gateway_event.outcome` or `statement_line.match_status` |

The source event's `amount` and `receivedAt` are **not** copied: the counter and the row are refetched (E-108, E-165), so the stream holds no money.

```json
{"kind":"gateway_event","rowId":"0192f3c4-5a1e-7000-8000-000000000034","outcome":"amount_short"}
```

### 6.5 `export.ready`

| Field | Type | Meaning |
| --- | --- | --- |
| `exportId` | uuid | The `reporting.export_job` |
| `kind` | string | e.g. `debt_aging` |
| `format` | `xlsx` · `pdf` | |
| `fileId` | uuid | The result; the download URL is signed when the web asks for it (DOC-33), never sent on the stream |
| `expiresAt` | instant | When the file is deleted (7 days, DR-55) |

```json
{"exportId":"0192f3c4-5a1e-7000-8000-000000000073","kind":"debt_aging","format":"xlsx","fileId":"0192f3c4-5a1e-7000-8000-000000000074","expiresAt":"2026-10-26T04:10:00.000Z"}
```

### 6.6 `session.revoked`

| Field | Type | Meaning |
| --- | --- | --- |
| `sessionId` | uuid | The revoked refresh family (`sid`) |
| `reason` | string | The word of `refresh_family.revoked_reason` (DOC-26 §3.8, DR-129) |

A resident's revocation (`accountKind = resident`) writes no row and no notification: residents have no stream.

```json
{"sessionId":"0192f3c4-5a1e-7000-8000-000000000062","reason":"user_revoked"}
```

## 7. Who receives an event

Every event names one building and **either** one account **or** a set of roles; never both (the `CHECK` `ck_events_target`). A stream receives an event when all hold:

1. `event.buildingId = stream.buildingId` (the token's `bid`; one deployment serves one building, DR-115 item 5, but the rule is kept for the demo building, DOC-36);
2. `event.targetAccountId = stream.accountId`, **or** `stream.role ∈ event.targetRoles`.

| Type | Target |
| --- | --- |
| `inbox.created` | account `staffId` |
| `ticket.created`, `ticket.changed`, `money_log.opened` | roles `["manager", "admin"]` |
| `export.ready` | account `requestedBy` |
| `session.revoked` | account `accountId`; after sending, the server closes the streams whose `sessionId` equals the event's |

The role of a stream is the role read at open. A role change revokes every family of the account (`role_changed`, DOC-26 §3.8), so `session.revoked` closes the stream before the old role can matter. The same holds for a lock and a disable.

Examples (building B1; Manager M with two tabs, sessions s1 and s2; Technician T; Admin A of the demo building B0):

| Event | M tab s1 | M tab s2 | T | A (B0) |
| --- | --- | --- | --- | --- |
| `money_log.opened` in B1 | yes | yes | no (role) | no (building) |
| `inbox.created` for T in B1 | no | no | yes | no |
| `session.revoked` of M, `sessionId = s1` | yes, then closed | yes, stays open | no | no |

## 8. Replay

### 8.1 The buffer

`realtime.events` keeps every event for 24 hours (DR-115; the job `realtime_purge`, hourly at :45, DR-120). Every type is replayable (DR-289). The table is scoped: each row carries `building_id` and a stream replays its own building only (DR-104, DOC-14 §5.3). Its DDL is DOC-17 §9; the columns this document relies on are `id`, `building_id`, `type`, `target_account_id`, `target_roles`, `close_session_id`, `data`, `created_at` and the unique `source_message_id`.

### 8.2 The rule

On open, in this order:

1. The guard passes and the limit check passes (§10.3).
2. The stream is **registered** with the hub. From here, live events for it are **queued** in memory, not written.
3. The server mints `cursor` (UUIDv7, now).
4. If `Last-Event-ID` is a UUIDv7 whose time is within the last **23 hours** (one hour below the retention, so the purge cannot have removed what it needs), it runs the replay query below with a limit of **201**:
   - 0…200 rows: they are sent after `ready` with `resumed: true`;
   - 201 rows: none is sent and `resumed: false` (the client refetches everything; 200 events missed is a tab that slept through a busy day).
5. Otherwise (no header, not a UUIDv7, too old): no replay, `resumed: false`.
6. Write `ready`, the replayed events, then the queued live events, then switch to direct delivery.

```sql
-- replay for one stream: $1 building, $2 account, $3 role, $4 Last-Event-ID
SELECT id, type, data, created_at
FROM realtime.events
WHERE building_id = $1
  AND created_at >= uuid_extract_timestamp($4) - interval '5 seconds'
  AND (target_account_id = $2 OR $3 = ANY (target_roles))
ORDER BY created_at, id
LIMIT 201;
```

The lower bound is the **time** of the last id minus **5 seconds**, not `id > $4`. Event ids are minted by the handlers before their transactions commit, and the relay runs four handlers at once (`OUTBOX_CONCURRENCY`, DOC-38), so an event with a smaller id can become visible after a tab has received a larger one. The 5-second overlap re-sends a few events the tab already has; every event is an invalidation, so a repeat is harmless (DOC-09 §4.3), and the `export.ready` toast is keyed by `exportId`, so a repeat replaces it (§11).

Steps 2 and 6 close the gap between the replay read and the live feed: an event committed while the replay runs is either in the replay, queued live, or both; never neither.

### 8.3 Examples

| `Last-Event-ID` | Buffer for the stream | `ready.resumed` | Sent after `ready` |
| --- | --- | --- | --- |
| none | anything | `false` | nothing |
| `01a181cb-…` (2 minutes ago) | 3 events after it | `true` | the 3 events, plus any within 5 s before it |
| a UUIDv7 of 30 hours ago | anything | `false` | nothing |
| `abc` or a UUIDv4 | anything | `false` | nothing |
| 1 hour ago | 260 events after it | `false` | nothing |
| 1 minute ago | 2 events of another account, 1 of another building | `true` | nothing |

## 9. Inside the server

### 9.1 The handler

Every mapping is one call to the generic handler of `@mod/realtime` (reference `RealtimePushHandler`), declared by the producer:

```ts
// modules/finance/src/integrations/realtime.ts
import type { RealtimeMapping } from '@mod/realtime/contracts'
import { FinanceEvents, type MoneyUnpostedPayload } from '../contracts'

export const financeRealtime: RealtimeMapping[] = [
  {
    handler: 'realtime.sse_on_finance_money_unposted',
    eventType: FinanceEvents.MoneyUnposted,
    build: (p: MoneyUnpostedPayload) => ({
      buildingId: p.buildingId,
      target: { roles: ['manager', 'admin'] },
      event: { type: 'money_log.opened', data: { kind: p.kind, rowId: p.rowId, outcome: p.outcome } },
    }),
  },
]
```

`build` may return `null` (a resident's `session_revoked`). The handler has **no inbox row** (DOC-09 §4.3, mode "none"); its once-only effect is the natural key `UNIQUE (source_message_id)`. It runs one statement, so the buffer row and the notification commit together and a repeat sends nothing:

```sql
WITH ins AS (
  INSERT INTO realtime.events (id, building_id, source_message_id, type,
                               target_account_id, target_roles, close_session_id, data)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (source_message_id) DO NOTHING
  RETURNING id, building_id, type, target_account_id, target_roles, close_session_id, data, created_at)
SELECT pg_notify('realtime', json_build_object(
         'b', building_id, 'a', target_account_id, 'r', target_roles, 'c', close_session_id,
         'm', json_build_object('id', id, 'type', type, 'data', data,
                                'at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))::text)
FROM ins;
```

`$1` comes from `IdGenerator` (UUIDv7), `$3` is the outbox message id. The reference handler skips an event older than 60 seconds ("worthless as a live notification"); this one does not, because the buffer makes a late event useful to a tab that reconnects, and a relay backlog after an outage is at most a few hundred small rows (DR-289). A thrown error (the database is down) is retried by the relay under the `default` class (DOC-09 §4.2).

### 9.2 The wire and its size

The `NOTIFY` payload is `{b, a, r, c, m}`: building, target account, target roles, the session to close and the message of §5. PostgreSQL refuses a payload of 8,000 bytes or more. `data` is capped at 2,048 bytes by `ck_events_data`; the largest payload of §6 (`export.ready`) is 174 bytes and its wire 416 bytes. The hub refuses a wire over 7,500 bytes (the reference's guard) before it calls `pg_notify`, as a programming error.

### 9.3 The hub

One `PgRealtimeHub` per `api` process (reference `realtime` module, DR-03):

- It opens **one** `LISTEN realtime` connection the first time a stream registers (`postgres` 3.4.9 `sql.listen`, a dedicated direct connection outside the pool; there is no PgBouncer in phase 1, and `LISTEN` would not work through one in transaction mode, DR-67). DOC-10 §6.3 counts it: one per `api` process.
- It keeps `Map<accountId, Set<Stream>>` and filters each notification by §7 before writing to a stream.
- **A lost `LISTEN` connection closes every local stream** (`reason = "listen_reconnected"`) when it is listening again (the `onlisten` callback after the first). Notifications sent while it was down are lost to it, and closing makes the tabs reconnect with `Last-Event-ID` and catch up from the buffer (DR-289).
- A process that never serves a stream (the `worker`) never listens. The worker's handlers call `pg_notify` on an ordinary pooled connection (DOC-38 §2).

### 9.4 Latency budget (planned)

| Hop | Planned |
| --- | --- |
| Producer commit → relay claim | ≤ 500 ms (`OUTBOX_POLL_INTERVAL_MS` while idle; 0 while busy) |
| Handler statement and commit | ≤ 50 ms |
| `NOTIFY` → hub → write to the socket | ≤ 50 ms |
| Caddy, Tunnel, Cloudflare | ≤ 300 ms |
| **Total, p95** | **≤ 2 s** while the relay is idle (SE-25) |

During maintenance the relay is paused (DOC-38 §5.3), so no event flows; open streams stay open.

## 10. Stream lifecycle and limits

### 10.1 Open

The order of §8.2. The request line of the stream (DOC-42 §8.1) is written when the stream ends, with `durationMs` the life of the stream.

### 10.2 What ends a stream

| Cause | Server action | Client (`@core/web`, §11) |
| --- | --- | --- |
| The tab closes the request (navigation, sign-out, hidden for 60 s) | Unregister; the socket error is not logged above `debug` | — |
| `session.revoked` for this stream's `sessionId` | Send the event, then close | Stops; signs the tab out (DOC-55 §5.4) |
| The access token the stream was opened with expires (`exp`, at most 15 minutes) | Close (`reason = "token_expired"`) | Reconnects after 1 s with the current token and `Last-Event-ID`; a 401 refreshes first (DR-288) |
| Shutdown of the `api` process (deploy) | `closeLive()` closes every stream before the HTTP server stops (DOC-38 §5.4) | Reconnects; Caddy routes to the other `api` |
| The `LISTEN` connection was lost and is back | Close every local stream | Reconnects and replays |
| A write to the socket fails | Unregister | — |

Closing at `exp` is what bounds a revoked session: no request checks the refresh family (DOC-26 §3.1), so without it a stream opened with a still-valid access token just after a revocation would outlive the revocation indefinitely. With it, a stream lives no longer than any other use of the token (ADR-0011).

### 10.3 Limits

| Limit | Value | Where |
| --- | --- | --- |
| Streams per account | `SSE_MAX_STREAMS_PER_ACCOUNT` = 3 **per `api` process** | in memory; a fourth gets 429 `rate_limited`, `scope: "sse_streams"`, `Retry-After: 30` |
| Heartbeat | `SSE_HEARTBEAT_SECONDS` = 25 | boot rule `< 30` |
| Life of a stream | the access token's `exp` | §10.2 |
| Replay | 200 events, 23 hours, 5 s overlap | constants of `@mod/realtime` (§8.2) |
| Event `data` | 2,048 bytes | `ck_events_data` |
| `NOTIFY` wire | 7,500 bytes | the hub |

The count is per process, not per account across processes (DR-288): production runs `api-1` and `api-2`, so one account can hold up to 6 streams. The limit protects a process's memory and file descriptors; it is not a security control, and a shared count would need a table or a lock per stream. The web holds one stream per visible tab (DOC-55 §13), so a person reaches it only with four visible tabs on one process.

## 11. The web client

The client is `RealtimeClient` of `@core/web` (`packages/core-web/src/realtime-client.ts`, vendored), opened by `createRealtimeClient` in the `_app` layout from P4 (DOC-55 §13). As vendored, it:

| Behaviour | As vendored |
| --- | --- |
| Transport | `fetch` with `Authorization: Bearer`, `Accept: text/event-stream`, `Last-Event-ID` |
| Cursor | `lastEventId` = `ready.data.cursor`, then each event's `id` |
| 401 | single-flight refresh, then reconnects at once; a failed refresh stops |
| Other failures and a normal close | backoff `min(1 s × 2^n, 15 s)`: 1, 2, 4, 8, 15, 15… s; `n` is reset by every `ready` |
| `session.revoked` for its own `sessionId` (from `ready`) | stops after the event |
| Status | `connecting`, `open`, `reconnecting`, `closed` |

DOC-55 §13 asks for three things the vendored client does not do; they are local changes to `core-web` made by the P4 web task and recorded under `local-changes` of `packages/CORE_VERSION` (DR-290):

1. **A 429 stops** the client and the shell shows a banner (today it backs off and retries).
2. **A silent stream for 45 s is closed and reopened** (a watchdog on bytes received; the heartbeat is 25 s).
3. The backoff stays the vendored one: DOC-55 §13's "1 s, 2 s, 5 s, 10 s (cap 30 s)" is revised to it.

On `ready` with `resumed: false` the web invalidates every key of its event map; with `resumed: true` it may skip that. The event-to-cache map is DOC-55's.

**CORS.** The web CMS is cross-origin (DOC-50 §5.3). `Last-Event-ID` is not a CORS-safelisted header, so it must be in `Access-Control-Allow-Headers`, or the preflight of every reconnect fails. DR-288 adds it to DOC-50 §5.3 and to `ALLOWED_HEADERS` in `apps/api/src/app.ts` (SE-20).

## 12. The payment webhook (E-117, P2)

*Revised 2026-11-01 (DR-325, DR-326):* the first provider is Stripe and the webhook is built in P2 with the rest of the online payment (P2-23). The route is provider-neutral; the driver of the path decides the signature and the events (DOC-24 §4.4, §7). Nothing here asserts a Stripe behaviour that DOC-24 §4.12 lists as unverified; the sample below is **computed by this document's author, not recorded from Stripe** (see "Signed sample").

### 12.1 The request

`POST /api/v1/payments/webhooks/{provider}/{gatewayConfigId}` (E-117), audience `webhook`, no bearer token, no `X-App-*` headers, no `Idempotency-Key`.

| Part | Rule |
| --- | --- |
| `provider` | A word the driver registry knows (`stripe`, `fake`); another word is 404 and no row |
| `gatewayConfigId` | An active `gateway_config` of that provider; another or unknown id is 404 and no row (DR-32 step 1: the existence check comes before any write) |
| Body | The raw bytes, at most `WEBHOOK_MAX_BODY_BYTES` (256 KB, DOC-41); a larger body is 413 and one `webhook_rejection` |
| Stripe header | `Stripe-Signature: t=<unix seconds>,v1=<hex>` (more than one `v1` is allowed; any matching one verifies) |
| Content type | `application/json`; the route does not parse the body before the signature is checked |

Per-IP limit `WEBHOOK_PER_MINUTE_PER_IP`; an optional allow-list `WEBHOOK_KNOWN_IPS` is a warning counter only (`webhook_unknown_ip_total`), never a refusal (DR-32).

### 12.2 The signature

Stripe's scheme (DOC-24 §4.4): the signed payload is `<t>.<raw body>`; the signature is HMAC-SHA256 of it with the endpoint's signing secret (`whsec_…`, the whole string) as the key, in lower-case hex; the timestamp must be within 5 minutes of the server's clock. The driver calls `StripeClient.webhooks.constructEvent` with the raw bytes; a failure of the signature, the tolerance or the JSON is `SignatureError`.

**Signed sample** for the unit tests `PX-01` (a deterministic vector for the *algorithm above*, secret `whsec_test_0123456789abcdef0123456789abcdef`; the vectors recorded from a Stripe sandbox replace it in P2-21):

```http
POST /api/v1/payments/webhooks/stripe/0192f3c4-9b00-7000-8000-000000000f02
Content-Type: application/json
Stripe-Signature: t=1792543801,v1=0383945787be63ea08949e60dbb7db236477f672983239a0b03fbebaee05621e

{"id":"evt_test_0001","object":"event","type":"checkout.session.completed","created":1792543800,"data":{"object":{"id":"cs_test_a1B2","object":"checkout.session","client_reference_id":"1000153","amount_total":2838000,"currency":"vnd","payment_status":"paid","status":"complete","payment_intent":"pi_3Test0001","metadata":{"intentId":"0192f3c4-8a10-7000-8000-000000000a01","buildingId":"0192f3c4-0000-7000-8000-000000000001","code":"TT-261019-0001"}}}}
```

The sample's `client_reference_id` `1000153` is the order code of DOC-23 §6.3 and the amount is its 2,838,000 đ.

### 12.3 The answers

| Case | Status | Body | What is written | Provider retries? |
| --- | --- | --- | --- | --- |
| Genuine, posted | 200 | `{ "received": true }` | the payment, after commit | no |
| Genuine, `already_processed` | 200 | the same | nothing | no |
| Genuine, a log row (`charge_already_paid`, `charge_recalled`, `duplicate_transfer`, `unknown_order`, …) | 200 | the same | the `gateway_event` row | no |
| An event type the driver ignores | 200 | the same | nothing | no |
| `foreign_building` (the order code is another building's) | 400 | `{ "error": { "code": "foreign_building" } }` | one `webhook_rejection` | no (4xx) |
| Signature, tolerance or JSON invalid | 401 | `{ "error": { "code": "invalid_signature" } }` | one `webhook_rejection` (reason, IP, hash of the body, no body) | no |
| Body too large | 413 | | one `webhook_rejection` | no |
| Too many calls from one IP | 429 | | none (the counter) | yes, later |
| A transient failure (database, after the retries of `settle()`) | 503 | | nothing committed | **yes** |

A webhook is answered **after commit** (FR-08.6): the process killed between commit and answer leaves a payment and a provider retry that ends `already_processed`. More than three `webhook_rejection` rows in ten minutes raise the alert `WebhookSignatures` (DOC-40).

### 12.4 The provider's test events

Stripe's Dashboard and CLI can send test events of any type to an endpoint. They are verified like any event: an event whose type the driver does not handle is a 200 that writes nothing, and a `checkout.session.completed` whose `client_reference_id` matches no intent is `unknown_order` (DR-32). There is no special registration payload to recognise.

### 12.5 From the route to `settle()`

The route resolves the configuration, decrypts the secrets, calls the driver's `verifyWebhook`, and passes a `Confirmation` (or an `expired`, `refunded`, `disputed` signal) to the use case of DOC-23 §6 (or the expiry and log writers of DOC-23 §8 and DOC-24 §4.10). The event id is recorded in the inbox first (`stripe:<evt_…>`), so a repeated event is a 200 before any work.

## 13. Push to the apps (summary)

The source is DOC-31 (P1-26) and DR-52; this is a summary for readers of the API.

| Point | Rule |
| --- | --- |
| Registration | E-22 `POST /me/devices`, E-34 `POST /staff/devices` upsert on the Expo token, reassign a token from another account, bind it to the session `sid`; E-23, E-35 delete; a revoked session deletes its token (`notification.drop_device_token_on_identity_session_revoked`) |
| Sending | Expo push API with `EXPO_ACCESS_TOKEN`; messages in groups of `PUSH_CHUNK_SIZE` (100); HTTP 429 or 5xx retried 3 times (1 s, 5 s, 30 s); retry class `push` (3 attempts) |
| Receipts | read `PUSH_RECEIPT_DELAY_MINUTES` (15) after the ticket; `DeviceNotRegistered` deletes the token; tickets purged after `PUSH_TICKET_RETENTION_DAYS` (3) |
| Channels | Android `default` and `urgent`; iOS default interruption level |
| Payload | title and body from templates in the recipient's language, with no amount, name, phone or ticket text; `data = {route, unitId, entityId}` only; `route` is a closed list (DR-177, DOC-31) |
| Consent | push respects `push_enabled`; no quiet hours in phase 1 |

## 14. Configuration

No key is added. The stream uses two keys of DOC-41 §14:

| Key | Default | Use here |
| --- | --- | --- |
| `SSE_MAX_STREAMS_PER_ACCOUNT` | 3 | §10.3, counted per process |
| `SSE_HEARTBEAT_SECONDS` | 25 | §5; boot rule 8: `< 30` |

The replay constants (200 events, 23 hours, 5 seconds) are code constants of `@mod/realtime`, not keys: changing them changes the contract of §8. The retention (24 hours) is DOC-20's; the job `realtime_purge` is DOC-38's.

## 15. Metrics and logs

| Metric | Type | Labels | Where | Status |
| --- | --- | --- | --- | --- |
| `sse_streams_open` | gauge | none | `api` | DOC-40 §4.1 (DR-75); phase P2-12 under the proposed DR-287 |
| `sse_stream_opens_total` | counter | `outcome` (`resumed`, `fresh`, `limited`) | `api` | DOC-40 §4.1: `fresh` is `ready.resumed = false`; a high `fresh` share means tabs miss events |
| `sse_events_published_total` | counter | `type` (the six of §6) | `worker` | DOC-40 §4.1: rows inserted by the handlers, not repeats |

No alert: a stuck handler shows as outbox lag and dead letters (DOC-40 `OutboxLag`, `DeadLetters`), and the stream has no money or safety role.

| Log line | Level | Fields |
| --- | --- | --- |
| the request line, when the stream ends | `info` | DOC-42 §8.1 plus `closeReason` (`client`, `session_revoked`, `token_expired`, `shutdown`, `listen_reconnected`, `write_failed`) and `replayed` (count) |
| `realtime_listen_lost` | `error` | `err` (the driver's message); then `realtime_listen_restored` at `warn` with `closedStreams` |
| `realtime_payload_too_large` | `error` | `type`, `bytes` (never the payload) |

No line holds an event's `data` (DOC-42 §8.4).

## 16. Errors

| Case | Answer or behaviour | Source |
| --- | --- | --- |
| No or bad token, resident token, disabled account | 401 `unauthenticated` | DOC-42 §5.1 |
| Fourth stream of the account on this process | 429 `rate_limited`, `{scope: "sse_streams"}`, `Retry-After: 30` | DR-75, DR-288 |
| Maintenance | 503 `maintenance`, `Retry-After` | DOC-50 §7 |
| The hub cannot `LISTEN` at open (database down) | 503 `service_unavailable` before the first byte | DOC-42 §4.2 |
| After the first byte | no error answer; the stream closes (§10.2) | DOC-42 §6 |
| A handler cannot write (database down) | throws; the relay retries (`default`, 8 attempts) | DOC-09 §4.2 |

No error code is added.

## 17. Security and privacy

- **Authentication** is the bearer token at open; the stream ends at the token's `exp` (§10.2) and on `session.revoked`.
- **Scope**: every event is filtered by building, then by account or role (§7); the replay query carries the building (`BuildingScope`, scope lint) and the account or role.
- **No personal data on the stream**: ids, codes, template keys and enumerated words. `money_log.opened` drops the amount of its source event (§6.4). `export.ready` carries a file id, never a signed URL.
- **Data at rest**: `realtime.events` holds the same ids for 24 hours; `rms_readonly` may read it (DOC-19), as it holds nothing personal.
- **Abuse**: the per-process limit (§10.3); the open is a `GET` with no body; a stream costs one socket and one `Set` entry.

## 18. Required tests

Prefix `SE-` (SSE and webhooks, DOC-52). P2-12 runs SE-01…SE-22 and SE-24…25 over `app.handle` with a fake clock and two hubs on one clone of the template database (two `api` processes in one test); SE-23 and SE-26 run with the P4 web task; the webhook tests are added with §12 in P3. DOC-88 indexes the prefix.

| ID | Given | When | Then |
| --- | --- | --- | --- |
| SE-01 | No token; an expired token; a resident token; a disabled staff account | E-75 | 401 `unauthenticated`, JSON shape, no stream |
| SE-02 | A Manager's token, no `Last-Event-ID` | E-75 | 200 `text/event-stream`, `Cache-Control: no-store`; the first frame is `ready` with a UUIDv7 `cursor`, the token's `sid` as `sessionId`, `resumed: false` |
| SE-03 | An open stream, fake clock | 25 s pass with no event | One `: hb` comment; none before 25 s |
| SE-04 | Three open streams of one account on hub 1 | A fourth on hub 1; then one closes and a fourth is opened again; a fourth on hub 2 | 429 `rate_limited` `scope: "sse_streams"` with `Retry-After: 30`; then 200; hub 2: 200 |
| SE-05 | Streams of Manager, Admin, Technician, Guard of B1 and Admin of B0 | `finance.money_unposted.v1` for B1 is handled | Manager and Admin of B1 get `money_log.opened` with `kind`, `rowId`, `outcome` and no `amount`; the others nothing |
| SE-06 | Two streams of staff S, one of staff U | `notification.staff_inbox_created.v1` for S | Both of S get `inbox.created`; U nothing |
| SE-07 | Streams of the requester R and of another Manager | `reporting.export_ready.v1` with `requestedBy = R` | Only R gets `export.ready`; no URL in it |
| SE-08 | Manager M with streams of sessions s1 (two tabs) and s2 | `identity.session_revoked.v1` for s1 | All three get `session.revoked`; the two s1 streams close after it, the s2 stream stays open |
| SE-09 | A resident's session is revoked | The handler runs | No `realtime.events` row, no `NOTIFY` |
| SE-10 | A stream receives event e1 and drops; e2, e3, e4 are written | Reopen with `Last-Event-ID = e1` | `ready.resumed = true`, then e2, e3, e4 in `created_at` order (an event within 5 s before e1 may repeat) |
| SE-11 | The buffer holds an `inbox.created` of another account and a `money_log.opened` of B0 | Reopen with a recent `Last-Event-ID` as a Manager of B1 | Neither is replayed |
| SE-12 | `Last-Event-ID` of 30 hours ago; `abc`; a UUIDv4; 1 hour ago with 260 matching rows | Open | `resumed: false` and no replayed event, each time; never 400 |
| SE-13 | One outbox message | The handler runs twice (relay retry) | One row in `realtime.events`; one notification; the second run returns no row |
| SE-14 | A stream on hub 2 only | The worker's handler publishes | The event reaches the hub 2 stream (fan-out across processes through `NOTIFY`) |
| SE-15 | A stream opened with a token whose `exp` is in 60 s | The fake clock passes `exp` | The server closes the stream (`closeReason = token_expired`); a reopen with a new token and `Last-Event-ID` replays what was written meanwhile |
| SE-16 | Open streams on a process | `closeLive()` (shutdown) | Every stream closes before the HTTP server stops; the server stop does not wait on them |
| SE-17 | Open streams; the `LISTEN` backend is ended with `pg_terminate_backend` | The driver listens again | Every local stream closes (`listen_reconnected`); a reopen with `Last-Event-ID` gets the events written while it was down |
| SE-18 | A built event whose wire would exceed 7,500 bytes | Publish | The hub throws before `pg_notify`; `realtime_payload_too_large` is logged; `ck_events_data` also refuses a `data` over 2,048 bytes |
| SE-19 | Maintenance on | Open; an already open stream | Open: 503 `maintenance`; the open stream stays open and gets heartbeats |
| SE-20 | The web origin of the environment | A preflight `OPTIONS /api/v1/staff/events` with `Access-Control-Request-Headers: authorization, last-event-id` | `Access-Control-Allow-Headers` lists both |
| SE-21 | Rows of 25 hours and of 1 hour | `realtime_purge` runs | The 25-hour row is deleted; `{"deleted": 1}` |
| SE-22 | One event of each type | Read the frames | Each `data` matches the schema of §6 exactly (no extra field); the source's personal or money fields are absent |
| SE-23 | The web CMS (P4, Playwright): a Manager in two browsers | Browser B revokes A's session (E-33) | Browser A signs out within 2 s; a `ticket.created` refreshes A's ticket list without a reload |
| SE-24 | A stream opens and closes; a fourth is refused | Scrape `/metrics` | `sse_streams_open` goes 1 → 0; `sse_stream_opens_total{outcome}` counts `fresh` and `limited` |
| SE-25 | Relay idle, 100 events written one by one on staging | Time from the producer's commit to the frame in a test client | p95 ≤ 2 s (planned; measured in P2-12 on staging) |
| SE-26 | `@core/web` with a fake `fetch` (P4) | 401; a network error four times; a `ready`; `session.revoked` for its own session; a 429; 45 s of silence | Refresh then reconnect at once; waits 1, 2, 4, 8 s and reset after `ready`; stops; stops with the banner state; closes and reopens |

## 19. Statements run

On 2026-10-28, `postgres:18.6` (x86_64, Docker, the local stack), a scratch database with the DDL of DOC-17 §9 (`realtime.events`, as proposed by this document):

| What | Result |
| --- | --- |
| The `CREATE TABLE` and its index | ran with `ON_ERROR_STOP` |
| 10 refused rows: both targets, no target, an unknown role, empty roles, an unknown type, `session.revoked` without a session, a session on another type, `data` not an object, `data` of 2,100 characters, a UUIDv4 id | each refused by its `CHECK` (`ck_events_target`, `ck_events_roles`, `ck_events_type`, `ck_events_close`, `ck_events_data`, `ck_events_id_v7`) |
| A valid row | inserted |
| The publish statement of §9.1 on a session that had run `LISTEN realtime` | one row and one notification, delivered after the statement's commit with the wire of §9.2 (SE-13 first half) |
| The same source message again | no row returned, no notification (SE-13) |
| The replay of §8.2 for Manager 051 and for Technician 053 | the Manager got its `inbox.created`, the role event and its `session.revoked` in order; the Technician only its own `inbox.created` (SE-11); a 25-hour row was excluded |
| `uuid_extract_timestamp` of a 30-hour UUIDv7 against the 23-hour bound | too old (SE-12) |
| The purge `DELETE … WHERE created_at < now() - interval '24 hours'` | deleted the 25-hour row only (SE-21) |
| `EXPLAIN` of the replay | `Index Scan using ix_events_building_created` with an incremental sort on `(created_at, id)` |

## 20. Decisions made while writing

- **DR-287 · The server side of the stream is built in P2, the web side in P4** — *proposed, for the Owner* (it reads together an Owner direction, DR-264, and DR-76). Problem: DR-76 item 4 builds "the SSE module" in P2 and the master plan's P2-12 lists the `realtime` module; DR-264 item 5 leaves "the stream, the bell and `session.revoked`" for P4; DOC-40 lists `sse_streams_open` as P4; DOC-17 §9 puts `realtime.events` in P5-09. Decision: `@mod/realtime`, E-75, `realtime.events`, `realtime_purge` and the `identity`, `notification` and `finance` mappings are built and tested over `app.handle` in P2-12; the web opens the stream, shows the bell and handles `session.revoked` in P4; the `tickets` mapping comes with tickets (P4), the `reporting` one with exports (P6). Consequences: the DDL of `realtime.events` moves to the P2 gate of DOC-17; DOC-40's `sse_streams_open` becomes P2; FL-07's SSE arrow is live from P4; the alternative (everything in P4) removes `realtime` from P2-12 and moves ADR-0024 and DOC-52 (SSE) to the P4 gate. Write to: DOC-17 §9 and "Sections owed", DOC-40 §4, master plan P2-12 and the P4 web task, DOC-55 §13.
- **DR-288 · Stream rules the register leaves open** — *decided under delegation*. Problem: DR-75 fixes the limit, the heartbeat and closing on revocation, but not how long a stream may outlive its token, whether the limit is per process or global, what a fourth stream gets, what maintenance does to a stream, or that the browser must be allowed to send `Last-Event-ID`. Decision: (1) the server closes a stream when the access token it was opened with expires; (2) the limit is counted per `api` process; (3) a fourth stream is 429 `rate_limited` with `scope: "sse_streams"` and `Retry-After: 30`; (4) maintenance refuses a new stream with 503 and leaves open streams open; (5) `Last-Event-ID` joins the CORS allowed headers. Consequences: a revoked session's stream lives at most 15 minutes, like its token; one account can hold 6 streams on production; DOC-50 §5.3 and `ALLOWED_HEADERS` gain a header; DOC-42 §6 and DOC-39 §6 (the streams row, "per process") are reworded. Write to: DOC-52, DOC-50 §5.3, DOC-39 §6, DOC-42 §6, `apps/api/src/app.ts`.
- **DR-289 · The replay buffer and delivery** — *decided under delegation*. Problem: DR-75 names an "opt-in replay buffer with `Last-Event-ID`" and DR-87 the table `realtime.events`, but not which events are replayed, the table's columns, how a repeated handler is kept from writing twice, how a replay meets the live feed, or what happens when the `LISTEN` connection drops. Decision: every type is replayable; one row per source outbox message (`UNIQUE (source_message_id)`), written with the `NOTIFY` in one statement; replay by time with a 5-second overlap, at most 200 events, a cursor at most 23 hours old, otherwise `resumed: false`; the stream registers before it reads the replay and queues live events until the replay is sent; the reference's 60-second age skip is dropped; a lost `LISTEN` connection closes the process's streams once it is back. Consequences: a tab never misses an event while it reconnects within 23 hours (unless 200 or more); a few events can arrive twice; DOC-17 §9 holds the DDL of §8.1. Write to: DOC-17 §9, DOC-52, DOC-09 §4.3 (the natural key of the realtime handlers).
- **DR-290 · The web client is the vendored `RealtimeClient` with two local changes** — *decided under delegation*. Problem: DOC-55 §13 specifies a backoff of 1, 2, 5, 10 s (cap 30 s), a stop on 429 and a 45-second silence watchdog; the vendored `@core/web` client backs off 1, 2, 4, 8 s (cap 15 s), retries a 429 and has no watchdog. Decision: keep the vendored backoff; add the stop on 429 and the watchdog as local changes to `core-web` in the P4 web task. Consequences: DOC-55 §13's backoff line is revised; two lines under `local-changes` of `packages/CORE_VERSION`. Write to: DOC-55 §13, DOC-12 §13, `packages/CORE_VERSION`.

## 21. Not in this document

| Topic | Where |
| --- | --- |
| The outbox events, their payloads and handlers | DOC-09 §5, §6 |
| The inbox, templates, device tokens, push and receipts | DOC-31 |
| The DDL of `realtime.events` | DOC-17 §9 |
| The retention of the buffer, the purge job | DOC-20, DOC-38 §4 |
| What the web does with each event | DOC-55 §13, DOC-64 |
| The Caddy and Tunnel configuration | DOC-70 §7 |
| The metric rows | DOC-40 |
| The payment webhook's settlement path | DOC-23 §6, DOC-24 |

## 22. Traceability

| Item | Source | Here | Tests |
| --- | --- | --- | --- |
| E-75 endpoint, events, limits | DR-75, DOC-51 §2.2 | §4…§7, §10 | SE-01…08, SE-22 |
| Replay with `Last-Event-ID` | DR-75, DR-87, DR-115 | §8 | SE-10…12, SE-21 |
| Heartbeat ≤ 30 s, no buffering | DR-75, DR-83 item 10, DOC-70 §7.1 | §5, §10.3 | SE-03 |
| `LISTEN` on a direct connection | DR-67, DOC-10 §6.3 | §9.3 | SE-14, SE-17 |
| A revoked session closes its stream | DR-75, DOC-26 §3.8 | §6.6, §10.2 | SE-08, SE-15, SE-23 |
| `realtime` as a strict leaf; mappings in producers | DR-04, DR-116, DOC-12 §4.4 | §6, §9.1 | `check:arch` |
| Phases | DR-76, DR-264 | §2 | — |
| UX-17 live data | DOC-53 | §11 | SE-23 |
| Webhook | DR-25, DR-32 | §12 (owed) | P3 |
| Push contract | DR-52, DR-177 | §13 (summary) | DOC-31 `NT-` |

## Open questions

1. **When the stream is built** (DR-287, proposed): the server in P2-12 and the web in P4, or everything in P4. Until the Owner decides, this document follows the first.
2. **The webhook part** (§12) waits for the gateway sandbox (DR-25) and is written in P3-00 with DOC-24.
