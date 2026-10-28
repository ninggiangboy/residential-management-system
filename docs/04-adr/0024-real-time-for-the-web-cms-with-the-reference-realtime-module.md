# ADR-0024: Real-time for the web CMS with the reference `realtime` module

- Status: Accepted
- Date: 2026-10-28 · Related: DR-75, DR-76, DR-67, DR-83, DR-87, DR-115, DR-264, DR-287…290, UX-17, FR-45, DOC-52

## Context

Original SDD §10.4 says the web CMS "receives new entries over SSE as in the reference" and nothing more: no event list, no authentication, no limit, no answer for a reconnecting tab. Staff need a change to show without a reload: a new transfer that was not posted, a new ticket, a finished export, and above all a revoked session, which should sign a tab out at once rather than at the next token refresh (FR-45). The constraints are fixed by other decisions: one VPS with two stateless `api` containers behind Caddy, Cloudflare and a Tunnel (DR-83); Cloudflare closes a proxied request that receives nothing for 100 seconds; PostgreSQL is the only shared state, with no Redis and no broker (DR-62); the browser's `EventSource` cannot send the `Authorization` header that the API requires; the mobile apps already refresh on focus and on push (original SDD §6.1).

## Options considered

1. **Polling from the web CMS** (every 15–30 s per screen). Nothing new on the server — but every open tab queries every list all day, a revoked session still waits for the next poll, and a change shows up to 30 s late.
2. **WebSocket.** Two-way, mature — but the web needs only server-to-client messages, a WebSocket needs its own authentication handshake and reconnect logic, and it adds upgrade handling to Caddy, the Tunnel and the health checks for no gain.
3. **A hosted push service** (Pusher, Ably, Firebase). Nothing to run — but staff events would leave the host (DR-58, Decree 13), it is another paid account and secret, and a revoked session would depend on a third party.
4. **SSE with Redis pub/sub between the `api` instances.** The common pattern — but Redis is a new container to run, back up and monitor only to fan out a few hundred events a day.
5. **SSE served by the reference `realtime` module: `LISTEN`/`NOTIFY` in PostgreSQL for the fan-out between processes, a replay table for `Last-Event-ID`, and the reference's fetch-based client so the bearer token is sent.**

## Decision

Option **5** (DR-75). `realtime` is reused as is from the reference (DR-03) as a strict leaf module; what each producer's event means on the stream lives in the producer's `integrations/realtime.ts` (DOC-12 §4.4). The contract is DOC-52.

- **One endpoint**, `GET /api/v1/staff/events` (E-75), for staff only. Six event types: `inbox.created`, `ticket.created`, `ticket.changed`, `money_log.opened`, `export.ready`, `session.revoked`. They carry ids, codes and enumerated words, never personal data or money; the web refetches what changed.
- **Fan-out through PostgreSQL.** A handler in the worker writes the event to `realtime.events` and calls `pg_notify` in one statement, so the notification is delivered at commit and a repeated handler writes nothing. Each `api` process holds one `LISTEN` connection, direct, never through a pooler (DR-67).
- **Replay.** Every event stays 24 hours in `realtime.events` (DR-115); a reconnecting tab sends `Last-Event-ID` and gets up to 200 events of the last 23 hours, or `resumed: false` and refetches everything.
- **Limits.** 3 streams per account per process; a heartbeat every 25 s (below Cloudflare's 100 s); Caddy flushes at once on that path (DOC-70 §7.1); a stream ends at its token's expiry and on `session.revoked` for its session.
- **Client.** The vendored `RealtimeClient` of `@core/web` over `fetch`. The mobile apps do not use SSE.
- **Phases.** The server side is built in P2-12 (DR-76); the web opens the stream in P4 (DR-264), as DR-287 proposes to the Owner.

## Consequences

**Positive**

- No new service: the fan-out, the replay and the purge are PostgreSQL and one hourly job (`realtime_purge`).
- A revoked staff session closes its open tabs within about 2 seconds of the revocation instead of up to 15 minutes.
- A tab that sleeps or loses its network catches up from the buffer instead of missing changes.
- Nothing about residents or money crosses the stream.

**Negative**

- `LISTEN` pins one direct PostgreSQL connection per `api` process, and adding PgBouncer in transaction mode later would break the stream silently unless that connection bypasses it (master plan §8 risk row).
- Delivery is best-effort: a notification sent while a process re-listens is lost to its streams, which is why the process closes them so they replay. The buffer adds a table, a purge and a few duplicate events after a reconnect.
- `NOTIFY` payloads are capped below 8,000 bytes, so an event can never carry content; this is accepted and enforced by a 2 KB cap on `data`.
- The stream limit is counted per process, not per account across processes: up to 6 streams per account on production.
- Long-lived requests make deploys close every stream; tabs reconnect within seconds through the other `api`.
- The reference client lacks two behaviours the web wants (stop on 429, a silence watchdog); they are local changes to a vendored package.

**Follow-up work**

- P2-12: the module, E-75, `realtime.events` (DDL in DOC-17 §9), the `identity`, `notification` and `finance` mappings, tests SE-01…22, SE-24, SE-25.
- P4: the web client in the `_app` layout, the bell, the two local changes to `core-web`, SE-23 and SE-26; the `tickets` mapping.
- DOC-40 adds `sse_stream_opens_total` and `sse_events_published_total`; DOC-50 §5.3 adds `Last-Event-ID` to the CORS headers.
