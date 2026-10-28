# Usage analytics

> Status: **Review** · Updated: 2026-10-28 (DR-279) · DOC-104
> Depends on: [DR](../00-decision-register.md) (DR-279, DR-103, DR-58, DR-64, DR-264, DR-265), [ADR-0028](../04-adr/0028-self-hosted-usage-analytics-without-an-identifier.md), [ADR-0022](../04-adr/0022-personal-data-protection.md), [ADR-0014](../04-adr/0014-schema-per-module-no-cross-module-foreign-keys.md), [ADR-0013](../04-adr/0013-time-zones-and-calendar-day-semantics.md), [DOC-06](../02-glossary.md), [DOC-17](../05-data/operations-model.md) §9A, [DOC-20](../05-data/data-lifecycle.md) §2.5 and §5, [DOC-35](audit-privacy-and-terms.md) §7 to §9, [DOC-38](jobs-and-outbox-runtime.md) §4, [DOC-40](observability.md) §4.7, [DOC-41](configuration-reference.md) §13A, [DOC-42](error-handling.md) §10, [DOC-51](../07-api/api-endpoints.md) E-173, [DOC-55](../08-ux-ui/client-architecture.md) §15A, [DOC-56](../08-ux-ui/screens/README.md), [DOC-73](../09-operations/mobile-release.md) §9
> Main readers: P1-29 (the build), P6-10 (the store declarations), DOC-103 (go-live), every task that adds a screen or a control

This document says what the system records about how the apps are used, what it never records, how a client sends it, how it is stored, rolled up and read, and what the stores and the privacy notice must say about it. The tables are in DOC-17 §9A, the endpoint contract is E-173 in DOC-51, the keys are in DOC-41 §13A, the metrics in DOC-40. It does not cover errors and crashes (DOC-42 §10, DOC-55 §15) or the counters of business operations (DOC-40).

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
| IP address, user agent | Personal data (DOC-35 §7.1) | The batch handler does not read them; the rate bucket uses the IP and keeps no row for it after the idle purge |
| Text typed, form values, search terms, amounts, names | They are personal or financial | No field for them in the body (§6.2) |
| A URL, a path, a route parameter, a query string | A path carries ids (`/fees/<batch>`) | The grammar of a name (§4.3); the check `ck_usage_event_name` |
| A screenshot, a screen recording, a tap position | Session replay shows names and amounts; Apple wants disclosure and consent for it | Not in the event schema |
| The state of the usage switch of another person, or the tap on the switch | The switch must not be a signal | There is no target id for it (§4.2) |
| Location, contacts, anything from a sensor | Not needed | The clients ask for no permission for it |

## 3. Events

Two events exist (DR-279 (1)). Another needs a new DR.

| Event | Means | `name` | Sent when |
| --- | --- | --- | --- |
| `screen_view` | A screen was shown to a signed-in user | A screen id of §4.1 | The screen gains focus; once per focus (§5.5) |
| `tap` | A control of §4.2 was pressed | A target id `<Screen>.<control>` | The press handler of the control runs, after the action has been started (the tap never delays it) |

Every event also carries `ageMs`: the milliseconds between the event and the moment the batch is sent, 0 to 3,600,000. The server stores `occurred_at = received_at - ageMs`, cut to the second. The client's own clock is never used, so a phone with a wrong time cannot put events in the wrong day.

## 4. The catalog

### 4.1 Screens

A `screen_view` name is the **section id of a screen in DOC-56** (`Main`, `Fees`, `S-Account`, `W-Residents`…).

- The constant `USAGE_SCREENS` in `@rms/shared-types` lists the ids of the screens that the apps have when the code is written; a screen is added with the task that builds it. Every id in it must be a section id of DOC-56 (UA-15).
- **Not recorded:** a screen shown without a session, and the consent screens. The rule: every section of DOC-56 whose *Role or member type* says "signed out" (`Login`, `Login-Error`, `OTP`, `S-Login`, `S-Login-Error`, `W-Login`, `W-Forgot-Sent`, `W-Reset`…), and `Terms` and `Terms-Update` (the person has not yet accepted the privacy notice that describes this record). The constant `USAGE_EXCLUDED_SCREENS` lists them and a test checks it against DOC-56 (UA-15).
- A screen with several states (`Fees` and `Fees-NoPay`) is several ids; the client reports the id of the state shown, as DOC-56 lists it.
- A modal or a sheet is not a screen unless DOC-56 gives it a section id.

### 4.2 Controls

A `tap` name is `<Screen>.<control>`, where `<Screen>` is a section id of §4.1 and `<control>` is a lower-case word with underscores.

| Target | Screen | Control | Added in |
| --- | --- | --- | --- |
| `Account.language` | `Account` | The language row | P1-29 |
| `Account.push` | `Account` | The push row | P1-29 |
| `W-Profile.language` | `W-Profile` | The language field | P1-29 |
| `W-Profile.reset_link` | `W-Profile` | The "send me a reset link" button | P1-29 |

There is no target for the usage switch (§2.1). The controls that later phases will add are named with their screens, in the same change, one row each. Examples, not yet added: `Fees.open_batch` (P2), `Pay-Select.confirm` (P3), `Request-New.submit` (P4).

### 4.3 Adding a control

1. Add a row to §4.2 in the change that adds the control. A control with no row is not tracked.
2. Add the id to `USAGE_TARGETS` in `@rms/shared-types`; the test UA-15 fails when the constant and §4.2 differ.
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

All three return at once, never throw and never await the network.

### 5.2 The session

- `sessionId` is a UUID v4 made at launch (the web: at page load) with the platform's secure random source.
- It is renewed when the app comes back from the background after **more than 30 minutes**, and when the person signs out and another signs in.
- It is kept **in memory only**: not in the device storage, not in a cookie, not in a log line. Two launches of one phone cannot be joined (UA-22).

### 5.3 The queue and the batch

| Rule | Value |
| --- | --- |
| Queue | In memory, at most 100 events; the oldest is dropped beyond that |
| A batch is sent when | 20 events are queued, or 30 seconds have passed since the first queued event, or the app goes to the background |
| Size | At most 50 events and 16 KB per request (the server's limit, §6.2) |
| In flight | One request at a time |
| On any failure | The batch is **dropped**: a network error, 401, 413, 429, 503, anything else. No retry, no log to the person |
| Sent with | The token of the signed-in account (DOC-55 §5), like any call; the call goes through the fetcher without the idempotency header and without the retry of reads |
| On sign-out | The queue is cleared before the token is dropped, so events of one account are never sent with the token of the next |
| Persistence | None. A killed app loses its queue |

### 5.4 The switch

- **Copy.** Title `usage.switch.title`: vi "Chia sẻ dữ liệu sử dụng ẩn danh", en "Share anonymous usage data". Hint `usage.switch.hint`: vi "Giúp ban quản lý biết màn hình nào được dùng nhiều để cải thiện ứng dụng. Không gắn với tài khoản hay số điện thoại của bạn.", en "Helps the management see which screens are used so it can improve the app. It is not tied to your account or phone number." (DOC-68.)
- **Where.** `Account` (resident app, DOC-60), `S-Account` (staff app, DOC-61), `W-Profile` (web CMS, DOC-64).
- **Default.** On (DR-279 (5)). The default is the constant `USAGE_DEFAULT_ENABLED` in `@rms/client-core`; counsel's answer (DR-279 (11)) may turn it off.
- **Stored** on the device (mobile: the device storage of `@rms/mobile-core`, key `usage.enabled`; web: `localStorage`, key `rms.usage.enabled`, read in a `try/catch`), not on the server and not per account. Another account that signs in on the same device inherits the choice.
- **Off** means: nothing is queued, the queue is cleared at once, no request is made. Turning it on again starts a new session.
- The server has a kill switch of its own, `USAGE_ENABLED` (§12).

### 5.5 Noise

A `screen_view` for the same id within one second of the previous one is merged (a re-render must not count twice). A `tap` is never merged: ten presses are ten events.

## 6. The server

The module is `analytics` (`modules/analytics`, ADR-0028), a leaf: no module calls it and it calls none. Layout as DOC-12 §4: one command `application/use-cases/record-usage-events.ts` (one class, one `execute`), one handler file, one route file. It runs in `api` and, for the job, in `worker`.

### 6.1 Route and order of checks

`POST /api/v1/usage-events` (E-173, DOC-51). The audience is any signed-in account, staff or resident, with no role condition; the route metadata lists both kinds (UA-28). In order:

1. Body at most 16 KB, else 413 `payload_too_large`.
2. Maintenance mode, else 503 `maintenance`.
3. The token and the app-version gate (DOC-50 §7), as for any route; no token is 401.
4. The IP bucket `usage_events:ip:<ip>`: 30 requests a minute, else 429 `rate_limited`, `scope: "usage_events"` (DOC-42 §10).
5. Validation of the body (§6.2), else 400 `validation_failed`.
6. The session bucket `usage_events:session:<sessionId>`: 120 requests an hour, else 429.
7. If the building of the token is a demo building (`isDemo`), or `USAGE_ENABLED` is false: the events are counted as dropped (`demo`, `disabled`) and discarded, answer 204.
8. Each event whose name is not in the lists is dropped and counted (`unknown_name`); the rest are written.
9. One statement writes the batch; the counter `usage_events_total` rises by the written events; answer 204.

The building is the one of the token (`BuildingScope`, DR-12), never read from the body.

### 6.2 The body

```http
POST /api/v1/usage-events
Authorization: Bearer <access token>
Content-Type: application/json

{ "app": "resident", "appVersion": "1.0.3", "platform": "ios",
  "sessionId": "0192f3c4-9d02-4000-8000-00000000a001",
  "events": [
    { "event": "screen_view", "name": "Fees", "ageMs": 4200 },
    { "event": "tap", "name": "Account.language", "ageMs": 900 }
  ] }
```

| Field | Rule |
| --- | --- |
| `app` | `resident`, `staff`, `web` |
| `appVersion` | `x.y.z`, digits only, as `ck_usage_event_version` |
| `platform` | `ios`, `android`, `web` |
| `sessionId` | A UUID, version 4 |
| `events` | 1 to 50 items; an unknown key anywhere is 400 |
| `events[].event` | `screen_view`, `tap` |
| `events[].name` | A string of at most 60 characters; checked against the lists after validation |
| `events[].ageMs` | An integer from 0 to 3,600,000 |

`audience` is not in the body: it is `resident` for a resident token and `staff` for a staff token. `app` is a label the client states; it is not checked against the token (a wrong label spoils a count, not a decision).

### 6.3 The write

One statement, no transaction around it, no outbox event, no audit row: the batch changes no business state, it is not an act of a person (DOC-35 §3.3 audits actions), and a lost batch costs one count. This is the one write path of the system that is not a `UnitOfWork` command with an outbox row, on purpose (DOC-12 §8.3).

```sql
INSERT INTO analytics.usage_event (id, building_id, occurred_at, app, platform, app_version, audience, session_id, event, name)
SELECT e.id, $1, date_trunc('second', $2::timestamptz - e.age_ms * interval '1 millisecond'),
       $3, $4, $5, $6, $7, e.event, e.name
FROM unnest($8::uuid[], $9::text[], $10::text[], $11::int[]) AS e(id, event, name, age_ms);
```

Parameters: `$1` the building of the token; `$2` the receive time from the `Clock` port; `$3…$7` app, platform, version, audience and session; `$8…$11` the arrays of the events that passed the lists (ids are UUIDv7 made by the application, DOC-14 §3). The statement was run in §13.1 with a prepared form of it.

## 7. Storage, rollup and retention

Tables: DOC-17 §9A. Periods: `USAGE_RAW_RETENTION_DAYS` = 90, `USAGE_DAILY_RETENTION_DAYS` = 730 (DOC-41 §13A).

### 7.1 The job `usage_rollup`

Daily at 02:30 in `JOBS_TIME_ZONE`, mode `lock`, grace 12 hours, a row every run (DOC-38 §3.3, §4.1). It works for the building of the deployment (one deployment is one building, DR-12; the demo building writes no rows, §6.1 step 7):

1. **Roll up** the last 3 complete local days, `[today - 3, today)`, with the statement below. It recomputes each day from the raw rows, so it is idempotent and a day missed by a failed run is made up by the next one.
2. **Purge raw rows** older than `USAGE_RAW_RETENTION_DAYS`, but only before the end of the newest rolled-up day (DOC-20 §5).
3. **Purge the rollup** older than `USAGE_DAILY_RETENTION_DAYS` (DOC-20 §5).

The result in `job_run.details` is `{"rolled": n, "purgedRaw": n, "purgedDaily": n}`.

```sql
INSERT INTO analytics.usage_daily (building_id, day, app, platform, audience, event, name, events, sessions)
SELECT e.building_id, (e.occurred_at AT TIME ZONE $2)::date, e.app, e.platform, e.audience, e.event, e.name,
       count(*), count(DISTINCT e.session_id)
FROM analytics.usage_event e
WHERE e.building_id = $1
  AND e.occurred_at >= ($3::timestamp AT TIME ZONE $2)      -- $3, $4: local dates [today - 3, today)
  AND e.occurred_at <  ($4::timestamp AT TIME ZONE $2)
GROUP BY 1, 2, 3, 4, 5, 6, 7
ON CONFLICT (building_id, day, app, platform, audience, event, name)
DO UPDATE SET events = EXCLUDED.events, sessions = EXCLUDED.sessions;
```

Example (§13.1, run): building zone `Asia/Ho_Chi_Minh`, seven events of five sessions between 2026-10-26 23:30 and 2026-10-27 12:10 local. The day of an event is its **local** day: the event at 16:30 UTC on 10-26 (23:30 local) is in 10-26, the one at 17:30 UTC (00:30 local) is in 10-27. The result is five rows for the groups of the example; the sums are 7 events; running the statement again leaves the same five rows.

### 7.2 Size (planned)

About 650 accounts at about 30 events a day is 20,000 rows a day, 1.8 million rows at 90 days, about 100 bytes a row and as much again in the index: **about 400 MB planned**, not measured. The rollup is at most a few hundred rows a day. Both are inside the nightly backup and restore with the rest of the database; the restore brings the rows back (DOC-20 §4).

## 8. Reading it

| Need | Way |
| --- | --- |
| "What is used most this week?" | The Grafana dashboard **Usage** (§8.1), at `monitor.<domain>` behind Cloudflare Access (DOC-40 §7) |
| "What was used most last quarter?" | SQL on `analytics.usage_daily` with `rms_readonly` (§8.2); Prometheus keeps 15 days (DOC-40 §2), the table keeps 730 |
| A screen of the web CMS | **Not built.** A new requirement and a new DR (DR-279 (7)) |
| Who did it | Cannot be answered, by design |

### 8.1 The dashboard `Usage`

Provisioned from `ops/grafana/dashboards/` like the others (generated by `scripts/build-dashboards.ts`, `bun run ops:dashboards`). It supports no alert; it is the one dashboard that exists for a decision of the Owner (DR-279).

| Panel | Query |
| --- | --- |
| Top 10 screens, 7 days | `topk(10, sum by (name) (increase(usage_events_total{event="screen_view"}[7d])))` |
| Top 10 controls, 7 days | `topk(10, sum by (name) (increase(usage_events_total{event="tap"}[7d])))` |
| Events per hour by app | `sum by (app) (increase(usage_events_total[1h]))` |
| Residents against staff | `sum by (audience) (increase(usage_events_total[7d]))` |
| Dropped events by reason | `sum by (reason) (increase(usage_events_dropped_total[1d]))` |

`increase` survives a restart of the API (the counter resets and Prometheus corrects for it). A screen no one opened has no series; the panel shows what exists.

### 8.2 SQL for longer periods

```sql
-- the 20 most opened screens of the last 30 days
SELECT name, sum(events) AS events, sum(sessions) AS sessions   -- sessions: an upper bound (§9A.2 of DOC-17)
FROM analytics.usage_daily
WHERE building_id = $1 AND event = 'screen_view' AND day >= current_date - 30
GROUP BY name ORDER BY events DESC LIMIT 20;
```

## 9. Privacy, the notice and the stores

### 9.1 The privacy notice

DOC-35 §9.4 gains one row: the notice must say that the apps record which screens are opened and which listed controls are pressed, without the account, phone, device or location; that the record is kept 90 days and then only as daily counts for 730 days; that it stays on the building's server; that the person can turn it off in `Account`, `S-Account` or `W-Profile`; and the contact of the Manager. The text is the client's legal deliverable (P0-06); a new `privacy` version is published before the first build that sends events reaches a resident (DOC-35 §9.1, DOC-103).

### 9.2 Apple

Checked 2026-10-28.

- **App Privacy ("nutrition label"):** *Usage Data → Product Interaction*; purpose *Analytics*; **not linked to the user**; **not used for tracking**.
- **Tracking.** Apple defines tracking as linking data from the app with data from other companies' apps, websites or offline properties for targeted advertising or advertising measurement, or sharing it with data brokers (<https://developer.apple.com/app-store/user-privacy-and-data-use/>). Nothing here does either, so there is **no App Tracking Transparency prompt** and no `NSUserTrackingUsageDescription`. Apple also bars fingerprinting: the client derives nothing from the device to identify it (§2.1).
- **Privacy manifest.** Each app's `ios.privacyManifests` (the app config) gets `NSPrivacyCollectedDataTypes` with one entry: `NSPrivacyCollectedDataTypeProductInteraction`, `NSPrivacyCollectedDataTypeLinked` false, `NSPrivacyCollectedDataTypeTracking` false, `NSPrivacyCollectedDataTypePurposes` `[NSPrivacyCollectedDataTypePurposeAnalytics]`; `NSPrivacyTracking` false. Expo's guide documents `ios.privacyManifests` with the key `NSPrivacyAccessedAPITypes` (<https://docs.expo.dev/guides/apple-privacy/>) and does not show `NSPrivacyCollectedDataTypes`; **P1-29 checks that key against Apple's privacy manifest documentation and a generated `PrivacyInfo.xcprivacy`** (UA-29).
- The label must match the manifest and the privacy notice. EAS Observe's own collection (errors, performance) is declared in the same places (DOC-73 §9).

### 9.3 Google Play

Checked 2026-10-28 (<https://support.google.com/googleplay/android-developer/answer/10787469>).

- **Data safety form:** *App activity → App interactions* ("information about how a user interacts with the app", for example sections tapped); **collected**; **not shared** (the form defines sharing as going to a third party; collection by the app's own publisher is not sharing); purpose *Analytics*; **users can choose whether this data is collected**. The last answer is allowed only if every user, in every region, can opt out: the switch exists in both apps for that reason.
- Not encrypted in transit is not an option: all calls are HTTPS.
- Data deletion: the form asks whether users can ask for deletion. The record holds nothing that belongs to a person, so there is nothing to delete by request; the answer follows DOC-35 §10 for the data that is personal.

### 9.4 Vietnamese law

Decree 13/2023/NĐ-CP and the personal data law that followed it apply to data about an identified or identifiable person. The design treats the record as **not personal data** because no row carries an identifier of a person (§2), and it gives notice and an opt-out anyway. That is a reading of the law, not advice: **DOC-103 asks counsel to confirm it with the legal dossier (P0-06)**. If counsel wants consent first, `USAGE_DEFAULT_ENABLED` becomes false and the notice and the switch copy change; the server, the tables and the stores' answers do not.

### 9.5 What would change the answers

Adding an account id or a device id to a row, sending a row to a third party, recording a tap position, a typed text or a screen: each makes the Apple label "linked to you" or the stores' answers different, and needs a new DR and a new ADR that supersedes ADR-0028.

## 10. Abuse and faults

| Case | What happens |
| --- | --- |
| One client floods | The IP bucket (30 a minute) and the session bucket (120 an hour) answer 429; the client drops and goes on |
| A modified client sends forged events | It can only name listed screens and controls and it counts as one session id per batch it makes up; it can raise a count. Nothing business reads the counts (principle 4) |
| A modified client sends a name outside the lists | Dropped and counted (`unknown_name`); a path or a query string is also refused by the check of the table |
| An old app sends a name that a newer API no longer lists | Dropped and counted; no error |
| A body of 20 KB, 51 events, an unknown key, `ageMs` of two hours | 413, 400, 400, 400 |
| The database is down | 503 (the readiness probe has failed already); the client drops the batch |
| `usage_rollup` fails | `job_run` records `failed`; the next run recomputes the last 3 days; the alert `JobStale` fires after the threshold of the job (DOC-40 §5.4). Raw rows are not purged past the newest rolled day, so no count is lost |
| `usage_rollup` does not run for 90 days | Raw rows older than 90 days stay (nothing was rolled); they are purged once a day has been rolled up |
| A restore | The tables come back with the rest; a day missing from `usage_daily` is recomputed from raw rows if they are still there |
| The request log | The request line of E-173 is written like any line (DOC-40 §3.3: the request line is never dropped) and carries the account id of the request context; it says that an account sent a batch, not what was in it. The body is never logged (DOC-42 §8.4). Loki keeps it 14 days |

## 11. Metrics and logs

Defined in DOC-40 §4.7; this table is the reading copy.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `usage_events_total` | counter | `app` (`resident`, `staff`, `web`), `audience` (`resident`, `staff`), `event` (`screen_view`, `tap`), `name` (a screen or target id of §4; the lists are types, so the set is closed) | Events written |
| `usage_events_dropped_total` | counter | `reason` (`unknown_name`, `disabled`, `demo`) | Events discarded after validation |

The labels hold no person (a name is a screen or a control). The module reports through `MetricsPort`; the names and label values are types in `@rms/shared-types` (DOC-12 §14). `usage_rollup` is a job, so `job_last_success_timestamp`, `job_runs_total` and `job_duration_seconds` cover it. There is no log line per batch.

## 12. Configuration

Defined in DOC-41 §13A.

| Key | Default | Meaning |
| --- | --- | --- |
| `USAGE_ENABLED` | `true` | `false` makes E-173 discard every event (204) and count it as `disabled`; the clients keep sending and nothing is stored |
| `USAGE_RAW_RETENTION_DAYS` | `90` | Age at which raw events are purged; 7 to 365 |
| `USAGE_DAILY_RETENTION_DAYS` | `730` | Age at which the rollup is purged; 90 to 3650 |

The limits of §6.1 (50 events, 16 KB, 30 a minute, 120 an hour, 3 days of rollup, 30 minutes of session, 20 events or 30 seconds per batch) are constants of the code, not keys.

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
| UA-08 | No token; a staff token; a resident token | 401; 204 with `audience` `staff`; 204 with `audience` `resident` |
| UA-09 | A token of a demo building | 204; no row; `reason="demo"` |
| UA-10 | `USAGE_ENABLED=false` | 204; no row; `reason="disabled"` |
| UA-11 | The 31st request in a minute from one IP; the 121st in an hour for one `sessionId` | 429 `rate_limited`, `scope` `usage_events`, `Retry-After`; no bucket key holds an account id |
| UA-12 | Maintenance mode | 503 `maintenance` |
| UA-13 | A tap whose screen is unknown; a known screen with an unlisted control | Both dropped, `unknown_name` |
| UA-14 | A `screen_view` named `Login`, `OTP`, `Terms` | Dropped, `unknown_name` |
| UA-15 | The lists against the documents | `USAGE_SCREENS` ⊆ section ids of DOC-56; `USAGE_EXCLUDED_SCREENS` = the signed-out sections and `Terms*`; `USAGE_TARGETS` = the rows of §4.2 |
| UA-16 | The rollup of §7.1 on the fixture of §13.1 | Five rows; 7 events; the event at 23:30 local is in the earlier day |
| UA-17 | The rollup twice (run-twice) | The rows are identical |
| UA-18 | The purge of raw rows with an empty `usage_daily`; with a rolled day | Nothing is deleted; only rows before the end of the newest rolled day |
| UA-19 | The purge of `usage_daily` at 730 days | The older row goes, the newer stays |
| UA-20 | Two `usage_rollup` runs at once (barrier) | One runs, one is skipped by the lock; the rows are as for one run |
| UA-21 | Client: the switch off | No event queued, the queue cleared, no request |
| UA-22 | Client: the session id | The same for 29 minutes in the background, new after 31; absent from the device storage |
| UA-23 | Client: a network error, 429, 503 | The batch is dropped, no retry, nothing thrown |
| UA-24 | Client: sign-out with 5 queued events, then another account signs in | The queue is empty; no event of the first account is sent with the second token |
| UA-25 | Client: the same screen twice in 1 s; a route with a parameter; a tap | One `screen_view`; the id has no parameter; the tap is not merged; no device id is read |
| UA-26 | Client: the switch after a restart | The stored choice; the default is on (`USAGE_DEFAULT_ENABLED`) |
| UA-27 | `apps/api/src/bootstrap/metrics.test.ts` (OB-01) | The registry equals the rows of DOC-40 §4 with the two metrics of §11 |
| UA-28 | The authorization matrix (EXP-10) | E-173 is allowed to both kinds, to every role, and to nobody without a token |
| UA-29 | The app configs | `PrivacyInfo.xcprivacy` of each app has the entry of §9.2; no `NSUserTrackingUsageDescription` in `Info.plist` |

### 13.1 Statements run

**Run on 2026-10-28** on `postgres:18.6` (aarch64) in a scratch database that was dropped afterwards, with `psql`. Seven events and five sessions, zone `Asia/Ho_Chi_Minh`:

| Run | Result |
| --- | --- |
| The DDL of DOC-17 §9A | Applies; five bad rows (a tap with no control, a screen with a control, `Fees?unit=1`, version `1.0`, app `tv`) are each refused by their check; two good rows are accepted |
| The batch statement of §6.3, prepared | `INSERT 0 2`: `ageMs` 4,200 and 900 give `09:12:26` and `09:12:30` for a receive time of `09:12:30.987`; a batch with one bad name fails whole and leaves the table as it was (the application filters names before it writes, so it does not meet this) |
| The rollup statement of §7.1 | `INSERT 0 5`: 10-26 `Fees` 1 event; 10-27 `Fees` 3 events and 3 sessions (iOS), 1 (Android), 1 (staff); `Account.language` 1 |
| The same statement again | `INSERT 0 5`; five rows, 7 events, unchanged |
| The raw purge with a cut-off in 2027 | `DELETE 7`: the seven rolled events go; the event of the unrolled day 10-28 stays |
| The raw purge with `usage_daily` empty | `DELETE 0` |
| The rollup purge at 730 days | `DELETE 1`: the 2024-10-01 row goes, 2024-10-29 stays |
| Plans (`enable_seqscan = off`, the tables are tiny) | The window count is an index-only scan of `ix_usage_event_building_at`; the top-names query is a scan of `pk_usage_daily` |

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

## 15. Not in this document

Errors and crashes of the apps: DOC-42 §10, DOC-55 §15, DR-264. Business counters and alerts: DOC-40. The DDL: DOC-17 §9A. The endpoint's contract in the catalog form: DOC-51 E-173. The purge statements: DOC-20 §5. The job's row: DOC-38 §4. The keys: DOC-41 §13. The copy of the switch: DOC-68. The store submission: DOC-73. A screen of the web CMS to read the record: not built.

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
