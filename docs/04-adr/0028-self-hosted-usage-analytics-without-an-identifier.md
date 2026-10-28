# ADR-0028: Record screen views and taps as allowlisted events without an account or device identifier, in an `analytics` schema on the same PostgreSQL, and read them through a counter

- Status: Accepted
- Date: 2026-10-28 · Related: DR-279, DR-103, DR-58, DR-264, DR-64, NFR-14, ADR-0014, ADR-0021, ADR-0022

## Context

The Owner wants to know which screens residents and staff open and which controls they press. Today nothing answers that: EAS Observe (DR-264) records startup time, route timing and errors of the two apps; the web CMS reports errors only; the metrics of DOC-40 count operations. ADR-0022 sends nothing to a third-party tracker and lists the few processors outside Vietnam (Expo, FCM, APNs, Cloudflare in transit). The apps go to the App Store and Google Play, so what they record must be declared there (Apple App Privacy and the privacy manifest; the Google Play Data safety form), and Decree 13/2023/NĐ-CP applies to data about a person. About 650 residents and 10 staff use the system, in one building (DOC-01), so any record that carries an account id is, in practice, a record of a named person's habits.

## Options considered

1. **A hosted product-analytics SDK** (PostHog, Firebase Analytics, Mixpanel). Funnels and heatmaps come ready. Rejected: a new processor outside Vietnam that ADR-0022 does not list, an identifier of its own on every phone, and a bundle that grows for a feature the Owner uses once a week.
2. **Events tied to the account** (who pressed what). The most useful data and the heaviest to carry: the Apple label becomes "linked to you", the privacy notice must explain a profile of each resident, and a screen of names and amounts is one step from session replay. Rejected.
3. **Counting at ingest only** (`INSERT … ON CONFLICT DO UPDATE SET n = n + 1`, no raw row). The least data. Rejected: it loses the session, which separates one resident who pressed a button 50 times from 50 residents who pressed it once, and it cannot be recomputed if a name is later grouped differently.
4. **Raw events without any identifier, a daily rollup, and a counter for a live view.** Chosen.

## Decision

Option **4** (DR-279).

- **Two events from closed lists.** `screen_view` (a section id of DOC-56) and `tap` (a target id `<Screen>.<control>` of DOC-104 §4.2). The lists are typed constants in `@rms/shared-types`; the server drops any other name and counts the drop. Nothing else is recorded: no text, no form value, no screen recording.
- **No person.** A row holds the building from the token, the app, the platform, the app version, the audience (`resident` or `staff`, from the token kind), a random session id, the event, the name and a time. No account, membership, unit, role, device id, push token, IP address or user agent is stored. The session id lives in memory in the client, is renewed after 30 minutes in the background and is never joined to an account.
- **One module, `analytics`,** with its own schema (ADR-0014) and two tables: `usage_event` (raw, 90 days) and `usage_daily` (the rollup, 730 days). It is a leaf: no module calls it, and it calls no module. A job `usage_rollup` folds and purges.
- **Two routes, one use case: E-173 `POST /me/usage-events`** (a resident acting for a unit, any member type) **and E-174 `POST /staff/usage-events`** (any staff role), because a resident token never passes a staff guard (DOC-12 §5.3). The batch is at most 50 events and 16 KB, answered 204, limited by two PostgreSQL buckets (DR-64) that hold an IP and a session id, never an account.
- **Reading.** The counter `usage_events_total{app,audience,event,name}` feeds a Grafana dashboard; history is SQL on `usage_daily` with `rms_readonly`. There is no screen in the web CMS.
- **Opt-out in the client,** on by default, kept on the device. The privacy notice states the recording. The store declarations say: not linked to the user, not used for tracking, not shared, users can choose.
- **Adding a field that identifies a person, or a processor, needs a new DR and a new ADR** that supersedes this one.

## Consequences

**Positive**

- Nothing leaves the VPS and the data stays in Vietnam with the rest (ADR-0027); ADR-0022's cross-border list does not change.
- The store declarations are the lightest kind (no tracking prompt, no "linked to you").
- A leak of the table says that someone opened the fees screen at 09:12, not who.
- The Owner reads the top screens in Grafana without a new screen to build and test.

**Negative**

- No funnel per person and no "this resident never opens the app": the design cannot answer them, and a request for them is a new decision.
- Counts are approximate: a batch lost to the network is dropped, a batch repeated by a proxy is counted twice.
- The audience is coarse (resident or staff). The usage of the Guard against the Manager is read from the screens, which only one of them has.
- In a building with one Admin, a screen only the Admin opens is, in effect, the Admin's; the audience stays `staff` and the dashboard shows counts, not times, but the reader can still guess. The privacy notice says "anonymous", and counsel is asked about it (DOC-103).
- Prometheus keeps the counter only as long as its retention; the table is the long memory and is read with SQL.
- One more module, one more job and one more migration folder.

**Follow-up work**

- DOC-104 holds the design; DOC-17 §9A the DDL; DOC-20 the retention and the statements; DOC-38 the job; DOC-40 the metrics and the dashboard; DOC-41 the keys; DOC-51 E-173 and E-174; DOC-55 the client tracker; DOC-35 and DOC-73 the notice and the store declarations.
- Task P1-29 builds it; tests `UA-`.
- The legal dossier (P0-06) answers whether the recording needs consent first; DOC-103 carries the item.
