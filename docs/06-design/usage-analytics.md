# Usage analytics

> Status: **Review** · Updated: 2026-10-28 (DR-279) · DOC-104
> Depends on: [DR](../00-decision-register.md) (DR-279, DR-103, DR-58, DR-64, DR-264, DR-265), [ADR-0028](../04-adr/0028-self-hosted-usage-analytics-without-an-identifier.md), [ADR-0022](../04-adr/0022-personal-data-protection.md), [ADR-0014](../04-adr/0014-schema-per-module-no-cross-module-foreign-keys.md), [ADR-0013](../04-adr/0013-time-zones-and-calendar-day-semantics.md), [DOC-06](../02-glossary.md), [DOC-17](../05-data/operations-model.md) §9A, [DOC-20](../05-data/data-lifecycle.md) §2.5 and §5, [DOC-35](audit-privacy-and-terms.md) §7 to §9, [DOC-38](jobs-and-outbox-runtime.md) §4, [DOC-39](security.md) §6, [DOC-40](observability.md) §4.7, [DOC-41](configuration-reference.md) §13A, [DOC-42](error-handling.md) §10, [DOC-51](../07-api/api-endpoints.md) E-173, [DOC-55](../08-ux-ui/client-architecture.md) §15A, [DOC-56](../08-ux-ui/screens/README.md), [DOC-73](../09-operations/mobile-release.md) §10.2, §10.3
> Main readers: P1-29 (the build), P6-10 (the store declarations), DOC-103 (go-live), every task that adds a screen or a control

This document says what the system records about how the apps are used, what it never records, how a client sends it, how it is stored, rolled up and read, and what the stores and the privacy notice must say about it. The tables are in DOC-17 §9A, the endpoint contracts are E-173 and E-174 in DOC-51, the keys are in DOC-41 §13A, the metrics in DOC-40. It does not cover errors and crashes (DOC-42 §10, DOC-55 §15) or the counters of business operations (DOC-40).

## 1. Reading guide

| Question | Answer lives in |
| --- | --- |
| What is recorded, and what is never recorded? | §2, §3 |
| Which screens and which controls may be named? | §4 |
| What does a client do: session, queue, switch? | §5 |
| What does the server do with a batch? | §6 |
| Where does it live, for how long, and who deletes it? | §7 |
| How do I see the most used screen? | §8 |
| What do the privacy notice, Apple and Google say? | §9 |
| What if someone floods or forges it? | §10 |
| Which metrics, keys and tests? | §11, §12, §13 |

## 2. Principles

1. **Nothing identifies a person.** A row has no account, membership, unit, role, device, token, IP address or user agent (DR-279 (3)). The only identifier is a random session id that the client keeps in memory (§5.2).
2. **Closed lists.** A client can only name a screen of DOC-56 and a control of §4.2. There is no free text and no property bag (DR-279 (2)).
3. **The client decides, the server checks.** The switch is on the device (§5.4); the server still checks every name, every size and every rate, because a client can be modified.
4. **It never changes what the product does.** No screen waits for a batch, no error reaches the user, no business rule, access decision, alert or amount reads these tables.
5. **Approximate on purpose.** A batch lost to the network is not retried; a batch repeated by a proxy is counted twice (DR-279 (9)). Nobody should bill, grant or alert on these counts.
6. **Nothing leaves the VPS.** No SDK, no third-party host, no cross-border flow added to ADR-0022.

### 2.1 What is never recorded

| Never | Why | Where it is enforced |
| --- | --- | --- |
| Account id, membership, unit, role | It would be a record of one named resident's habits (ADR-0028 option 2) | No column (DOC-17 §9A.1); UA-02 |
| Device id (IDFV, Android ID, advertising id), push token | A stable identifier joins launches and apps; Apple names session and fingerprint ids as tracking when joined with other companies' data | The client never reads them (UA-25) |
| IP address, user agent | Personal data (DOC-35 §7.1) | The batch handler does not store them; the IP bucket key holds the IP, as every IP bucket does, and `token_purge` deletes the idle bucket (DOC-20 §2.2) |
| Text typed, form values, search terms, amounts, names | They are personal or financial | No field for them in the body (§6.2) |
| A URL, a path, a route parameter, a query string | A path carries ids (`/fees/<batch>`) | The grammar of a name (§4.3); the check `ck_usage_event_name` |
| A screenshot, a screen recording, a tap position | Session replay shows names and amounts; Apple wants disclosure and consent for it | Not in the event schema |
| The state of the usage switch of another person, or the tap on the switch | The switch must not be a signal | There is no target id for it (§4.2) |
| Location, contacts, anything from a sensor | Not needed | The clients ask for no permission for it |

## 3. Events

Four events exist (DR-279 (1)). Another needs a new DR.

| Event | Means | `name` | Sent when |
| --- | --- | --- | --- |
| `screen_view` | A screen was shown to a signed-in user | A screen id of §4.1 | The screen gains focus; once per focus (§5.5) |
| `tap` | A control of §4.2 was pressed | A target id `<Screen>.<control>` | The press handler of the control runs, after the action has been started (the tap never delays it) |
| `app_open` | The app came to the foreground with a signed-in user | `Launch` (the app or the page started) or `Resume` (it came back from the background or a hidden tab) | At the start of a foreground stretch (§5.6) |
| `app_close` | The app left the foreground | `Background` (mobile: the app went to the background; web: the tab was hidden or closed) | At the end of a foreground stretch; it carries `durationSec`, the seconds of that stretch (§5.6) |

"Close" is not "quit": a phone does not tell the app that the person swiped it away, so the end of use is the moment the app leaves the foreground. A stretch whose end the client never saw (the app was killed, the battery died) has an `app_open` and no `app_close`; its time is not counted (§10).

Every event also carries `ageMs`: the milliseconds between the event and the moment the batch is sent, 0 to 3,600,000. The server stores `occurred_at = received_at - ageMs`, cut to the second. The client's own clock is never used, so a phone with a wrong time cannot put events in the wrong day.

## 4. The catalog

### 4.1 Screens

A `screen_view` name is the **section id of a screen in DOC-56** (`Main`, `Fees`, `S-Account`, `W-Residents`…).

- The constant `USAGE_SCREENS` in `@rms/shared-types` lists the ids of the screens that the apps have when the code is written; a screen is added with the task that builds it. Every id in it must be a section id of DOC-56 (UA-15).
- **Not recorded:** a screen shown without a session, and the consent screens. The rule: every section of DOC-56 whose *Role or member type* says "signed out" (`Login`, `Login-Error`, `OTP`, `S-Login`, `S-Login-Error`, `W-Login`, `W-Forgot-Sent`, `W-Reset`…), and `Terms` and `Terms-Update` (the person has not yet accepted the privacy notice that describes this record), and `Unit-Pick` (no unit is chosen yet, so there is no building to record under, §6.1). The constant `USAGE_EXCLUDED_SCREENS` lists them and a test checks it against DOC-56 (UA-15).
- A screen with several states (`Fees` and `Fees-NoPay`) is several ids; the client reports the id of the state shown, as DOC-56 lists it.
- A modal or a sheet is not a screen unless DOC-56 gives it a section id.

### 4.2 Controls

A `tap` name is `<Screen>.<control>`, where `<Screen>` is a section id of §4.1 and `<control>` is a lower-case word with underscores. The three clients are measured: the resident app, the staff app and the web CMS.

**What is measured.** The controls that start an action that matters to the building: paying, reading a notice, sending a request, and the decisions of staff on the web and in the app (publishing a fee batch, recording a payment, assigning a ticket, sending a notice, reviewing a vehicle). A tap records **the press that starts the action**, not its outcome: whether the payment settled or the ticket was created is already in the business tables (`finance`, `tickets`, `notices`), and the gap between the press and the outcome is the drop-off that this record exists to show (§8.2). Reading a notice needs no tap: it is the `screen_view` of `Notice-Detail`.

**What is not measured.** The usage switch (§2.1); a field the person types in; a row that stands for a person or a unit (so no `B-Units.open_unit`); anything that would put an id, an amount or a name in the target. A control name is a word of the interface, never data.

#### 4.2.1 Listed now (P1-29)

The controls of screens that phase 1 builds. P1-29 confirms each name against the built screen.

| Target | Screen | Control | Why |
| --- | --- | --- | --- |
| `Account.language` | `Account` | The language row | Do residents switch language |
| `Account.push` | `Account` | The push row | How many turn push off |
| `S-Account.language` | `S-Account` | The language row | The same, staff app |
| `S-Account.push` | `S-Account` | The push row | The same, staff app |
| `W-Profile.language` | `W-Profile` | The language field | The same, web CMS |
| `W-Profile.reset_link` | `W-Profile` | The "send me a reset link" button | Password resets from the profile |
| `W-Import.save` | `W-Import` | The button that saves a validated import | The main web action of phase 1 |
| `W-Resident-Add.submit` | `W-Resident-Add` | The create button | Residents added by hand against by import |
| `W-Staff-New.submit` | `W-Staff-New` | The create button | Staff accounts created |
| `W-Building.save` | `W-Building` | The save button | Building settings changed |

#### 4.2.2 Owed with their screens

Each row is added to §4.2.1 and to `USAGE_TARGETS` by the task that builds its screen (§4.3). The control names are indicative: the screen task fixes the name and keeps the rest of the row.

| Target | Control | Phase | Why |
| --- | --- | --- | --- |
| `Fees.pay` | The pay button of the fee list | P3 | Start of payment |
| `Pay-Select.confirm` | Confirm the batches and the method | P3 | A payment intent is asked for |
| `Pay-VietQR.copy_content` | Copy the transfer text | P3 | Do residents pay by the code or by hand |
| `Fee-History.open_receipt` | Open a receipt | P2 | Receipts read |
| `Notice-Detail.open_attachment` | Open an attachment | P4 | Notices read to the end |
| `Notices.filter` | Apply a filter | P4 | Is the list found useful |
| `Inbox.open_item` | Open an inbox entry | P4 | Push to action |
| `Requests.new` | The button that opens the form | P4 | Intent to send a request |
| `Request-New.submit` | Send the request | P4 | Requests sent |
| `Request-Detail.comment` | Send a comment | P4 | Follow-up on a request |
| `Request-Cancel.confirm` | Cancel before acceptance | P4 | Requests withdrawn |
| `Request-Done.rate` | Send the rating | P4 | Ratings given |
| `Member-Add.submit` | Add a household member | P4 | Household set-up |
| `Vehicle-Add.submit` | Register a vehicle | P5 | Vehicles registered |
| `QR-Expired.regenerate` | Make a new QR code | P5 | Codes that expire unused |
| `B-Assign.confirm` | Assign a ticket (staff app) | P4 | Ticket handling by the Manager |
| `B-Ticket-Close.confirm` | Close or reopen (staff app) | P4 | The same |
| `B-Notice-New.send` | Send a quick notice (staff app) | P4 | Notices sent from the phone |
| `B-Vehicle-Review.approve` | Approve a vehicle (staff app) | P5 | Review work |
| `K-Job-New.accept` | Accept a job | P4 | Technician response |
| `K-Job-Done.submit` | Report a job done | P4 | Jobs closed by the Technician |
| `G-Plate.search` | Search a plate | P5 | Guard lookups by plate |
| `W-Fee-Import.save` | Save an imported batch | P2 | Batches by import |
| `W-Fee-Batch.publish` | Publish a draft batch | P2 | Batches published |
| `W-Fee-Record.record_payment` | Record a manual payment | P2 | Cash and transfer entered by hand |
| `W-Debts.send_reminders` | Send debt reminders | P2 | Reminders sent |
| `W-Statement.upload` | Upload a bank statement | P3 | Reconciliation work |
| `W-Ticket-Assign.confirm` | Assign a ticket (web) | P4 | Ticket handling on the web |
| `W-Notice-Edit.send` | Send or schedule a notice | P4 | Notices sent from the web |
| `W-Docs.save_page` | Save a library page | P5 | Library edited |
| `W-Vehicles.approve` | Approve a vehicle (web) | P5 | Review work on the web |
| `W-Export-Center.download` | Download an export | P6 | Exports used |

### 4.3 Adding a control

1. Add a row to §4.2.1 (moving it from §4.2.2 if it is there) in the change that adds the control. A control with no row is not tracked.
2. Add the id to `USAGE_TARGETS` in `@rms/shared-types`; the test UA-15 fails when the constant and §4.2.1 differ.
3. Call `trackTap('<Screen>.<control>')` from the handler. The argument is typed (`UsageTarget`), so a misspelled id does not compile.
4. A name must satisfy the grammar `^[A-Z][A-Za-z0-9-]*(\.[a-z][a-z0-9_]*)?$` and be at most 60 characters. The same rule is the check `ck_usage_event_name` (DOC-17 §9A.1).

## 5. The client

The tracker is shared code. `@rms/client-core` holds the pure part (queue, session, batching, the sender port, an injected clock and id maker, so tests need no timers or network); `@rms/mobile-core` binds it to the device storage, to the app state and to the router of Expo; `apps/cms-web` binds it to TanStack Router. No client imports server code (DOC-55 §2).

### 5.1 What the screens call

| Call | Where | Does |
| --- | --- | --- |
| `usage.screen(id)` | The route layout of each app, on focus | Queues a `screen_view` for the id that the route name maps to (a table `routeToScreen` per app; a route that is not in it is not tracked; parameters never reach the id) |
| `trackTap(target)` | A press handler | Queues a `tap` |
| `usage.setEnabled(boolean)` | The switch | Stores the choice, clears the queue when it is off |
| `usage.foreground(true \| false)` | The binding of each platform to its app state (mobile: `AppState`; web: `visibilitychange`, `pagehide`), never a screen | Queues an `app_open` or an `app_close` and measures the stretch (§5.6) |

All of them return at once, never throw and never await the network.

### 5.2 The session

- `sessionId` is a UUID v4 made at launch (the web: at page load) with the platform's secure random source.
- It is renewed when the app comes back from the background after **more than 30 minutes** (the `Resume` of that return is the first event of the new session), and when the person signs out and another signs in.
- It is kept **in memory only**: not in the device storage, not in a cookie, not in a log line. Two launches of one phone cannot be joined (UA-22).

### 5.3 The queue and the batch

**No request per action.** A press, a screen change, an open or a close only appends to the queue in memory. The queue goes to the server in one request when the person leaves the app, so a normal use of the app costs one request, not one per action. The `app_close` is queued first, so it travels in the batch that its own going-to-the-background sends.

| Rule | Value |
| --- | --- |
| Queue | In memory, at most 100 events; the oldest is dropped beyond that |
| A batch is sent when | The app goes to the background (mobile: `AppState` `background`; web: `visibilitychange` to `hidden` and `pagehide`, sent with `fetch(…, { keepalive: true })` so that closing the tab does not cancel it), **or** 50 events are queued (the size of one request), **or** 5 minutes have passed since the first queued event (so a long session is not held back, and a crash loses at most 5 minutes) |
| Size | At most 50 events and 16 KB per request (the server's limit, §6.2) |
| In flight | One request at a time |
| On `X-Usage-Enabled: false` | The queue is cleared and nothing is queued or sent until the next launch (§5.4) |
| On a failure | If **no answer** arrives (a network error), the events stay queued and go with the next batch; an event older than 1 hour is dropped (the server refuses a larger `ageMs`) and the queue never holds more than 100. If **any answer** arrives, 401, 413, 429, 503 or the like, the batch is **dropped**. No retry loop and no message to the person |
| Sent with | The token of the signed-in account (DOC-55 §5) and, in the resident app, the `X-Unit-Id` of the active unit, like any unit call; through the fetcher without the idempotency header and without the retry of reads. Nothing is sent while no unit is chosen |
| On sign-out | The queue is cleared before the token is dropped, so events of one account are never sent with the token of the next |
| Persistence | None. A killed app loses its queue |

### 5.4 The switch

- **Copy.** Title `common.usage.title`: vi "Chia sẻ dữ liệu sử dụng ẩn danh", en "Share anonymous usage data". Hint `common.usage.hint`: vi "Giúp ban quản lý biết màn hình nào được dùng nhiều và ứng dụng được mở bao lâu để cải thiện ứng dụng. Không gắn với tài khoản hay số điện thoại của bạn.", en "Helps the management see which screens are used, and how often and how long the app is open, so it can improve the app. It is not tied to your account or phone number." (DOC-68 §4.6; shared keys because three screens use them.)
- **Where.** `Account` (resident app, DOC-60), `S-Account` (staff app, DOC-61), `W-Profile` (web CMS, DOC-64).
- **Default.** On (DR-279 (5)). The default is the constant `USAGE_DEFAULT_ENABLED` in `@rms/client-core`; counsel's answer (DR-279 (11)) may turn it off.
- **Stored** on the device (mobile: the device storage of `@rms/mobile-core`, key `usage.enabled`; web: `localStorage`, key `rms.usage.enabled`, read in a `try/catch`), not on the server and not per account. Another account that signs in on the same device inherits the choice.
- **Off** means: nothing is queued, the queue is cleared at once, no request is made. Turning it on again starts a new session.
- **The server can tell the apps to stop.** When `USAGE_ENABLED` is false (§12) the batch is answered 204 with the header `X-Usage-Enabled: false`. The client then clears its queue and queues and sends nothing for the rest of that launch (a flag in memory); the first batch of the next launch learns it again. Setting the key back to `true` resumes it with no release. The web CMS can read the header because it is in the exposed list of DOC-50 §5.3.

### 5.5 Noise

A `screen_view` for the same id within one second of the previous one is merged (a re-render must not count twice). A `tap` is never merged: ten presses are ten events.

### 5.6 Opening, closing and the time of use

A **foreground stretch** is the time from the app coming to the foreground to it leaving. The client records it as a pair:

1. When a signed-in user is in the foreground (the app starts with a stored session, a sign-in completes, or the app returns), the tracker queues `app_open` with `Launch` for the first stretch of the process and `Resume` for every later one, and starts a timer on the **monotonic clock** of the platform (`performance.now()`, which the web and React Native both have), never on the wall clock.
2. When the app leaves the foreground, the tracker queues `app_close` `Background` with `durationSec`, the whole seconds of the timer, from 0 to 86,400 (a longer stretch is cut to the cap), and the batch is sent (§5.3).
3. **Mobile:** `AppState` `active` opens a stretch and `background` closes it. `inactive` (a call, the control center, a permission dialog) closes nothing. **Web:** `visibilityState` `visible` opens and `hidden` closes; `pagehide` closes a stretch that `hidden` has not already closed, once.
4. Signing out clears the queue (§5.3), so the stretch in progress is not recorded and no `app_close` is queued for it. The next sign-in opens a new stretch.
5. Nothing is recorded for a stretch while the switch is off (§5.4) or while no session exists.

What this gives, with no identifier: how often the app is opened (`app_open`), how long a stretch lasts (`durationSec`), how long a session lasts (the sum of `durationSec` of one `session_id`), and how long a screen is kept open (the time to the next event of the session, §8.2). It does **not** give the time of one person across days: the session is renewed and joined to nothing (§2).

## 6. The server

The module is `analytics` (`modules/analytics`, ADR-0028), a leaf: no module calls it and it calls none. Layout as DOC-12 §4: one command `application/use-cases/record-usage-events.ts` (one class, one `execute`), one handler file, two route files (`presentation/resident-routes.ts` for E-173, `presentation/staff-routes.ts` for E-174) that call the same use case. It runs in `api` and, for the job, in `worker`.

### 6.1 Route and order of checks

Two routes share one use case (DOC-51): **E-173 `POST /api/v1/me/usage-events`**, audience `unit: broadcast_notices` (the capability that every member type holds, a Helper included, DOC-27 §3.2; the resident app sends `X-Unit-Id` like any unit call), and **E-174 `POST /api/v1/staff/usage-events`**, audience `staff: any`. They are two routes because a resident token never passes a staff guard (DOC-12 §5.3). In order:

1. Body at most 16 KB, else 413 `payload_too_large`.
2. Maintenance mode, else 503 `maintenance`.
3. The token and the app-version gate (DOC-50 §7), as for any route; no token is 401.
4. The IP bucket `usage-events:ip:<ip>`: `USAGE_EVENTS_PER_MINUTE_PER_IP` (30) requests a minute, else 429 `rate_limited`, `scope: "usage_events"` (DOC-39 §6).
5. Validation of the body (§6.2), else 400 `validation_failed`.
6. The session bucket `usage-events:session:<sessionId>`: `USAGE_EVENTS_PER_HOUR_PER_SESSION` (120) requests an hour, else 429. Both buckets are in `platform.rate_bucket`; neither key holds an account.
7. If the building of the token is a demo building (`isDemo`): the events are counted as dropped (`demo`) and discarded, answer 204. If `USAGE_ENABLED` is false: the same with `disabled`, and the answer carries `X-Usage-Enabled: false`, which tells the client to stop sending (§5.4).
8. Each event whose name is not in the lists is dropped and counted (`unknown_name`); the rest are written.
9. One statement writes the batch; the counter `usage_events_total` rises by the written events; answer 204.

The building is the `bid` of a staff token or the building of the resident's active membership (`UnitContext`, DOC-12 §11), never read from the body. The membership is used to find the building and to apply the terms gate; it is not stored.

### 6.2 The body

```http
POST /api/v1/me/usage-events
Authorization: Bearer <access token>
X-Unit-Id: 0192f3c4-5a1e-7000-8000-0000000000a1
Content-Type: application/json

{ "app": "resident", "appVersion": "1.0.3", "platform": "ios",
  "sessionId": "0192f3c4-9d02-4000-8000-00000000a001",
  "events": [
    { "event": "app_open", "name": "Launch", "ageMs": 61200 },
    { "event": "screen_view", "name": "Fees", "ageMs": 4200 },
    { "event": "tap", "name": "Account.language", "ageMs": 900 },
    { "event": "app_close", "name": "Background", "ageMs": 0, "durationSec": 61 }
  ] }
```

| Field | Rule |
| --- | --- |
| `app` | `resident`, `staff`, `web` |
| `appVersion` | `x.y.z`, digits only, as `ck_usage_event_version` |
| `platform` | `ios`, `android`, `web` |
| `sessionId` | A UUID, version 4 |
| `events` | 1 to 50 items; an unknown key anywhere is 400 |
| `events[].event` | `screen_view`, `tap`, `app_open`, `app_close` |
| `events[].name` | A string of at most 60 characters; checked against the lists after validation (`Launch` or `Resume` for `app_open`, `Background` for `app_close`) |
| `events[].ageMs` | An integer from 0 to 3,600,000 |
| `events[].durationSec` | An integer from 0 to 86,400; **required** on `app_close` and **refused** (400) on any other event |

`audience` is not in the body: it is `resident` for a resident token and `staff` for a staff token. `app` is a label the client states; it is not checked against the token (a wrong label spoils a count, not a decision).

### 6.3 The write

One statement, no transaction around it, no outbox event, no audit row: the batch changes no business state, it is not an act of a person (DOC-35 §3.3 audits actions), and a lost batch costs one count. This is the one write path of the system that is not a `UnitOfWork` command with an outbox row, on purpose (DOC-12 §8.3).

```sql
INSERT INTO analytics.usage_event (id, building_id, occurred_at, app, platform, app_version, audience, session_id, event, name, duration_s)
SELECT e.id, $1, date_trunc('second', $2::timestamptz - e.age_ms * interval '1 millisecond'),
       $3, $4, $5, $6, $7, e.event, e.name, e.duration_s
FROM unnest($8::uuid[], $9::text[], $10::text[], $11::int[], $12::int[]) AS e(id, event, name, age_ms, duration_s);
```

Parameters: `$1` the building of the token; `$2` the receive time from the `Clock` port; `$3…$7` app, platform, version, audience and session; `$8…$12` the arrays of the events that passed the lists (`$12` holds `NULL` for every event but `app_close`) (ids are UUIDv7 made by the application, DOC-14 §3). The statement was run in §13.1 with a prepared form of it.

## 7. Storage, rollup and retention

Tables: DOC-17 §9A. Periods: `USAGE_RAW_RETENTION_DAYS` = 90, `USAGE_DAILY_RETENTION_DAYS` = 730 (DOC-41 §13A).

### 7.1 The job `usage_rollup`

Daily at 02:30 in `JOBS_TIME_ZONE`, mode `lock`, grace 12 hours, a row every run (DOC-38 §3.3, §4.1). It works one building at a time, like `orphan_uploads` (DOC-20 §5); the demo building writes no rows (§6.1 step 7):

1. **Roll up** the last 3 complete local days, `[today - 3, today)`, with the statement below. It recomputes each day from the raw rows, so it is idempotent and a day missed by a failed run is made up by the next one.
2. **Purge raw rows** older than `USAGE_RAW_RETENTION_DAYS`, but only before the end of the newest rolled-up day (DOC-20 §5).
3. **Purge the rollup** older than `USAGE_DAILY_RETENTION_DAYS` (DOC-20 §5).

`seconds` is the sum of `durationSec` of the `app_close` rows of the group and is 0 for every other event.

The result in `job_run.details` is `{"rolled": n, "purgedRaw": n, "purgedDaily": n}`.

```sql
INSERT INTO analytics.usage_daily (building_id, day, app, platform, audience, event, name, events, sessions, seconds)
SELECT e.building_id, (e.occurred_at AT TIME ZONE $2)::date, e.app, e.platform, e.audience, e.event, e.name,
       count(*), count(DISTINCT e.session_id), coalesce(sum(e.duration_s), 0)
FROM analytics.usage_event e
WHERE e.building_id = $1
  AND e.occurred_at >= ($3::timestamp AT TIME ZONE $2)      -- $3, $4: local dates [today - 3, today)
  AND e.occurred_at <  ($4::timestamp AT TIME ZONE $2)
GROUP BY 1, 2, 3, 4, 5, 6, 7
ON CONFLICT (building_id, day, app, platform, audience, event, name)
DO UPDATE SET events = EXCLUDED.events, sessions = EXCLUDED.sessions, seconds = EXCLUDED.seconds;
```

Example (§13.1, run): building zone `Asia/Ho_Chi_Minh`, seven events of five sessions between 2026-10-26 23:30 and 2026-10-27 12:10 local. The day of an event is its **local** day: the event at 16:30 UTC on 10-26 (23:30 local) is in 10-26, the one at 17:30 UTC (00:30 local) is in 10-27. The result is five rows for the groups of the example; the sums are 7 events; running the statement again leaves the same five rows.

### 7.2 Size (planned)

About 650 accounts at about 36 events a day (30 screens and taps and about 3 open and close pairs) is 23,000 rows a day, 2.1 million rows at 90 days, about 100 bytes a row and as much again in the index: **about 450 MB planned**, not measured. The rollup is at most a few hundred rows a day. Both are inside the nightly backup and restore with the rest of the database; the restore brings the rows back (DOC-20 §4).

## 8. Reading it

| Need | Way |
| --- | --- |
| "What is used most this week?" | The Grafana dashboard **Usage** (§8.1), at `monitor.<domain>` behind Cloudflare Access (DOC-40 §7) |
| "What was used most last quarter?" | SQL on `analytics.usage_daily` with `rms_readonly` (§8.2); Prometheus keeps 15 days (DOC-40 §2), the table keeps 730 |
| A screen in the web CMS or the apps | **None, by decision.** The record is for analysis outside the product: Grafana and SQL (DR-279 (7)); a screen would be a new requirement and a new DR |
| Who did it | Cannot be answered, by design |

### 8.1 The dashboard `Usage`

Provisioned from `ops/grafana/dashboards/` like the others (generated by `scripts/build-dashboards.ts`, `bun run ops:dashboards`). It supports no alert; it is the one dashboard that exists for a decision of the Owner (DR-279).

| Panel | Query |
| --- | --- |
| Top 10 screens, 7 days | `topk(10, sum by (name) (increase(usage_events_total{event="screen_view"}[7d])))` |
| Top 10 controls, 7 days | `topk(10, sum by (name) (increase(usage_events_total{event="tap"}[7d])))` |
| Opens per day by app | `sum by (app) (increase(usage_events_total{event="app_open"}[1d]))` |
| Average time of a stretch, 7 days | `sum(increase(usage_foreground_seconds_sum[7d])) / sum(increase(usage_foreground_seconds_count[7d]))` |
| Median time of a stretch, 7 days | `histogram_quantile(0.5, sum by (le) (increase(usage_foreground_seconds_bucket[7d])))` |
| Events per hour by app | `sum by (app) (increase(usage_events_total{event=~"screen_view|tap"}[1h]))` |
| Residents against staff | `sum by (audience) (increase(usage_events_total[7d]))` |
| Dropped events by reason | `sum by (reason) (increase(usage_events_dropped_total[1d]))` |

The two time panels read the histogram `usage_foreground_seconds` (§11); the median is only as fine as its buckets (10 s, 30 s, 1, 3, 10, 30 and 60 minutes). `increase` survives a restart of the API (the counter resets and Prometheus corrects for it). A screen no one opened has no series; the panel shows what exists.

### 8.2 SQL for analysis

Run as `rms_readonly`. The first two read the rollup (730 days), the third reads the raw rows (90 days) because it needs the order of events inside a session.

```sql
-- the 20 most opened screens of the last 30 days
SELECT name, sum(events) AS events, sum(sessions) AS sessions   -- sessions: an upper bound (DOC-17 §9A.2)
FROM analytics.usage_daily
WHERE building_id = $1 AND event = 'screen_view' AND day >= current_date - 30
GROUP BY name ORDER BY events DESC LIMIT 20;

-- opens and the time of a stretch, by app (the rollup)
SELECT app,
       sum(events) FILTER (WHERE event = 'app_open')                      AS opens,
       sum(events) FILTER (WHERE event = 'app_close')                     AS stretches,
       round(sum(seconds) FILTER (WHERE event = 'app_close')::numeric
             / nullif(sum(events) FILTER (WHERE event = 'app_close'), 0)) AS avg_seconds_per_stretch
FROM analytics.usage_daily
WHERE building_id = $1 AND day >= current_date - 30
GROUP BY app ORDER BY app;

-- how often a decision control was pressed, by week and app
SELECT date_trunc('week', day) AS week, app, name, sum(events) AS presses
FROM analytics.usage_daily
WHERE building_id = $1 AND event = 'tap' AND name IN ('W-Fee-Batch.publish', 'W-Notice-Edit.send')
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- the payment funnel: sessions that went on to each step, in order (raw rows, last 30 days)
WITH first_at AS (
  SELECT session_id,
         min(occurred_at) FILTER (WHERE event = 'screen_view' AND name = 'Fees')               AS s1,
         min(occurred_at) FILTER (WHERE event = 'tap'         AND name = 'Fees.pay')           AS s2,
         min(occurred_at) FILTER (WHERE event = 'screen_view' AND name = 'Pay-Select')         AS s3,
         min(occurred_at) FILTER (WHERE event = 'tap'         AND name = 'Pay-Select.confirm') AS s4,
         min(occurred_at) FILTER (WHERE event = 'screen_view' AND name = 'Pay-Done')           AS s5
  FROM analytics.usage_event
  WHERE building_id = $1 AND occurred_at >= now() - interval '30 days'
  GROUP BY session_id)
SELECT count(*) FILTER (WHERE s1 IS NOT NULL)                                  AS fees_viewed,
       count(*) FILTER (WHERE s2 >= s1)                                        AS pay_pressed,
       count(*) FILTER (WHERE s3 >= s2 AND s2 >= s1)                           AS pay_select_viewed,
       count(*) FILTER (WHERE s4 >= s3 AND s3 >= s2 AND s2 >= s1)              AS confirm_pressed,
       count(*) FILTER (WHERE s5 >= s4 AND s4 >= s3 AND s3 >= s2 AND s2 >= s1) AS done_viewed
FROM first_at;
```

```sql
-- the time of use per session: opens and total foreground seconds (raw rows)
SELECT session_id, count(*) FILTER (WHERE event = 'app_open') AS opens, sum(duration_s) AS seconds
FROM analytics.usage_event
WHERE building_id = $1 AND occurred_at >= now() - interval '30 days'
GROUP BY session_id;

-- the time a screen is kept open: until the next event of the session, at most 10 minutes (raw rows)
WITH ordered AS (
  SELECT name, event, occurred_at,
         lead(occurred_at) OVER (PARTITION BY session_id ORDER BY occurred_at, id) AS next_at
  FROM analytics.usage_event
  WHERE building_id = $1 AND occurred_at >= now() - interval '30 days')
SELECT name, count(*) AS views,
       round(avg(least(extract(epoch FROM next_at - occurred_at), 600))) AS avg_seconds
FROM ordered
WHERE event = 'screen_view' AND next_at IS NOT NULL
GROUP BY name ORDER BY avg_seconds DESC;
```

The time of a screen is a **reading of the gaps**, not a measurement: the last screen before the app leaves ends at the `app_close`, a screen that is followed by nothing (the app was killed) is left out, and a long pause on one screen is cut to 10 minutes. The figures are good for comparing screens with each other. The time of use is the sum of `durationSec`, which the client measures itself.

A funnel counts **sessions**, not people: a resident who pays in two launches is two sessions, and the session ends at the launch or after 30 minutes in the background (§5.2). Read it as the shape of the drop-off, not as a headcount. The steps are the `Fees`, `Pay-Select` and `Pay-Done` screens and the two taps of §4.2.2, so the funnel exists once P3 has built them. The outcome (the payment settled) is in `finance`, not here.

## 9. Privacy, the notice and the stores

### 9.1 The privacy notice

DOC-35 §9.4 gains one row: the notice must say that the apps record which screens are opened and which listed controls are pressed, without the account, phone, device or location; that the record is kept 90 days and then only as daily counts for 730 days; that it stays on the building's server; that the person can turn it off in `Account`, `S-Account` or `W-Profile`; and the contact of the Manager. The text is the client's legal deliverable (P0-06); a new `privacy` version is published before the first build that sends events reaches a resident (DOC-35 §9.1, DOC-103).

### 9.2 Apple

Checked 2026-10-28.

- **App Privacy ("nutrition label"):** *Usage Data → Product Interaction*; purpose *Analytics*; **not linked to the user**; **not used for tracking**.
- **Tracking.** Apple defines tracking as linking data from the app with data from other companies' apps, websites or offline properties for targeted advertising or advertising measurement, or sharing it with data brokers (<https://developer.apple.com/app-store/user-privacy-and-data-use/>). Nothing here does either, so there is **no App Tracking Transparency prompt** and no `NSUserTrackingUsageDescription`. Apple also bars fingerprinting: the client derives nothing from the device to identify it (§2.1).
- **Privacy manifest.** Each app's `ios.privacyManifests` (the app config) gets `NSPrivacyCollectedDataTypes` with one entry: `NSPrivacyCollectedDataTypeProductInteraction`, `NSPrivacyCollectedDataTypeLinked` false, `NSPrivacyCollectedDataTypeTracking` false, `NSPrivacyCollectedDataTypePurposes` `[NSPrivacyCollectedDataTypePurposeAnalytics]`; `NSPrivacyTracking` false. Expo's guide documents `ios.privacyManifests` with the key `NSPrivacyAccessedAPITypes` (<https://docs.expo.dev/guides/apple-privacy/>) and does not show `NSPrivacyCollectedDataTypes`; **P1-29 checks that key against Apple's privacy manifest documentation and a generated `PrivacyInfo.xcprivacy`** (UA-29).
- Opens, closes and the time of use are the same data type: Apple's examples of *Product Interaction* include app launches and taps, and nothing is added to the label. The label must match the manifest and the privacy notice. EAS Observe's own collection (errors, performance) is declared in the same places (DOC-73 §10.2, §10.3).

### 9.3 Google Play

Checked 2026-10-28 (<https://support.google.com/googleplay/android-developer/answer/10787469>).

- **Data safety form:** *App activity → App interactions* ("information about how a user interacts with the app", for example sections tapped); **collected**; **not shared** (the form defines sharing as going to a third party; collection by the app's own publisher is not sharing); purpose *Analytics*; **users can choose whether this data is collected**. The last answer is allowed only if every user, in every region, can opt out: the switch exists in both apps for that reason.
- App opens, closes and the time of use are *App interactions* too; the form has no separate line for them.
- Not encrypted in transit is not an option: all calls are HTTPS.
- Data deletion: the form asks whether users can ask for deletion. The record holds nothing that belongs to a person, so there is nothing to delete by request; the answer follows DOC-35 §10 for the data that is personal.

### 9.4 Vietnamese law

Decree 13/2023/NĐ-CP and the personal data law that followed it apply to data about an identified or identifiable person. The design treats the record as **not personal data** because no row carries an identifier of a person (§2), and it gives notice and an opt-out anyway. That is a reading of the law, not advice: **DOC-103 asks counsel to confirm it with the legal dossier (P0-06)**. If counsel wants consent first, `USAGE_DEFAULT_ENABLED` becomes false and the notice and the switch copy change; the server, the tables and the stores' answers do not.

### 9.5 What would change the answers

Adding an account id or a device id to a row, sending a row to a third party, recording a tap position, a typed text or a screen: each makes the Apple label "linked to you" or the stores' answers different, and needs a new DR and a new ADR that supersedes ADR-0028.

## 10. Abuse and faults

| Case | What happens |
| --- | --- |
| A client never sends `app_close` (killed, crashed, battery) | That stretch has an `app_open` and no time; the sum of `durationSec` undercounts the time of use a little. Nothing corrects it: the figure is approximate on purpose (principle 5) |
| A modified client sends `durationSec` of 86,400 again and again | It raises the total time; the cap keeps one event to a day, and the rate buckets keep the count of events low. Nothing business reads it |
| One client floods | The IP bucket (30 a minute) and the session bucket (120 an hour) answer 429; the client drops and goes on |
| A modified client sends forged events | It can only name listed screens and controls and it counts as one session id per batch it makes up; it can raise a count. Nothing business reads the counts (principle 4) |
| A modified client sends a name outside the lists | Dropped and counted (`unknown_name`); a path or a query string is also refused by the check of the table |
| An old app sends a name that a newer API no longer lists | Dropped and counted; no error |
| A body of 20 KB, 51 events, an unknown key, `ageMs` of two hours | 413, 400, 400, 400 |
| The database is down | 503 (the readiness probe has failed already); the client drops the batch |
| `usage_rollup` fails | `job_run` records `failed`; the next run recomputes the last 3 days; the alert `JobStale` fires after the threshold of the job (DOC-40 §5.4). Raw rows are not purged past the newest rolled day, so no count is lost |
| `usage_rollup` does not run for 90 days | Raw rows older than 90 days stay (nothing was rolled); they are purged once a day has been rolled up |
| A restore | The tables come back with the rest; a day missing from `usage_daily` is recomputed from raw rows if they are still there |
| The request log | The request line of E-173 and E-174 is written like any line (DOC-40 §3.3: the request line is never dropped) and carries the account id of the request context; it says that an account sent a batch, not what was in it. The body is never logged (DOC-42 §8.4). Loki keeps it 14 days |

## 11. Metrics and logs

Defined in DOC-40 §4.7; this table is the reading copy.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `usage_events_total` | counter | `app` (`resident`, `staff`, `web`), `audience` (`resident`, `staff`), `event` (`screen_view`, `tap`, `app_open`, `app_close`), `name` (a screen or target id of §4, or `Launch`, `Resume`, `Background`; the lists are types, so the set is closed) | Events written |
| `usage_foreground_seconds` | histogram, buckets 10, 30, 60, 180, 600, 1800, 3600 | `app` (`resident`, `staff`, `web`), `audience` (`resident`, `staff`) | One observation of `durationSec` per `app_close` written: the time of one foreground stretch |
| `usage_events_dropped_total` | counter | `reason` (`unknown_name`, `disabled`, `demo`) | Events discarded after validation |

The labels hold no person (a name is a screen, a control or one of three lifecycle words). The module reports through `MetricsPort`; the names and label values are types in `@rms/shared-types` (DOC-12 §14). `usage_rollup` is a job, so `job_last_success_timestamp`, `job_runs_total` and `job_duration_seconds` cover it. There is no log line per batch.

## 12. Configuration

Defined in DOC-41 §13A.

| Key | Default | Meaning |
| --- | --- | --- |
| `USAGE_ENABLED` | `true` | `false` makes E-173 and E-174 discard every event (204, counted as `disabled`) and answer with `X-Usage-Enabled: false`, so the clients stop sending until their next launch (§5.4) |
| `USAGE_RAW_RETENTION_DAYS` | `90` | Age at which raw events are purged; 7 to 365 |
| `USAGE_DAILY_RETENTION_DAYS` | `730` | Age at which the rollup is purged; 90 to 3650 |

The two rate limits of §6.1 are keys too (DOC-41 §7, DOC-39 §6): `USAGE_EVENTS_PER_MINUTE_PER_IP` (30) and `USAGE_EVENTS_PER_HOUR_PER_SESSION` (120). The other limits (50 events and 16 KB per batch, 3 days of rollup, 30 minutes of session, a batch at the background, at 50 events or after 5 minutes, 100 queued events) are constants of the code, not keys.

## 13. Required tests

Prefix `UA-` (usage analytics; unused before this document; DOC-88 §15 indexes it). Written in P1-29; **none is run yet**, except the statements of §13.1.

| ID | Case | Expected |
| --- | --- | --- |
| UA-01 | A signed-in resident sends a batch of 3 valid events | 204; 3 rows; `building_id` of the token; `audience` `resident`; `occurred_at` is the fixed clock minus `ageMs`, to the second |
| UA-02 | Read `information_schema.columns` of `analytics` | No column whose name matches `account|member|unit|role|device|token|(^|_)ip$|user_agent|phone|email|name_` other than `name`; the column list equals DOC-17 §9A |
| UA-03 | A batch with one unknown screen name | 204; the other events are written; `usage_events_dropped_total{reason="unknown_name"}` rises by 1 |
| UA-04 | A name `Fees?unit=1`, `/fees`, `Fees.` | Dropped by the list; inserted directly, refused by `ck_usage_event_name` |
| UA-05 | An unknown key in the body, in an event | 400 `validation_failed` |
| UA-06 | 51 events; a body of 17 KB | 400; 413 `payload_too_large` |
| UA-07 | `ageMs` 3,600,001; `ageMs` 4,000 with the clock fixed | 400; `occurred_at` is 4 s before the receive time |
| UA-08 | No token on either route; a staff token on E-174; a resident token with a unit on E-173; a resident token on E-174; a staff token on E-173; a resident token with no `X-Unit-Id`; with the unit of another account | 401; 204 with `audience` `staff`; 204 with `audience` `resident`; 401 (a resident token does not pass the staff guard); 401 (the reverse); 400 `validation_failed`; 403 `membership_inactive` |
| UA-09 | A token of a demo building | 204; no row; `reason="demo"` |
| UA-10 | `USAGE_ENABLED=false` | 204 with `X-Usage-Enabled: false`; no row; `reason="disabled"`; with the key `true` the header is absent |
| UA-11 | The 31st request in a minute from one IP; the 121st in an hour for one `sessionId` | 429 `rate_limited`, `scope` `usage_events`, `Retry-After`; no bucket key holds an account id |
| UA-12 | Maintenance mode | 503 `maintenance` |
| UA-13 | A tap whose screen is unknown; a known screen with an unlisted control | Both dropped, `unknown_name` |
| UA-14 | A `screen_view` named `Login`, `OTP`, `Terms`, `Unit-Pick` | Dropped, `unknown_name` |
| UA-15 | The lists against the documents | `USAGE_SCREENS` ⊆ section ids of DOC-56; `USAGE_EXCLUDED_SCREENS` = the signed-out sections, `Terms*` and `Unit-Pick`; `USAGE_TARGETS` = the rows of §4.2.1 (those of §4.2.2 are not in it yet); every target's screen is in `USAGE_SCREENS` |
| UA-16 | The rollup of §7.1 on the fixture of §13.1 | Five rows; 7 events; the event at 23:30 local is in the earlier day |
| UA-17 | The rollup twice (run-twice) | The rows are identical |
| UA-18 | The purge of raw rows with an empty `usage_daily`; with a rolled day | Nothing is deleted; only rows before the end of the newest rolled day |
| UA-19 | The purge of `usage_daily` at 730 days | The older row goes, the newer stays |
| UA-20 | Two `usage_rollup` runs at once (barrier) | One runs, one is skipped by the lock; the rows are as for one run |
| UA-21 | Client: the switch off | No event queued, the queue cleared, no request |
| UA-22 | Client: the session id | The same for 29 minutes in the background, new after 31; absent from the device storage |
| UA-23 | Client: no answer (a network error); 429; 503 | After a network error the events stay queued and go with the next batch, those over 1 hour old are dropped, the queue holds at most 100; after 429 or 503 the batch is dropped; no retry loop; nothing thrown |
| UA-24 | Client: sign-out with 5 queued events, then another account signs in | The queue is empty; no event of the first account is sent with the second token |
| UA-25 | Client: the same screen twice in 1 s; a route with a parameter; a tap | One `screen_view`; the id has no parameter; the tap is not merged; no device id is read |
| UA-26 | Client: the switch after a restart | The stored choice; the default is on (`USAGE_DEFAULT_ENABLED`) |
| UA-27 | `apps/api/src/bootstrap/metrics.test.ts` (OB-01) | The registry equals the rows of DOC-40 §4 with the three metrics of §11 |
| UA-28 | The authorization matrix (EXP-10) | E-173 is allowed to a member of the unit named in the header, whatever the member type (Helper included), and refused to a staff token; E-174 is allowed to every staff role and refused to a resident token; both refuse a request with no token |
| UA-29 | The app configs | `PrivacyInfo.xcprivacy` of each app has the entry of §9.2; no `NSUserTrackingUsageDescription` in `Info.plist` |
| UA-30 | Client: the answer carries `X-Usage-Enabled: false` | The queue is cleared; no event is queued or sent until a new launch; the first batch of the new launch is sent |
| UA-31 | Client: batching | 30 events in 4 minutes make no request; the app going to the background makes one request holding all 30; the 50th queued event sends at once; 5 minutes after the first queued event sends; the web sends on `visibilitychange` to `hidden` with `keepalive` |
| UA-32 | A batch with `app_open` `Launch`, `app_close` `Background` with `durationSec` 61; then `app_close` with no `durationSec`; `durationSec` on a `tap`; `durationSec` 86,401; `app_open` named `Background`; `app_close` named `Launch` | The first is written, `duration_s` 61; the next three are 400 `validation_failed`; the last two are dropped, `unknown_name` |
| UA-33 | Rows inserted directly: `app_close` with no duration, `tap` with a duration, `app_close` with 86,401, `app_open` named `Background` or `Fees` | Each is refused by `ck_usage_event_duration` or `ck_usage_event_lifecycle` |
| UA-34 | The rollup of §7.1 over `app_close` rows of 120 s and 50 s, and over other events | `seconds` is 170 for the `app_close` group and 0 for every other; the same after a second run |
| UA-35 | Client: the lifecycle on a fake monotonic clock | `active` then `background` 61 s later queues `app_open` `Launch` and `app_close` 61; `inactive` queues nothing; a return after 31 minutes is `Resume` of a new session; the web `hidden` then `pagehide` queues one close; a stretch of 30 hours is 86,400; sign-out in a stretch queues no close; the switch off queues none; the wall clock is never read |
| UA-36 | Two `app_close` of 61 s and 5 s written | `usage_foreground_seconds` has count 2 and sum 66 for the labels of the batch; a dropped close adds nothing |

### 13.1 Statements run

**Run on 2026-10-28** on `postgres:18.6` (aarch64) in a scratch database that was dropped afterwards, with `psql`. Seven events and five sessions, zone `Asia/Ho_Chi_Minh`:

| Run | Result |
| --- | --- |
| The DDL of DOC-17 §9A (first version, without the lifecycle) | Applies; five bad rows (a tap with no control, a screen with a control, `Fees?unit=1`, version `1.0`, app `tv`) are each refused by their check; two good rows are accepted |
| The batch statement of §6.3, prepared | `INSERT 0 2`: `ageMs` 4,200 and 900 give `09:12:26` and `09:12:30` for a receive time of `09:12:30.987`; a batch with one bad name fails whole and leaves the table as it was (the application filters names before it writes, so it does not meet this) |
| The payment funnel of §8.2 on 4 sessions (3 viewed `Fees`, 2 pressed pay, 2 viewed `Pay-Select`, 1 pressed confirm, 1 viewed `Pay-Done`; a 4th session that only viewed `Pay-Done`) | `3, 2, 2, 1, 1`: the 4th session is not counted at the last step because the earlier steps are missing |
| The rollup statement of §7.1 | `INSERT 0 5`: 10-26 `Fees` 1 event; 10-27 `Fees` 3 events and 3 sessions (iOS), 1 (Android), 1 (staff); `Account.language` 1 |
| The same statement again | `INSERT 0 5`; five rows, 7 events, unchanged |
| The raw purge with a cut-off in 2027 | `DELETE 7`: the seven rolled events go; the event of the unrolled day 10-28 stays |
| The raw purge with `usage_daily` empty | `DELETE 0` |
| The rollup purge at 730 days | `DELETE 1`: the 2024-10-01 row goes, 2024-10-29 stays |
| Plans (`enable_seqscan = off`, the tables are tiny) | The window count is an index-only scan of `ix_usage_event_building_at`; the top-names query is a scan of `pk_usage_daily` |

**Run again on 2026-10-28** after the opening, closing and time of use were added (§3, §5.6), on a second scratch database, dropped afterwards. Fixture: three sessions, 16 events (an iOS resident with two stretches of 120 s and 50 s, an Android resident of 45 s, a staff user on the web of 600 s).

| Run | Result |
| --- | --- |
| The DDL with `duration_s`, `ck_usage_event_duration`, `ck_usage_event_lifecycle`, `usage_daily.seconds` and `ck_usage_daily_seconds` | Applies; five bad rows (`app_close` with no duration, a `tap` with a duration, a duration of 86,401, `app_open` named `Background`, `app_open` named `Fees`) are each refused |
| The batch statement of §6.3 with the array of durations, prepared | `INSERT 0 8`, `INSERT 0 4`, `INSERT 0 3`: `app_close` rows keep their seconds, every other row has `duration_s` null |
| The rollup statement of §7.1 with `seconds` | `INSERT 0 13`; `seconds` is 170 (iOS), 45 (Android) and 600 (web) on the `app_close` groups and 0 on the others; again: `INSERT 0 13`, 13 rows, 815 seconds, unchanged |
| The three readings of §8.2 (stretches by app, time per session, time on a screen) | Resident: 3 opens, 3 stretches, 72 s on average; web: 1 and 600 s. Sessions: 170 s in 2 opens, 45 s, 600 s. Screens: `Main` 24 s, `Fees` 29 s, `Notices` 29 s (checked by hand against the fixture: `Main` 19 s and 28 s, `Fees` 50 s and 8 s) |

**Not run:** the endpoint, the job, the tracker, the metrics and the dashboard (they are built in P1-29); the store declarations (they need the accounts, P6-10); counsel's reading (P0-06).

## 14. Decisions made while writing

All inside DR-279; the points that the DR leaves to this document:

1. `Terms` and `Terms-Update` are not recorded (§4.1): the person has not yet accepted the notice that describes the record.
2. `occurred_at` is cut to the second and comes from the receive time, never from the phone (§3).
3. The batch has no idempotency key; duplicates are accepted (principle 5).
4. The order of the checks puts the IP bucket before validation and the session bucket after it (§6.1), because the session id is only known after validation.
5. The batch write is not a `UnitOfWork` command with an outbox row (§6.3), with the reason.
6. The usage switch has no tap id (§2.1).
7. The job runs at 02:30 and recomputes three days (§7.1).
8. The server stops the apps by a response header, not by a field of `GET /public/config`: it needs no change of E-03 and takes effect at the next batch (§5.4).
9. A tap is the press that starts an action, never its outcome, and the web CMS is measured like the apps (§4.2).
10. Opening, closing and the time of use are two more events, `app_open` and `app_close` (Owner, 2026-10-28), with one new nullable column `duration_s` and one new column `seconds` in the rollup, not a new table (§3, §5.6). The time of use is a number the client measures on its monotonic clock, never a difference of two phone clocks. "Close" means "left the foreground", because the app is not told when the person swipes it away. The time on a screen is not stored; it is read from the gaps between events (§8.2).
11. The Owner confirmed on 2026-10-28 four points that P1-29 would otherwise check: (a) E-173 uses `unit: broadcast_notices` and is open to every member type; (b) the planned size of about 450 MB is accepted without a measurement first; (c) any grant the job or the route lacks is added to `0900-grants.sql` (DOC-19) and the statements of DOC-20 §5 are re-run as `rms_app`; (d) the rollup follows `JOBS_TIME_ZONE`, one building at a time.

## 15. Not in this document

Errors and crashes of the apps: DOC-42 §10, DOC-55 §15, DR-264. Business counters and alerts: DOC-40. The DDL: DOC-17 §9A. The endpoint's contract in the catalog form: DOC-51 E-173 and E-174. The purge statements: DOC-20 §5. The job's row: DOC-38 §4. The keys: DOC-41 §13A and §7. The copy of the switch: DOC-68. The store submission: DOC-73. A screen of the web CMS to read the record: not built.

## 16. Traceability

| Item | Where |
| --- | --- |
| DR-279 (1), (2) | §3, §4 |
| DR-279 (3) | §2, §2.1, DOC-17 §9A |
| DR-279 (4) | §6 |
| DR-279 (5) | §5.4 |
| DR-279 (6) | §7 |
| DR-279 (7) | §8 |
| DR-279 (8) | §6, ADR-0028 |
| DR-279 (9) | §2 (principle 5), §10 |
| DR-279 (10) | §9.2, §9.3 |
| DR-279 (11) | §9.4 |
| NFR-14 (personal data) | §2.1, §9 |
| ADR-0022 (cross-border list unchanged) | §2 (principle 6) |
| Tests | §13 |

## Open questions

None. (Whether the record counts as personal data is counsel's reading, scheduled in DOC-103; the design holds under either answer, §9.4.)
