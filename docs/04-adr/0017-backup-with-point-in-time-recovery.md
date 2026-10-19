# ADR-0017: Back up PostgreSQL with pgBackRest to R2 for point-in-time recovery, on a self-hosted database, and accept the single-provider risk

- Status: Accepted
- Date: 2026-10-19 · Related: DR-66, DR-67, DR-83, DR-93, DR-80, NFR-10, NFR-11, EXP-12, DOC-72, DOC-70, DOC-19, DOC-10, RB-10

## Context

The invariant above all others is "never lose a payment". The original SDD set RPO ≤ 24 h with a daily 02:00 dump (NFR-11). A restore to 02:00 loses every payment made since, including online payments whose webhooks payOS will not resend. The same SDD left the hosting of PostgreSQL open: a managed service from a Vietnamese provider, or a container with dumps. The Owner then chose one VPS per environment with PostgreSQL installed natively and Cloudflare in front (DR-83). That choice decides what backup is possible: no provider-managed PITR, so the project runs its own.

## Options considered

1. **Daily dump only, accept RPO 24 h.** Cheap; statement reconciliation could re-find the money after a restore. But a lost payment would not be recovered by payOS, and the Manager would reconcile a whole day by hand. Rejected (DR-66 option 1).
2. **Managed PostgreSQL with PITR from a provider.** Offloads upgrades and the restore drill. No Vietnamese provider was chosen, the Owner already pays for the VPS, and extensions and the direct connection for LISTEN/NOTIFY must be checked on each offer. Not chosen.
3. **Continuous WAL archive with pgBackRest to R2, self-hosted PostgreSQL.** RPO of minutes, restore to any moment, encrypted repository. The Owner operates it.
4. **A second copy outside Cloudflare.** Would remove the single-provider risk. The Owner declined it on 2026-10-19.

## Decision

Option **3** (DR-66, DR-67, DR-83); option 4 is declined.

- PostgreSQL is installed natively on the VPS (DR-83); roles are `rms_migrator`, `rms_app`, `rms_readonly` and `rms_backup` (DR-67, DOC-19).
- pgBackRest archives to the private backup bucket on R2: a full backup weekly, a differential daily at 02:00 building time, a continuous WAL archive with `archive_timeout` of 60 s, repository encryption on with the key kept off R2, retention 4 full and 7 differential. A weekly logical `pg_dump` is the portable copy, kept 4 weeks.
- The package comes from the PostgreSQL project's apt repository and is the version that repository ships, not a source build (DR-93).
- Targets: **RPO ≤ 5 min, RTO ≤ 4 h** (NFR-11). The restore drill runs quarterly (EXP-12).
- After any restore (RB-10): run the invariant check, re-query payOS for every intent created in the gap, import the bank statement for the gap and reconcile, and list the `unknown_order` log rows.
- Files live only in the R2 files bucket (ADR-0016). **Accepted risk:** the edge, files and backups share one provider account; the Owner accepts this single-provider risk (2026-10-19). It is recorded in DOC-72.

## Consequences

**Positive**

- A confirmed payment is lost for at most the RPO, and the catch-up after a restore is a defined list, not a guess.
- No managed-database fee; extensions, connection limits and the direct LISTEN/NOTIFY connection are under the project's control.

**Negative**

- One VPS per environment is a single point of failure. A VPS loss costs up to the 4 h RTO, which alone exceeds the 3.6 h monthly downtime that 99.5% allows ([DOC-10](../03-architecture/quality-attributes.md) §7). The Owner accepted this.
- The Owner now does PostgreSQL upgrades, tuning, key custody and the restore drill. A backup that is never restored is not a backup: the quarterly drill is a standing chore.
- With `archive_timeout` 60 s, `pg_wal` grows about 22 GB a day if the archive stalls, so disk and an archive-failure alert are mandatory (DOC-10 §6.4).
- If the Cloudflare account is lost or suspended, the database backup, the files and the edge go together; the weekly `pg_dump` is in the same account too.
- The packaged pgBackRest may lag upstream by a minor version.

**Follow-up work**

- P1-20 proves pgBackRest against the R2 endpoint, checks the PostgreSQL and Docker packages on the chosen Ubuntu release (fallback to the previous LTS) and does one PITR restore on an empty host.
- DOC-72 (schedule, key custody, restore steps), DOC-70 (host setup), RB-07 (backup missing), RB-10 (restore) and EXP-12 (drill, RTO measurement).
- Revisit a second host or a copy outside Cloudflare after the first production month's availability result (NFR-10).
