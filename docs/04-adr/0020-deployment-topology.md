# ADR-0020: Deploy behind Cloudflare to one VPS per environment, with the API and worker in Docker and PostgreSQL installed natively

- Status: Accepted
- Date: 2026-10-19 · Related: DR-83, DR-160, DR-05, DR-06, DR-07, DR-102, DR-08, DR-61, DR-64, DR-66, DR-67, NFR-03, NFR-10, NFR-11

## Context

Original SDD §19.1 chose nginx with Let's Encrypt, a managed PostgreSQL in Vietnam with point-in-time recovery and a same-origin web CMS; DR-05…08, DR-61, DR-64, DR-66 and DR-67 were proposed on that basis. The Owner chose a cheaper topology (DR-83, 2026-10-18) that changes the proxy, the TLS, the database hosting, the object storage API and the origin of the web CMS. The system runs for one building of 240 units operated by one person, and the design scale is 5,000 units. The topology must also keep the invariants that depend on it: payOS webhooks and mobile apps reach the API without a login wall, no inbound port is open, backups give RPO ≤ 5 minutes (NFR-11), and the staging host is small enough that EXP-07 numbers are conservative.

## Options considered

1. **nginx, Let's Encrypt, managed PostgreSQL with point-in-time recovery, same-origin web CMS** (original SDD §19.1, DR-05…08 as first proposed). The database is someone else's to operate — but the Owner chose a cheaper topology, nginx open source has only passive upstream checks (DR-08), and a certificate has to be managed on the host (DR-07). Superseded by DR-83.
2. **A public VPS with inbound ports 80, 443 and SSH open, Cloudflare only as DNS.** Simplest network — but the origin is exposed to the internet and to scanners; the Tunnel removes every inbound port.
3. **Cloudflare Access in front of `api.<domain>` as well.** Protects the API with a login — but the mobile apps and payOS cannot pass a login, so Access fronts `admin.<domain>` and `monitor.<domain>` (Grafana, DR-88) only, never `api.<domain>`, and the webhook's HMAC signature is the one gate (DR-32).
4. **PostgreSQL in a container.** One compose file for everything — but the Owner's topology installs it on the host from the PostgreSQL project's apt repository and lets it listen on localhost and the Docker bridge only (DR-83 item 6); the DR records the choice, not a further reason.
5. **Cloudflare (Pages, edge, Tunnel, R2) plus one VPS per environment** with Caddy, `cloudflared`, `api` ×2, `worker` and monitoring in Docker Compose, and native PostgreSQL.

## Decision

Option **5** is chosen. The deployment diagram, the container table, the unit table and the trust boundaries are in [DOC-07](../03-architecture/system-context-and-containers.md) §3, §4 and §7; the budgets are in [DOC-10](../03-architecture/quality-attributes.md) §6; the step-by-step setup is DOC-70.

- **Hosts.** `admin.<domain>` is the web CMS on Cloudflare Pages; `api.<domain>` is the API through the Tunnel; `monitor.<domain>` is Grafana through the same Tunnel, behind Cloudflare Access (DR-88); staging mirrors all three on a second VPS with its own Tunnel, R2 buckets and Pages branch (DR-07, DR-83 item 1). The webhook URL is provider-neutral: `https://api.<domain>/api/v1/payments/webhooks/<provider>/{gatewayConfigId}`.
- **The VPS.** Ubuntu LTS; the firewall denies all inbound traffic, SSH included; operators and the CI deploy job reach SSH through the Tunnel (Access service token for CI), the provider console is the break-glass path (DR-83 item 2). Compose runs `caddy`, `cloudflared`, `api-1`, `api-2` and `worker` (one image, `APP_ROLES` selects the role: DR-05) and monitoring ([ADR-0021](0021-observability-stack-and-alert-delivery.md)).
- **Sizes and ceilings** (DR-06, DR-102). Staging 2 vCPU, 4 GB, 60 GB runs `api` ×1 and is where EXP-07 runs; production 4 vCPU, 8 GB, 100 GB runs `api` ×2. Container memory ceilings may add up to more than the host: the overcommit is bounded by PostgreSQL `OOMScoreAdjust=-900`, `memswap_limit` equal to `mem_limit` and a host-only swap file.
- **Proxy trust.** TLS ends at Cloudflare; Caddy speaks plain HTTP (`auto_https off`), with active health checks on `/health/ready`, a 2 MB body limit, no buffering on the SSE path. The client address is read from `CF-Connecting-IP`; Caddy trusts the private Docker ranges and the API keeps `TRUSTED_PROXY_HOPS=1` (DR-07, DR-83 item 3).
- **Edge.** Managed WAF, **one** rate rule on `/api/v1/auth/*` (the free plan allows one); WAF challenges skipped for the API host and the webhook path, and Bot Fight Mode **off** for the whole zone because the free plan cannot skip it (DR-83 items 4, 5, 10; revised by DR-160); CORS allows only `https://admin.<domain>`; SSE sends a heartbeat at least every 30 s because Cloudflare closes a silent proxied request at 100 s (DR-83 items 4, 5, 10).
- **Files and backups on R2** through the S3 API; two private buckets per environment; presigned `PUT` because R2 has no presigned `POST` ([ADR-0016](0016-files-on-r2-presigned-put.md)); pgBackRest to a separate bucket gives RPO ≤ 5 minutes ([ADR-0017](0017-backup-with-point-in-time-recovery.md)).
- **Delivery.** GitHub Actions builds the image to GHCR and deploys over the Tunnel with the rolling restart `api-1` → ready → `api-2` → `worker`; Pages and Expo EAS are deployed by the same pipeline; rollback is the previous image tag, Pages deployment or EAS Update, each in 10 minutes (DR-08, DR-83 item 9).

## Consequences

**Positive**

- No inbound port, no certificate to renew on the host, and a lower cost than a managed database.
- Staging and production share one shape, so a deploy rehearsal on staging means something.
- The web CMS is static; a rollback is a Pages deployment.

**Negative**

- One VPS per environment is a single point of failure. Recovery is a rebuild from the compose files and a pgBackRest restore (RTO ≤ 4 h, RB-10). One loss at that RTO already exceeds the monthly budget of NFR-10 (99.5%): DOC-10 §7 says so.
- A Tunnel or Cloudflare outage makes the API unreachable, so payOS webhooks can be missed; the re-query job and statement reconciliation cover it.
- Cloudflare free-plan limits (one rate rule, limited WAF features) put more of the rate limiting in the application buckets.
- Operating PostgreSQL ourselves adds upgrades, tuning and the restore drill to the Owner's work.
- Backups, files and the edge share one provider account; the Owner declined a second copy outside Cloudflare and accepts the single-provider risk (DR-66).
- **Data residency is deferred, not decided.** Cloudflare's edge and R2 are outside Vietnam while original SDD §19.1 chose Vietnam-hosted data (Decree 13/2023). The question is reviewed before any real personal data is loaded into staging or production, at the latest at the go-live gate (DOC-103), together with the legal dossier (P0-06). If counsel rejects, vehicle papers and photos move to a Vietnam-hosted S3-compatible store behind the same `FilesApi` (DR-83).
- The mobile apps and webhooks sit behind a CDN whose challenge features must stay off for them; a wrong rule blocks the apps or payOS.

**Follow-up work**

- P1-20 (staging) checks the PostgreSQL 18, Docker and pgBackRest packages for the chosen Ubuntu release, proves pgBackRest against R2 and tries one point-in-time restore; EXP-07 and EXP-08 then recalibrate the ceilings.
- Write DOC-70 (deploy), DOC-71 (CI/CD) and DOC-72 (backup and restore); the Owner inputs of P0-03 (domain, accounts, VPS location) are collected first.
- Close the data-residency review before real data is loaded.
