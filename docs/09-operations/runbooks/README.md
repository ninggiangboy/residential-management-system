# Runbook index

> Status: **Draft** · Updated: 2026-11-01 (P2-20: the index and RB-01, 02, 03, 11, 13; the rest follow with their phases) · DOC-74
> Depends on: [DOC-40](../../06-design/observability.md) §5 (the alerts), master plan §3.2
> Main readers: the operator on call, the Owner

One table: an alert, the runbook that answers it, and how serious it is. Every runbook follows template A.7: symptoms and impact, checks (runnable queries and commands), remediation, what differs on staging, how to confirm, prevention. A runbook never tells the operator to edit a ledger table by hand.

| Alert | Severity | Runbook | Document | Status |
| --- | --- | --- | --- | --- |
| `LedgerInvariantViolation`, `InvariantCheckStale` | Critical | [RB-01 The nightly ledger check found violations](RB-01-ledger-invariant.md) | DOC-75 | Draft |
| `PaymentsStuck`, `GatewayErrors` | Critical, Warning | [RB-02 Payments are stuck](RB-02-payments-stuck.md) | DOC-76 | Draft |
| `WebhookSignatures` | Warning | [RB-03 Webhook calls are being rejected](RB-03-webhook-signatures.md) | DOC-77 | Draft |
| `OutboxLag` | Critical | RB-04 Outbox lag | DOC-78 | owed (P3) |
| dead letters | Warning | RB-05 Dead letters | DOC-79 | owed (P3) |
| SMS failures | Warning | RB-06 SMS failures | DOC-80 | owed (P3) |
| backup missing | Critical | RB-07 Backup missing | DOC-81 | owed (P6) |
| storage quota | Warning | RB-08 Storage quota | DOC-82 | owed (P3) |
| API errors | Critical | RB-09 API errors | DOC-83 | owed (P6) |
| restore | | RB-10 Restore from backup | DOC-84 | owed (P6) |
| `MoneyLogOpen` | Warning | [RB-11 Money to check is waiting](RB-11-money-to-check.md) | DOC-85 | Draft |
| keys and secrets | | RB-12 Rotate secrets and keys | DOC-86 | owed (P6) |
| `GatewayErrors` (credentials, outage) | Warning | [RB-13 The payment provider is down, or its credentials changed](RB-13-provider-outage-or-credential-change.md) | DOC-87 | Draft |

The mapping of every alert to its runbook is the table of DOC-40 §5; this index follows it. Rows marked owed are written with the task that builds the alert.
