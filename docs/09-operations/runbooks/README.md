# Runbook index

> Status: **Approved** (Claude, delegated by the Owner for technical documents, 2026-11-02) · Updated: 2026-11-02 (P2-00 review: every alert of DOC-40 §5 has a row, severities from the rules, `GatewayCheckFailing` for RB-13, the table "Alerts without a runbook") · 2026-11-01 (P2-20: the index and RB-01, 02, 03, 11, 13; the rest follow with their phases) · DOC-74
> Depends on: [DOC-40](../../06-design/observability.md) §5 (the alerts), master plan §3.2
> Main readers: the operator on call, the Owner

One table: an alert, the runbook that answers it, and how serious it is. Every runbook follows template A.7: symptoms and impact, checks (runnable queries and commands), remediation, what differs on staging, how to confirm, prevention. A runbook never tells the operator to edit a ledger table by hand.

Every alert of DOC-40 §5 has one row, in the order of the runbooks. Severity is the rule's `severity` label; "live" means the rule is in `ops/prometheus/rules/` today, otherwise the task that adds it.

| Alert | Severity | Rule | Runbook | Document | Status |
| --- | --- | --- | --- | --- | --- |
| `LedgerInvariantViolation`, `InvariantCheckStale` | Critical | P2-11 | [RB-01 The nightly ledger check found violations](RB-01-ledger-invariant.md) | DOC-75 | Approved |
| `PaymentsStuck` | Critical | P2-28 | [RB-02 Payments are stuck](RB-02-payments-stuck.md) | DOC-76 | Approved |
| `GatewayErrors` | Warning | P2-28 | [RB-02 Payments are stuck](RB-02-payments-stuck.md) | DOC-76 | Approved |
| `WebhookSignatures` | Warning | P2-28 | [RB-03 Webhook calls are being rejected](RB-03-webhook-signatures.md) | DOC-77 | Approved |
| `OutboxLag`, `WorkerDown`, `JobStale` | Warning | live | RB-04 Outbox lag | DOC-78 | owed (P3) |
| `DeadLetters` | Warning | live | RB-05 Dead letters | DOC-79 | owed (P3) |
| `SmsFailures`, `OtpDailyCapReached`, `SmsProviderDown` | Warning | live | RB-06 SMS failures | DOC-80 | owed (P3) |
| `BackupMissing`, `PostgresArchiveFailing` | Critical | live | RB-07 Backup missing | DOC-81 | owed (P6) |
| `BackupMetricMissing` | Warning | live | RB-07 Backup missing | DOC-81 | owed (P6) |
| `StorageQuota`, `DiskUsage` (from 80%) | Warning | live | RB-08 Storage quota | DOC-82 | owed (P3) |
| `DiskUsage` (above 90%) | Critical | live | RB-08 Storage quota | DOC-82 | owed (P3) |
| `ApiErrors`, `ApiDown`, `ReadinessFailing`, `PostgresDown` | Critical | live | RB-09 API errors | DOC-83 | owed (P6) |
| `DbPoolWaiting` | Warning | live | RB-09 API errors | DOC-83 | owed (P6) |
| `WorkerMemoryHigh` | Warning | P2-13 | RB-09 API errors | DOC-83 | owed (P6) |
| none (an operation, not an alert) | — | — | RB-10 Restore from backup | DOC-84 | owed (P6) |
| `MoneyLogOpen` | Warning | P2-28 | [RB-11 Money to check is waiting](RB-11-money-to-check.md) | DOC-85 | Approved |
| `ProviderAuthFailed` | Warning | P1-22 | RB-12 Rotate secrets and keys | DOC-86 | owed (P6) |
| `GatewayCheckFailing` | Warning | P3-01 | [RB-13 The payment provider is down, or its credentials changed](RB-13-provider-outage-or-credential-change.md) | DOC-87 | Approved |

Until an owed runbook is written, the alert's first step is its row in DOC-40 §5 and the dashboard it names.

## Alerts without a runbook

A rule whose `runbook` annotation is `table of DOC-74` points here (DOC-40 §5.1, DR-155; test OB-06). One first step each:

| Alert | Severity | Rule | First step |
| --- | --- | --- | --- |
| `IntegrityFindings` | Warning | P1-12 | Read `job_name` on the alert. `integrity_weekly` (a membership with two owners, a member of a removed account) and `integrity_notices` (a notice stuck `sending`) are explained in RB-01 §3: list the rows with its queries and fix them through the product, never by `UPDATE` |
| `RefreshTokenReuse` | Warning | live | A reused refresh token already revoked its whole family (DOC-26). Search the API log for `event: auth.refresh` with `outcome: reuse` over the last hour (Loki, dashboard Identity): one account repeating is a stolen or copied token, so tell its owner to sign out everywhere; many accounts at once is a client bug after a release |
| `LockoutSpike` | Warning | live | More than 10 lockouts in 15 minutes. In the API log, take the `auth.staff_login` lines with outcome `locked` and group them by IP and by staff id: one IP over many accounts is password guessing (block it at the host firewall); one building's staff after a password policy change is not an attack |
| `AccountDeletionBlocked` | Warning | P6-04 | An approved deletion is due but the job refuses it for more than 7 days because the account is an owner again (`owner_must_transfer`, DOC-35 §11, AD-43). The Manager transfers the unit's ownership; the next run of the job deletes the account |
| `MetricsCollectionFailing` | Warning | live | A gauge that reads the database failed more than 5 times in 15 minutes. If `ReadinessFailing` or `PostgresDown` also fires, follow RB-09 (this one is held by the inhibition rule). Otherwise the label `gauge` of `metrics_collection_errors_total` on `/metrics` names the gauge; a failing or slow query is a bug to fix in the module that owns it |
