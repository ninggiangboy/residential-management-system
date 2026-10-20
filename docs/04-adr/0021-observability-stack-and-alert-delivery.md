# ADR-0021: Observe each host with Prometheus, Alertmanager, Grafana and Loki, without traces, and send alerts by email and Telegram

- Status: Accepted
- Date: 2026-10-19 · Related: DR-63, DR-88, DR-06, DR-83, DR-101, NFR-09, NFR-10, NFR-11, EXP-11, EXP-12

## Context

Original SDD §19.2 says metrics are "scraped by the host's monitoring", traces go over OTLP and alerts have conditions, but it names no backend, no alert channel, no metric list and no way to watch the nightly invariant check or the backup. One person operates the system, so an alert that cannot reach them is the same as no alert. The monitoring stack must also fit on the same host as the API, the worker and PostgreSQL (DR-06, DR-83), and personal data must not leak to a third-party service (Decree 13, DR-58).

## Options considered

1. **A hosted monitoring service.** Nothing to run — but logs can hold personal data and DR-63 adds no third-party processor in phase 1; the stack runs on the VPS.
2. **Prometheus, Alertmanager, Grafana, Loki and Jaeger with OTLP traces, logs collected by Promtail** (the first proposal of DR-63). Complete — but the Owner removed Jaeger and the trace export on 2026-10-19: a request id on every log line is enough to follow one request. Promtail reached end of life on 2026-03-02 and Grafana Alloy replaces it.
3. **A third-party error tracker such as Sentry.** Good stack traces — but personal data would leave the system in phase 1. The apps log through the API's client-error endpoint; a Sentry-compatible DSN stays configurable and off.
4. **Alerts only on a dashboard.** No channel to configure — but nobody watches a dashboard at 03:00 when the nightly check runs.
5. **Prometheus, Alertmanager, Grafana and Loki on each host, logs collected by Grafana Alloy, an external uptime probe, alerts by email and Telegram.**

## Decision

Option **5** is chosen (DR-63). The metric catalog, dashboards and PromQL rules belong to DOC-40; the pins to [DOC-11](../03-architecture/tech-stack-and-versions.md) §7; the budgets to [DOC-10](../03-architecture/quality-attributes.md) §6.

- **Stack on each host.** Prometheus, Alertmanager and Grafana (about 600 MB, inside the 1 GB monitoring ceiling of DR-06), Loki with 14-day retention, and **Grafana Alloy** to collect logs. Staging has its own copy.
- **Metrics.** Exposed on the internal ops port that neither Caddy nor the Tunnel routes ([DOC-07](../03-architecture/system-context-and-containers.md) §3). Families (DR-63): HTTP latency by route and status; outbox (oldest unpublished age, dead letters); jobs (last success per job; DR-101 makes it a timestamp gauge); finance (pending intents overdue, intents stuck in `creating`, `money_log_open`, `ledger_invariant_violations`, webhook rejections, payOS requests by outcome); notifications (push failures, SMS failure ratio); storage usage; backup age from a textfile written by the backup script; PostgreSQL basics. Gauges that come from the database run cheap indexed queries every 15 s.
- **Logs.** Structured, with `X-Request-Id` on every line; this is the whole of request tracing in phase 1. **No traces and no Jaeger.**
- **Alerts.** The alert table of original SDD §19.2 becomes PromQL rules in DOC-40, each linked to one runbook RB-01…09. Delivery is email plus a Telegram bot to the Owner and the Admin; `Critical` repeats every 30 minutes until acknowledged.
- **Availability.** An external uptime probe (free tier) calls `GET /api/v1/health/ready` every 60 s; NFR-10 is measured from it, not from the host.
- **Errors.** No third-party error tracker in phase 1.
- **Operator access to dashboards** (DR-88, decided by the Owner on 2026-10-20): Grafana is served at `monitor.<domain>` through the Tunnel, behind a Cloudflare Access application that allows the operators' emails, and keeps its own sign-in. Prometheus, Loki and Alertmanager have no host; alerts are silenced in Grafana.

## Consequences

**Positive**

- Every alert has a channel that reaches a person, and the nightly check, the backup and the re-query job are watched by metrics with a runbook behind each.
- Nothing about residents leaves the host.
- The stack is what the staging budget already carries, so EXP-07 measures the real system.

**Negative**

- Monitoring runs on the host it watches: if the VPS dies, the alerts die with it. Only the external uptime probe and the Telegram message that it triggers still work.
- Without traces, a slow request that crosses several modules is found by reading log lines joined on the request id.
- Telegram and email are two outside services in the alert path; if both are down the Owner learns late.
- A Loki and Alloy stack is more to upgrade and tune than a hosted service, and Alloy replaced Promtail, so older guides are wrong.
- A third public host and a second Access application have to be kept correct; a wrong policy would expose dashboards and log queries.

**Follow-up work**

- Write DOC-40 (metric catalog, PromQL rules, panel list, delivery), DOC-74 (alert → runbook table) and the runbooks RB-01…09; pin Alloy in P1-18 after verifying it on the web.
- DOC-10 asks DOC-40 to add host and per-container metrics and the archive-failure alert; reconcile the job-metric name between DR-63 and DR-101 there.
- Create `monitor.<domain>` and its Access application with the staging environment (P1-20, DOC-70).
