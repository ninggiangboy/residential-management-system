# ADR-0027: In Vietnam, keep files and backups in SeaweedFS on the VPS instead of Cloudflare R2, and keep the Cloudflare domain, HTTPS and Tunnel

- Status: Accepted
- Date: 2026-10-26 · Related: DR-268, DR-83, DR-58, DR-61, DR-66, DR-67, ADR-0016, ADR-0017, ADR-0020, NFR-10, NFR-11, EXP-07, EXP-12, DOC-70, DOC-72

## Context

ADR-0016, ADR-0017 and ADR-0020 (DR-83) put files and the pgBackRest repository on Cloudflare R2, which has no Vietnam location. The data-residency question (DR-58) was deferred, and the Owner accepted that backups, files and the edge share one provider account (DR-66). The system is deployed in Vietnam, and there R2 cannot hold personal data (vehicle papers, plate photos, encrypted database backups). The local stack already runs SeaweedFS as its S3 store (DOC-69), and the code reaches storage through `ObjectStorage` and `FilesApi` with `S3_*` settings, so the store is a configuration choice.

## Options considered

1. **Keep R2 and review residency later** (DR-83 as it was). Cheapest, and survives a VPS loss. Not allowed for a deployment in Vietnam. Kept as the **global** profile.
2. **A Vietnam-hosted S3 service** (a local provider's object storage). Off-VPS, so a VPS loss keeps the files. The Owner chose not to depend on a second paid provider for now; the S3 behavior (presigned PUT, `HEAD`, path-style, pgBackRest) would also need checking per provider.
3. **SeaweedFS on the VPS**, with a replica on a second server later (chosen). One host, no new provider, the same software as local development, and replication is a later addition.
4. **MinIO on the VPS.** Rejected: SeaweedFS is already the project's local store, so tests (`tools/compat/uploads.test.ts`) and the dev stack stay the same.

## Decision

Option **3** (DR-268).

- Two profiles: **`vn`** (staging and production now) and **`global`** (the DR-83 topology with R2, kept in ADR-0016, ADR-0017 and ADR-0020 as the reference). The profile changes `S3_*` values and the pgBackRest repository settings only.
- SeaweedFS runs in Docker Compose on the VPS: master, volume, filer and the S3 gateway, one set per environment; the gateway is the only part reachable, and only by the compose network and by the Tunnel route for `files.<domain>`. Buckets `rms-<env>-files` and `rms-<env>-backup` keep their names and separate S3 identities. Their data is on a **separate volume** from the OS and PostgreSQL disks.
- **Files:** the flow of ADR-0016 is unchanged (register, presigned PUT with a signed `Content-Type`, `HEAD`, magic bytes, attach, quota, signed GET). Clients reach the store through `files.<domain>` (staging `files-staging.<domain>`) through the Tunnel; `S3_PUBLIC_ENDPOINT` names that host and the CSP and CORS rules use it.
- **Backups:** the mechanism of ADR-0017 is unchanged (full weekly, differential daily 02:00, WAL archive with `archive_timeout` 60 s, encryption on with the key off the VPS, 4 full + 7 differential, weekly `pg_dump`). The repository is the SeaweedFS S3 gateway over TLS on the Docker bridge, path-style, with the gateway's CA configured. P1-20 proves it and tries one PITR restore; a POSIX repository on the backup volume is the fallback.
- **Edge and delivery:** unchanged from ADR-0020 (https domain, Cloudflare DNS and Tunnel, Pages, Access, WAF, no inbound port, GitHub Actions → GHCR over the Tunnel).
- **Later, not now:** a SeaweedFS replica on another server, so that losing one VPS loses neither files nor backups. It gets its own DR when scheduled.

## Consequences

**Positive**

- No personal data leaves Vietnam through storage or backup; the cross-border list of DR-58 shrinks to Cloudflare in transit and the push services.
- No new provider and no R2 cost; one S3 implementation in development, tests and deployment.
- The `global` profile stays documented, so a deployment outside Vietnam needs a configuration change, not a redesign.

**Negative**

- **One VPS now holds the database, the files and the backups.** Losing the VPS or its provider account loses all three. The RPO ≤ 5 min and RTO ≤ 4 h of NFR-11 hold for a PostgreSQL fault, a bad migration or a dropped table, not for the loss of the whole host. This is recorded as an accepted risk (DOC-72, DOC-10 §7) until the replica exists; it is worse than ADR-0017, where backups survived the VPS.
- The Owner now also operates SeaweedFS: upgrades, volume growth, a restore drill that includes the backup bucket and the key custody off the VPS.
- SeaweedFS shares the VPS's CPU, memory and disk with PostgreSQL and the API, so the sizes of DR-06 are provisional until P1-20, EXP-07 and EXP-08 measure them.
- Uploads and downloads cross the Cloudflare Tunnel; the free plan allows 100 MB per request, enough for the 50 MB video limit.
- pgBackRest against SeaweedFS's S3 gateway is not proven; it is the main risk of P1-20.

**Follow-up work**

- P1-07: keep `tools/compat/uploads.test.ts` (U1…U11) green on SeaweedFS behind the Tunnel host. P1-20: SeaweedFS version and compose service, pgBackRest repository over TLS, one PITR restore, the volume layout and the disk budget.
- DOC-70 (SeaweedFS service, `files.<domain>` route, volumes), DOC-72 (schedule, key custody, restore, the whole-VPS risk), DOC-37, DOC-39, DOC-41 (config for the two profiles), DOC-10 (budget, NFR-11 scope), DOC-11 (SeaweedFS version).
- Write the DR for the SeaweedFS replica when the Owner schedules it, and revisit NFR-10 and NFR-11 then.
