# Deploy: staging and production

> Status: **Approved** (Owner, 2026-10-21, as the first version for staging (gate P1); final in P6) · Updated: 2026-10-27 (P1-18: the monitoring files exist, pins refreshed, §10); earlier 2026-10-26 (DR-268: SeaweedFS replaces R2 for the `vn` profile; earlier 2026-10-22, DR-239: the trunk is `dev`; earlier 2026-10-21: DR-228: placeholders and the *Blocking?* column of §2; DR-68: providers picked at P1-22; stale open question removed) · DOC-70
> Depends on: original SDD §19.1, §19.3, [DR](../00-decision-register.md) (DR-05, 06, 07, 08, 33, 61, 63, 64, 65, 66, 67, 68, 69, 83, 88, 93, 95, 102, 113, 152, 154, 156, DR-158…162, DR-228, DR-268), [ADR-0027](../04-adr/0027-seaweedfs-on-the-vps-for-files-and-backups-in-vietnam.md), [DOC-06](../02-glossary.md), [DOC-07](../03-architecture/system-context-and-containers.md) §3, §4, §7, [DOC-10](../03-architecture/quality-attributes.md) §6, §7, [DOC-11](../03-architecture/tech-stack-and-versions.md) §1, §7, [DOC-19](../05-data/db-roles-and-grants.md) §3, §7, §8, [DOC-38](../06-design/jobs-and-outbox-runtime.md) §5.4, [DOC-39](../06-design/security.md) §5, §7, [DOC-40](../06-design/observability.md) §2, §6, [DOC-41](../06-design/configuration-reference.md) §4…16, [DOC-71](ci-cd.md) §7
> Main readers: P0-03, P1-18, P1-20, P1-22, P6-05, P6-13; the Owner and the operator who builds a host; [DOC-72](backup-restore.md) (backup, restore), [DOC-71](ci-cd.md) (calls the deploy command)

This document builds one environment from nothing: the inputs the Owner must supply, the VPS and its hardening, the Cloudflare setup, the object store (SeaweedFS on the VPS), native PostgreSQL and pgBackRest, the compose files, the Caddyfile and the Tunnel, the secrets as files, the rolling deploy script, the migrations, the first deploy and the teardown. It does not hold the pipeline that calls the deploy command (DOC-71), the restore procedure and the drill (DOC-72, RB-10), the meaning of a configuration key (DOC-41), the alert rules (DOC-40) or the application's design (DOC-07). Staging and production use the same files; §12 lists the few values that differ. It describes the `vn` profile (§1); the `global` profile with Cloudflare R2 is not built here.

**State of this document.** Nothing has been installed: there is no VPS, no Cloudflare account configured and no domain yet (the inputs of §2 are open and are placeholders until the task that needs them, DR-228). Every command is written from the vendor documentation read on 2026-10-20 (sources in §17) and **not run**. P1-20 builds staging by following this document and corrects it where reality differs; each place that task must confirm is marked **P1-20 checks**. **Nothing of the SeaweedFS and pgBackRest-on-SeaweedFS parts (§5.5, §6.1, §8.4) has been run or read from SeaweedFS documentation for this version**: they come from DR-268, ADR-0027 and the local stack (DOC-69, SeaweedFS 4.48 in `compose.local.yml`). pgBackRest against the SeaweedFS S3 gateway is **unproven until P1-20** (archive, backup, a restore on an empty host); every SeaweedFS option named here is **to verify in P1-20**. The values for production are the same files with the sizes of DR-06.

## 1. Purpose and scope

| Item | Where |
| --- | --- |
| Inputs the Owner supplies (P0-03) | §2 |
| Hosts, sizes, names, the layout on the host | §3 |
| VPS provisioning and hardening | §4 |
| Cloudflare: DNS, Tunnel, Access, WAF, rate rule, Pages | §5.1 to §5.4 |
| Object store: SeaweedFS on the VPS (data volume, TLS, identities, buckets, the files host) | §5.5 |
| Compose files, profiles, start order, health, migrations, the deploy script, rollback, one-shot containers for experiments | §6 |
| Caddyfile and the Tunnel routes | §7 |
| PostgreSQL native install and tuning, pgBackRest | §8 |
| Secrets and environment variables | §9 |
| Monitoring files | §10 |
| First deploy, step by step | §11 |
| Staging versus production | §12 |
| Teardown | §13 |
| Checks | §14 |

**Two profiles (DR-268, ADR-0027).** `vn` is what this document builds for staging and production: the system is deployed in Vietnam, so Cloudflare R2 (no Vietnam location) is **not** used. Files and the pgBackRest repository live in SeaweedFS (S3 gateway, Docker Compose) on the environment's own VPS, on a separate data volume. The Cloudflare edge stays (https domain, DNS, Tunnel, Pages, Access, WAF); clients reach the S3 gateway only through the Tunnel host `files.<domain>`. `global` is the DR-83 topology with R2 for a later deployment outside Vietnam; it stays described in ADR-0016 (files), ADR-0017 (backup) and ADR-0020 (topology) and is not repeated here. The code and `FilesApi` do not change between the profiles; the difference is `S3_*` values (§9.2) and the pgBackRest repository settings (§8.4):

| | `vn` (this document) | `global` (ADR-0016, 0017, 0020) |
| --- | --- | --- |
| Files and backup store | SeaweedFS on the VPS, separate data volume | Cloudflare R2, two buckets |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | `https://seaweedfs:8333` (bridge) / `https://files(-staging).<domain>` | `https://<account-id>.r2.cloudflarestorage.com` for both |
| `S3_FORCE_PATH_STYLE` | `true` | `false` |
| pgBackRest repository | S3 path-style over TLS on the bridge, CA file; fallback: POSIX on the backup volume | R2 endpoint |
| Losing the VPS | Loses database, files and backups until the replica exists (§15) | Backups and files survive |

## 2. Owner inputs (P0-03)

Task P0-03 collects these and records them in this table. **The documents never hold the real data** (DR-228, Owner, 2026-10-21): they use placeholders (`<domain>`, `<reverse-domain>`, `<company-name>`, `<tax-code>`, `<github-org>`, …), and the Owner supplies the real value only when the task that needs it starts, to the place that uses it (the Cloudflare account, the EAS project, the secret files of §9, the operator), never to this repository. The column *Needed by* is the task that stops without the real value; the column *Blocking?* says what happens before that task. **No input is needed to start coding phase 1**: P1-01…P1-16, P1-19 and P1-21 run locally with placeholders, Mailpit and the fake drivers.

| # | Input | Used in | Needed by | Blocking? | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Company legal name, address, tax code | Terms, receipts, store listings (DOC-73) | P1-12, P6-10 | **Placeholder, then required.** The terms seed of P1-12 uses `<company-name>`, `<company-address>`, `<tax-code>`; the real text is needed before the staging UAT and for the store listing (P6-10) | Open |
| 2 | **Company domain** `<domain>` and where it is registered; the Owner can change its name servers to Cloudflare | §5.1; every host name | P1-20 | **Required at P1-20 (staging), not before.** Lead time: buying the domain and moving its name servers to Cloudflare can take days | Open |
| 3 | Cloudflare account: owner email, two-factor on; no R2 in the `vn` profile; what the free plan asks (payment method) | §5 | P1-20 | **Required at P1-20 (staging), not before** | Open |
| 4 | **VPS provider, location, plan and price** for staging (2 vCPU, 4 GB, 60 GB) and production (4 vCPU, 8 GB, 100 GB), Ubuntu Server 26.04 LTS available (else 24.04, DR-83); out-of-band console access; **location in Vietnam** (DR-268: files and backups stay in the country; fixed by P0-03); whether the provider offers block volumes and snapshots (row 16) | §3, §4, §5.5 | P1-20 | **Required at P1-20 (staging), not before**; production is needed at P6 | Open |
| 5 | Operators: names and emails of the Owner and of the Admin who operates the system; their SSH public keys | §4.3, §5.2 (Access allow-list) | P1-20 | **Required at P1-20 (staging), not before** | Open |
| 6 | GitHub organization and repository (private); who administers it | DOC-71 | P1-01 | **Not blocking: satisfied.** The repository already exists; documents use `<github-org>` | Satisfied |
| 7 | App display names, bundle ids `<reverse-domain>.rms.resident` and `<reverse-domain>.rms.staff` (DR-69) | DOC-73 | P1-17 | **Placeholder, then required.** `<reverse-domain>` and `<app-name>` until the first EAS build of P1-17, which needs the real ids | Open |
| 8 | Apple Developer Program account; Google Play Console account; Expo organization (all company-owned) | DOC-73 | P1-17, P6-10 | **Expo organization: required at P1-17.** Apple Developer: only for an iOS device build or a store build; Google Play: only for the store build (P6-10). The Android development build and the simulators work without either. Lead time: Apple Developer enrolment (company verification takes days to weeks) | Open |
| 9 | Receiving bank account (bank, number, holder) and payOS merchant account with test credentials (P0-04) | DOC-24 | P3-01 | **Not P1.** Needed at P3 (P3-01); the fake driver runs until then | Open |
| 10 | SMS provider with brandname OTP and SMTP relay chosen (DR-68: not chosen yet; ports, `console`/`allowlist` drivers and Mailpit first); brandname registration started | DOC-26, §9 | P1-22 (and M1, which needs a real SMS OTP) | **Required at P1-22, not before.** P1-10 and P1-11 run on the fake drivers. Lead time: brandname registration takes up to about 3 weeks after the pick | Open |
| 11 | A second mail account for alert delivery (not the application's SMTP), and a Telegram bot with the chat id of the alert group (DR-63) | §10 | P1-18 | **Required for the acceptance of P1-18 on staging** (the alert must reach email and Telegram); locally the alerts go to Mailpit | Open |
| 12 | An external uptime probe service (free tier) and who receives its messages (DOC-40 §6) | NFR-10 | P1-18 | **Required for the acceptance of P1-18 on staging**; not needed locally | Open |
| 13 | Manager contact; time zone confirmation `Asia/Ho_Chi_Minh` (DR-09) | DOC-36 | P1-12 | **Placeholder (demo seed), then required** before the staging UAT. The time zone is already decided (DR-09) | Open |
| 14 | Where the Owner keeps the **sealed offline copies** of the PII key, the pgBackRest passphrase and the backup S3 credentials (a safe or a password manager with an emergency kit), kept **off the VPS** (DR-268 item 2) | §9.3 | P1-20 | **Required at P1-20 (staging), not before**; the keys of staging are created then (EXP-09 of P1-23 runs on it) | Open |
| 15 | Expo push credentials: FCM service account and APNs key (DOC-73) | `EXPO_ACCESS_TOKEN`, §9 | P1-17 | **Required for the acceptance of P1-17 on a real device** (a push reaching a phone); the development build and simulators run without | Open |
| 16 | **Data volume for SeaweedFS** (files and the backup repository), separate from the OS and PostgreSQL disks: its size for staging and production (sized from DOC-10 §6 and the backup retention of §8.4; not decided yet, P1-20 measures), whether the provider sells it as a block volume or as a second disk, and whether the provider offers **snapshots** of the VPS or the volume, and their price (an optional mitigation of the whole-VPS risk, §15; DR-268 consequences) | §3.2, §5.5 | P1-20 (staging), P6-05 | **Required at P1-20 (staging), not before** | Open |

**Lead times to start early** (DR-228): the SMS brandname registration (up to about 3 weeks, row 10), the Apple Developer enrolment (row 8) and the domain registration with the name-server change (row 2) and, if the provider needs time to add a volume in Vietnam, row 16. None blocks coding; each can delay the staging UAT or the first iOS build if started late.

No input is a secret to write in this repository: the table records *that* the Owner supplied it and where it is kept.

## 3. Hosts and layout

### 3.1 Environments and names (DR-06, DR-07, DR-83, DR-88)

| | Staging | Production |
| --- | --- | --- |
| VPS | 2 vCPU, 4 GB, 60 GB | 4 vCPU, 8 GB, 100 GB |
| Web CMS (Pages) | `admin-staging.<domain>` | `admin.<domain>` |
| API (Tunnel → Caddy) | `api-staging.<domain>` | `api.<domain>` |
| Grafana (Tunnel → Grafana, behind Access) | `monitor-staging.<domain>` | `monitor.<domain>` |
| SSH (Tunnel, behind Access) | `ssh-staging.<domain>` | `ssh.<domain>` |
| Tunnel | `rms-staging` | `rms-production` |
| Files (Tunnel → SeaweedFS S3 gateway only) | `files-staging.<domain>` | `files.<domain>` |
| SeaweedFS buckets (on the VPS) | `rms-staging-files`, `rms-staging-backup` | `rms-production-files`, `rms-production-backup` |
| Data volume (SeaweedFS data) | `/srv/rms-data`, a separate volume (§5.5) | the same |
| Pages project | `rms-admin-staging` | `rms-admin-production` |
| Compose project | `rms` | `rms` |

`ssh-<env>.<domain>` is a fourth host that DR-83 and DOC-07 imply (SSH through the Tunnel) without naming; it is behind Access and never serves a web page (DR-158). `files-<env>.<domain>` is the fifth, added by DR-268: the Tunnel routes it to the SeaweedFS S3 gateway and to nothing else; it is **not** behind Access (apps and browsers upload to it with presigned URLs, as they do to the API).

Memory and CPU ceilings per container, the PostgreSQL budget and the connection arithmetic are DOC-10 §6 and DR-06, DR-102; §6.1 applies them.

### 3.2 Layout on the host

| Path | Content | Owner · mode |
| --- | --- | --- |
| `/opt/rms/releases/<tag>/` | One unpacked release: `docker/` (Dockerfile, compose files) and `ops/` (configuration of every service). The tag is `sha-<7>` or `vX.Y.Z` | `deploy:deploy` · 0755 |
| `/opt/rms/current` | Symlink to the running release; the compose files bind-mount `ops/…` through it | `deploy` |
| `/opt/rms/incoming/<tag>.tgz` | The tarball of `docker/` and `ops/` that CI uploads before the deploy command (DOC-71 §7.1) | `deploy` · 0644 |
| `/opt/rms/env/compose.env`, `/opt/rms/env/app.env` | Host-specific, **non-secret** environment (§9.2). Not in Git: they hold the domain and bucket names | `deploy` · 0644 |
| `/etc/rms/secrets/` | One file per secret (§9.1) | `deploy:rms` (gid 10001) · 0750 directory; files 0440 |
| `/var/lib/rms/deploy-state` | Lines `current=<tag>` and `previous=<tag>` | `deploy` · 0644 |
| `/var/lib/node_exporter/textfile/backup.prom` | The backup success timestamp (DR-154) | `postgres` · 0644 |
| `/etc/pgbackrest/pgbackrest.conf` | pgBackRest configuration, **holds the SeaweedFS backup key and the repository passphrase** | `postgres:postgres` · 0600 |
| `/var/lib/postgresql/18/main` | The database cluster (PostgreSQL 18, native), on the OS disk | `postgres` |
| `/srv/rms-data/` | Mount point of the **separate data volume** (§5.5): `seaweedfs/` (the buckets of files and backup) and, only in the fallback of §8.4, `pgbackrest/` | `root` · 0755; `seaweedfs/` is written by the container |
| `/etc/rms/tls/` | The private CA and the gateway certificate of §5.5 (`ca.pem`, `seaweedfs.pem`); the key is the secret file `seaweedfs-tls-key` | `deploy:rms` · 0750; files 0440 |
| Docker volumes | `prometheus-data`, `alertmanager-data`, `grafana-data`, `loki-data` (production, and staging while the `logs` profile is on) | Docker |

The repository paths that this layout expects are `docker/` (Dockerfile and compose files) and `ops/` (everything mounted into a container or installed on the host). `ops/` is new: DOC-12 §2.1 lists `docker/` only (DR-158):

```
ops/
├── caddy/Caddyfile
├── cloudflared/README.md               # the ingress table of §7.2 (remote-managed Tunnel)
├── prometheus/prometheus.yml, rules/*.yml         # rules text is DOC-40 §5
├── alertmanager/alertmanager.yml
├── loki/config.yml
├── alloy/config.alloy
├── grafana/provisioning/{datasources,dashboards}/*.yml, dashboards/*.json
├── postgres/{rms.conf, pg_hba.conf, pg_ident.conf, 0001-provision.sql, createcluster.conf}
├── pgbackrest/pgbackrest.conf.template
├── seaweedfs/{s3-config.template.json, tls.sh}      # the identities of §5.5 and the CA and certificate commands
├── backup/{backup.sh, rms-backup@.service, rms-backup@full.timer, rms-backup@diff.timer}
├── host/{sshd-rms.conf, daemon.json, sysctl-rms.conf, unattended-upgrades-rms.conf, postgres-override.conf}
└── deploy/{deploy.sh, smoke.sh, maintenance.sh}
```

### 3.3 Who can do what on the host

| User | Rights | Reached by | Used for |
| --- | --- | --- | --- |
| `deploy` | Member of group `docker` (**root-equivalent** through the Docker socket); no `sudo` | SSH through the Tunnel with the CI key, or an operator's key | `deploy.sh`, `docker compose …`, reading logs |
| `ops` | `sudo` with a password-less key login; reached by operators only | SSH through the Tunnel with an operator's key | Installing packages, PostgreSQL administration, editing `/etc` |
| `postgres` | The database OS user | `sudo -u postgres` from `ops` | `psql`, `pgbackrest` |
| root | No SSH login (`PermitRootLogin no`) | The provider console (break-glass) | Recovery |

A leaked CI key therefore gives root on that one host. The limits are: the key works only through the Access policy with the service token; the host key is pinned; the host holds nothing outside that environment; and CI never sees the migration role's password (DOC-71 §12).

## 4. Provision and harden the VPS

Do this once per environment. The provider console is open during all of it: the order below never closes the only door before another is open (§4.9).

### 4.1 Base system

```bash
# as root on the provider console, or as the provider's first user with sudo
apt-get update && apt-get -y full-upgrade
apt-get -y install ca-certificates curl gnupg lsb-release ufw unattended-upgrades jq
timedatectl set-timezone UTC                 # the host runs UTC; jobs use Asia/Ho_Chi_Minh themselves (DOC-41 JOBS_TIME_ZONE)
hostnamectl set-hostname rms-staging         # rms-production on production
lsb_release -cs                              # expected: resolute (Ubuntu 26.04) ; noble on the 24.04 fallback
```

### 4.2 Swap and kernel settings (DR-102)

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
install -m 0644 /dev/stdin /etc/sysctl.d/90-rms.conf <<'EOF'
vm.swappiness = 10
vm.overcommit_memory = 0
net.core.somaxconn = 1024
EOF
sysctl --system
```

Expected: `swapon --show` lists a 2 GB file; `free -h` shows `Swap: 2.0Gi`. The swap is for the host only: containers get `memswap_limit` equal to `mem_limit` (§6.1, DR-102).

### 4.3 Users and keys

```bash
adduser --disabled-password --gecos "" deploy
adduser --disabled-password --gecos "" ops && usermod -aG sudo ops
echo 'ops ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-ops && chmod 440 /etc/sudoers.d/90-ops
groupadd --gid 10001 rms                      # the group of the application containers (§9.1)
for u in deploy ops; do install -d -m 700 -o $u -g $u /home/$u/.ssh; done
# paste the public keys: the CI deploy key (comment "ci-deploy") for deploy; each operator's key for ops and deploy
install -m 600 -o deploy -g deploy /dev/stdin /home/deploy/.ssh/authorized_keys   < deploy_keys.pub
install -m 600 -o ops    -g ops    /dev/stdin /home/ops/.ssh/authorized_keys      < ops_keys.pub
```

```bash
install -d -o deploy -g deploy /opt/rms /opt/rms/incoming /opt/rms/releases /opt/rms/env /var/lib/rms
usermod -aG rms deploy && usermod -aG rms ops     # read access to the secret files of §9.1
```

The CI key is an ed25519 key made for this environment only (`ssh-keygen -t ed25519 -C ci-deploy-staging -f id_deploy`); its private half is the GitHub secret `DEPLOY_SSH_KEY` (DOC-71 §12).

### 4.4 SSH hardening

`ops/host/sshd-rms.conf` → `/etc/ssh/sshd_config.d/10-rms.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers deploy ops
MaxAuthTries 3
LoginGraceTime 20
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 60
ClientAliveCountMax 3
```

```bash
sshd -t && systemctl reload ssh
```

sshd keeps listening on all interfaces; what stops a connection from the Internet is the firewall of §4.8 and, outside it, the provider's firewall if it has one (the same rule: deny inbound). The listener has to be reachable from the Docker bridge, where `cloudflared` runs (§5.2).

### 4.5 Automatic updates, without surprises

```bash
install -m 0644 ops/host/unattended-upgrades-rms.conf /etc/apt/apt.conf.d/52rms-unattended
```

```
Unattended-Upgrade::Allowed-Origins { "${distro_id}:${distro_codename}-security"; };
Unattended-Upgrade::Package-Blacklist { "postgresql-.*"; "pgbackrest"; "docker-.*"; "containerd.*"; };
Unattended-Upgrade::Automatic-Reboot "false";
```

Security updates of the operating system install themselves; **PostgreSQL, pgBackRest and Docker never do**, because a restart of the database or the daemon is a planned event (DOC-10 §7: a PostgreSQL restart is about a minute, announced). The operator applies them in a quiet hour with `apt-get -y install --only-upgrade <package>` and announces them. A kernel update takes effect at the next reboot, which the operator schedules; after it the containers return by themselves (§6.2) and the reboot test of §14 check 9 proves it.

### 4.6 Docker Engine and Compose

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-cache madison docker-ce | head -3          # P1-20 checks: 5:29.9.1-1~ubuntu.26.04~resolute is listed (DOC-11 §1)
apt-get -y install docker-ce=5:29.9.1-1~ubuntu.26.04~resolute docker-ce-cli=5:29.9.1-1~ubuntu.26.04~resolute containerd.io docker-buildx-plugin docker-compose-plugin
apt-mark hold docker-ce docker-ce-cli docker-compose-plugin
install -m 0644 ops/host/daemon.json /etc/docker/daemon.json
systemctl restart docker
usermod -aG docker deploy
docker compose version                          # expected: Docker Compose version v5.6.0 (DOC-11 §1)
```

`ops/host/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" },
  "live-restore": true
}
```

Rotation of 10 MB × 5 per container bounds the disk use that DOC-10 §6.4 reserves. `live-restore` keeps containers running while the daemon restarts (a Docker upgrade).

The application network is created **once, by hand**, so that its address is fixed and PostgreSQL can listen on its gateway (§8.2):

```bash
docker network create --driver bridge --subnet 172.30.0.0/24 --gateway 172.30.0.1 \
  -o com.docker.network.bridge.name=br-rms rms
ip addr show br-rms | grep 172.30.0.1           # expected: inet 172.30.0.1/24
```

### 4.7 GHCR pull login (read-only)

```bash
sudo -u deploy -i
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin   # Login Succeeded
docker pull ghcr.io/<org>/rms-api:sha-<7>      # any existing tag: pulls
```

`GHCR_READ_TOKEN` is a personal access token with the single scope `read:packages` (DR-65 "GHCR read token"). **P1-20 checks** whether a fine-grained token works for GHCR; until then a classic token is the documented path. The credential sits in `~deploy/.docker/config.json` (mode 0600); the token cannot push or read anything but the package.

### 4.8 Firewall: deny all inbound

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow in on br-rms to 172.30.0.1 port 22,5432 proto tcp comment 'containers: cloudflared to sshd, apps to PostgreSQL'
ufw status verbose                               # Status: inactive until the next line
ufw --force enable                               # do this only after §4.9 step 3 has passed
```

The only rules are for the Docker bridge: `cloudflared` reaches `sshd` at `172.30.0.1:22`, and the containers reach PostgreSQL at `172.30.0.1:5432`. Nothing is open to the Internet, **SSH included** (DR-83 item 2). Docker publishes no port: no service in §6 has a `ports:` entry. A check from outside (§14 check 1) proves it.

### 4.9 Order that cannot lock you out

1. Do §4.1 to §4.7 and §6.5 first (the compose project can start `cloudflared`), with the firewall **not yet enabled**.
2. Create the Tunnel and the SSH route (§5.2) and start `cloudflared`.
3. From a laptop, open a session **through the Tunnel**: `ssh ops@ssh-staging.<domain>` with the `ProxyCommand` of DOC-71 §7.1 (an operator logs in through the Access page once). Run `sudo true`.
4. Only then `ufw --force enable`, and remove any provider firewall rule that allows port 22.
5. Open a **second** tunnel session and a console session before closing the first.

If a mistake locks the host, the provider console (root login by the provider's means) is the break-glass path; it must be tested once in P1-20 (§14 check 2).

## 5. Cloudflare

A single Cloudflare account on the free plan holds the edge (DR-83; in the `vn` profile it holds no files and no backups, DR-268). Plan limits were read on 2026-10-20: **one** rate-limiting rule per zone, 10-second period, counted per IP, 10-second mitigation (Cloudflare rate-limiting documentation).

### 5.1 Zone and DNS

1. Add `<domain>` to Cloudflare (Add a domain, free plan). At the registrar, set the two name servers Cloudflare shows. Wait for status **Active**.
2. SSL/TLS: encryption mode **Full (strict)**; *Always Use HTTPS* on; *Minimum TLS Version* 1.2; *Automatic HTTPS Rewrites* on.
3. **Do not turn on** *Bot Fight Mode* and turn it **off** if it is on (Security → Bots). Reason in §5.3.
4. DNS records are made by the steps below, not by hand: the Tunnel's public hostnames (api, monitor, ssh and files) add proxied `CNAME` records to `<tunnel-id>.cfargotunnel.com` (§5.2); the Pages custom domains add records to `<project>.pages.dev` (§5.4). Nothing else is created. In particular **there is no `A` record to the VPS address**: the host is not addressable from the Internet.
5. Email for `<domain>` (SPF, DKIM, DMARC for the invitation mail) is set up with the chosen SMTP relay (DR-68, P1-22).

### 5.2 Tunnel, Access and the service token

**Tunnel.** One remote-managed Tunnel per environment (Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared).

1. Name `rms-staging`. Choose the *Docker* connector tab; **copy the token only** (the `eyJ…` string after `--token`). Store it as the host secret `tunnel-token` (§9.1). The compose file runs the connector (§6.1); do not run the command shown by the dashboard.
2. **Public hostnames** (Routes → Published applications), in this order:

   | Hostname | Service type | URL | Why |
   | --- | --- | --- | --- |
   | `api-staging.<domain>` | HTTP | `caddy:80` | The API through Caddy (§7.1). Container name on the `rms` network |
   | `monitor-staging.<domain>` | HTTP | `grafana:3000` | Grafana directly, **not** through Caddy (DR-88) |
   | `ssh-staging.<domain>` | SSH | `172.30.0.1:22` | `sshd` on the host, seen from the container through the bridge gateway. The dashboard form offers `localhost:22`; inside a container that is the container itself, so the gateway address is used |
   | `files-staging.<domain>` | HTTPS | `seaweedfs:8333` | The SeaweedFS **S3 gateway only** (DR-268 item 5): presigned `PUT` and `GET` from the apps and the web CMS. The gateway serves TLS (§5.5), so the type is HTTPS; the origin certificate is signed by the private CA of §5.5, so set *Origin Server Name* to `seaweedfs` and give the connector the CA (**P1-20 checks** the dashboard field; if it cannot take a CA, the fallback is *No TLS Verify* for this one route, acceptable because the hop never leaves the Docker bridge). Do **not** override the *HTTP Host Header*: the presigned URL is signed for `files-staging.<domain>` and the gateway must see that Host (U1…U11 of `tools/compat/uploads.test.ts` prove it, P1-07) |

   The catch-all rule is `http_status:404`. The four hostnames are the only way in. The filer, master and volume ports of SeaweedFS (8888, 9333, 8080) have **no** route and no `ports:` entry.
3. Ops routes are **not** published: `/health/live`, `/metrics` and the other `OPS_PORT` routes (DR-07). `GET /api/v1/health/ready` is public because it is a normal API path (E-02).

**Access** (Zero Trust → Access → Applications), three applications per environment. Before them: Settings → Authentication → keep **One-time PIN** as the identity method; and Access → Access groups:

| Group | Include | Who |
| --- | --- | --- |
| `rms-operators` | The emails of the Owner and of the operating Admin (§2 input 5) | Grafana and SSH |
| `rms-web-staff` | The emails of every staff member who uses the web CMS: Admin and Manager (Technicians and Guards use the mobile app only) | The web CMS |

| Application | Domain | Policies | Session |
| --- | --- | --- | --- |
| `rms-admin-staging` | `admin-staging.<domain>` | 1. **Allow** group `rms-web-staff`. 2. **Service Auth** service token `deploy-ci` (the smoke test reads the page) | 24 h |
| `rms-monitor-staging` | `monitor-staging.<domain>` | **Allow** group `rms-operators` | 8 h |
| `rms-ssh-staging` | `ssh-staging.<domain>` | 1. **Allow** group `rms-operators`. 2. **Service Auth** token `deploy-ci` | 8 h |

**Access never fronts `api-<env>.<domain>`** (DR-83 item 4): the mobile apps and the payment gateway cannot pass a login. It does not front `files-<env>.<domain>` either, for the same reason: a presigned URL is the credential. The Access layer on the web CMS is therefore one more lock on the static site, **not** a protection of the API: a staff password and the API's own limits remain the real gate (DOC-39 §3). The Owner adds an email to `rms-web-staff` when the Admin creates a staff member who needs the CMS; forgetting it shows the person the Access login page, not an error of the application (a known cost, in §15 risks).

**Service token.** Access → Service credentials → Create service token `deploy-ci`, duration 1 year (the dashboard accepts a duration; the token expires and the Owner refreshes it from the dashboard: a calendar reminder 30 days before). Copy the Client ID and Client Secret **once** into the GitHub environment secrets `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (DOC-71 §12). A request that presents `CF-Access-Client-Id` and `CF-Access-Client-Secret` passes a Service Auth policy; an invalid token gets 401 or 403, never a login redirect (Cloudflare service-token documentation).

**P1-20 checks:** that the free plan covers the staff count (the number of distinct emails in the two groups and of operators); the name of the plan limit in the dashboard; the flags `--service-token-id` and `--service-token-secret` of `cloudflared access ssh` (DOC-71 §7.1).

### 5.3 WAF, the rate rule, cache and bot settings

**Bot Fight Mode is off** (DR-160). DR-83 item 4 required to *skip* it for the API host and the webhook path. Cloudflare's documentation says it cannot be skipped: "You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules", it does not run on the ruleset engine, and it "may challenge API or mobile app traffic" (read 2026-10-20). A challenge on the API host would break the apps and the gateway callback, so the setting is off for the zone. What remains: the managed WAF ruleset, the application's rate buckets (DR-64) and the rate rule below.

| # | Where | Rule | Settings |
| --- | --- | --- | --- |
| 1 | Security → WAF → Custom rules | **Webhook skip.** If `http.host eq "api-staging.<domain>"` and `starts_with(http.request.uri.path, "/api/v1/payments/webhooks/")` | Action **Skip**: *All remaining custom rules*, *Rate limiting rules*, *Managed rules*. The HMAC is the only gate of this route (DR-32); a WAF false positive on a signed JSON body must not drop a payment |
| 2 | Configuration rules | **API host.** If `http.host eq "api-staging.<domain>"` | *Browser Integrity Check* **off** (a native client or a gateway without a browser-like user agent), *Security Level* **Essentially Off** (an IP reputation challenge would break an app behind a carrier NAT) |
| 3 | Cache rules | **No cache for the API.** If `http.host eq "api-staging.<domain>"` and `starts_with(http.request.uri.path, "/api/")` | *Bypass cache* (DOC-50 §12: the API sets its own `Cache-Control`) |
| 4 | Security → WAF → Rate limiting rules | **Auth flood** (the one rule of the free plan) | See below |
| 5 | Configuration rules and Cache rules | **Files host.** If `http.host eq "files-staging.<domain>"` | Cache: *Bypass cache* (a signed `GET` is private data and must never sit in the edge cache); *Browser Integrity Check* **off** (native clients). The managed WAF stays on: **P1-20 checks** that a 50 MB `PUT` of a video and a JPEG upload are not blocked, and the free plan's 100 MB request limit (DR-268) |

Rate rule 4:

| Field | Value |
| --- | --- |
| Expression | `http.host eq "api-staging.<domain>" and starts_with(http.request.uri.path, "/api/v1/auth/")` (the free plan allows the fields Path and Verified Bot only: **P1-20 checks** that `starts_with` and the host condition are accepted; if not, use `http.request.uri.path contains "/api/v1/auth/"`, as the host is the only one that serves that path) |
| Characteristic | IP |
| Requests per period | **100 per 10 seconds** |
| Action and mitigation | Block for 10 seconds (the free plan's only timeout) |

The number is deliberately loose (DR-159): it is an outer net against a flood, not a limiter. The real limits are the application buckets (OTP 5 per phone and 20 per IP per hour, staff sign-in 30 per IP per 15 minutes, DR-64, DOC-39 §6). Residents on one building Wi-Fi share one public address and refresh tokens at app start, which the rule must not block; 100 requests in 10 seconds is 10 per second from one address. EXP-09 (DOC-98) and the first week on staging recalibrate it.

Production repeats the four rules with `api.<domain>`. A rule on the free plan counts against the account's allowance per zone, so the staging and production hosts share one zone and **one** rate rule: the expression above names both hosts when both exist:
`http.host in {"api-staging.<domain>" "api.<domain>"} and starts_with(…)`. Production sets this rule when it is built.

### 5.4 Pages

One direct-upload Pages project per environment (DR-165). With `wrangler` 4.151.1 (DOC-11 §4):

```bash
bunx wrangler@4.151.1 login                                    # once, as the account owner; CI uses CLOUDFLARE_API_TOKEN
bunx wrangler@4.151.1 pages project create rms-admin-staging --production-branch main
# expected: ✨ Successfully created the 'rms-admin-staging' project
```

Then in the dashboard: Workers & Pages → `rms-admin-staging` → Custom domains → add `admin-staging.<domain>` and let Cloudflare create the record. Pages custom domains follow the project's production branch (Cloudflare Pages documentation).

- **`_headers`.** The file of DOC-39 §5.1 is built into `dist/_headers` by the web job (DOC-71 §8). Pages allows 100 header rules and 2,000 characters per line; the CSP line is about 700 characters. Headers do not apply to Pages Functions responses; the web CMS has no Functions.
- **No Functions, no `_redirects`** except the single-page fallback: `/* /index.html 200` in `dist/_redirects`.
- Access protects the custom domain (§5.2). The project's `*.pages.dev` address is **also public**: turn on *Access policy for `*.pages.dev`* for the project (Settings → General → Enable access policy) so the unprotected alias is not a way around Access. **P1-20 checks** that the free plan offers it; if not, the alias stays public and the static bundle holds no secret (a bundle is public by nature, DOC-41 §15).
- Build variables are set by the job (DOC-71 §8), not in the Pages dashboard.

### 5.5 Object store: SeaweedFS on the VPS (no R2)

DR-268, ADR-0027. One SeaweedFS per environment runs in Docker Compose on the VPS (service `seaweedfs`, §6.1): master, volume server, filer and S3 gateway in one `weed server` process set, as in the local stack (DOC-69). Two private buckets per environment keep the names of DR-83 item 8: `rms-<env>-files` and `rms-<env>-backup`. **Nothing here has been run.** The SeaweedFS version is the local stack's (`chrislusf/seaweedfs:4.48`, DR-231) until P1-20 verifies and records the release in DOC-11 (DR-268 item 2). A replica on another server is a later step and is **not** built (DR-268 item 4); the two buckets stay separate collections so that each can be replicated alone.

**1. The data volume.** SeaweedFS stores its data on a volume that is **not** the OS disk and **not** the PostgreSQL data directory, so one disk fault is not a total loss (DR-268 item 3). The device name and size come from §2 input 16.

```bash
lsblk                                                   # find the new device, e.g. /dev/vdb (name differs per provider)
mkfs.ext4 -L rms-data /dev/vdb                          # or xfs; P1-20 picks and records the file system
install -d -m 0755 /srv/rms-data
echo 'LABEL=rms-data /srv/rms-data ext4 defaults,nofail 0 2' >> /etc/fstab
mount /srv/rms-data && install -d -m 0755 /srv/rms-data/seaweedfs
findmnt /srv/rms-data                                   # expected: a device other than the root file system's
```

`nofail` keeps the host booting if the volume is missing; SeaweedFS then fails its health check instead of writing to the OS disk (the directory is created only after the mount, and a check in §14 proves the two are different devices). Disk-space and archive-failure alerts apply to this mount (DOC-10 §6.4, DOC-40).

**2. A private CA and the gateway certificate** (TLS on the bridge, DR-268 item 7). pgBackRest on the host reaches the gateway at the fixed bridge address `172.30.0.20` (§6.1) and must verify the certificate; the API and the Tunnel connector use the service name `seaweedfs`. One certificate therefore names both:

```bash
install -d -m 0750 -o deploy -g rms /etc/rms/tls && cd /etc/rms/tls
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1825 -subj "/CN=rms-staging-ca" -keyout ca.key -out ca.pem
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=seaweedfs" -keyout seaweedfs.key -out seaweedfs.csr
printf 'subjectAltName=DNS:seaweedfs,IP:172.30.0.20\n' > san.ext
openssl x509 -req -in seaweedfs.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 825 -extfile san.ext -out seaweedfs.pem
install -m 0440 -o deploy -g rms seaweedfs.key /etc/rms/secrets/seaweedfs-tls-key
# later, after pgBackRest is installed (§8.1): install -m 0644 -o postgres -g postgres /etc/rms/tls/ca.pem /etc/pgbackrest/seaweedfs-ca.pem   (§8.4)
shred -u seaweedfs.key seaweedfs.csr ca.key                       # the CA key is not kept on the host: re-create the CA to renew
```

(`ops/seaweedfs/tls.sh` holds these commands.) The validity periods above are a starting point; **P1-20 checks** the commands, the SAN handling and that SeaweedFS accepts the certificate and key through its S3 TLS options, and puts a calendar reminder for the certificate's expiry in §15. If SeaweedFS's S3 gateway cannot serve TLS in 4.48, the alternative is a TLS listener in front of it on the bridge (a second Caddy site, `tls` with this certificate); that choice is P1-20's and does not change anything else in this document.

**3. S3 identities.** The gateway reads a JSON identities file (the secret file `seaweedfs-s3-config`, §9.1) built from `ops/seaweedfs/s3-config.template.json`. Three identities, each limited to bucket(s) by SeaweedFS's `Action:bucket` form (**P1-20 checks** the exact syntax and that a cross-bucket request is refused, §14 check 18):

| Identity | Actions | Bucket | Used by | Stored as |
| --- | --- | --- | --- | --- |
| `rms-staging-files` | Read, Write, List, Tagging | `rms-staging-files` | The application (`api`, `worker`) | Host secrets `s3-access-key-id`, `s3-secret-access-key` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, DOC-41 §6) |
| `rms-staging-backup` | Read, Write, List | `rms-staging-backup` | pgBackRest on the host | `repo1-s3-key`, `repo1-s3-key-secret` in `/etc/pgbackrest/pgbackrest.conf` (§8.4). **Not** shared with the application (DOC-07 TB5); the files identity cannot read the backup bucket (DR-268 item 2) |
| `rms-staging-admin` | Admin | all | The operator, once, to create the buckets and the CORS rule (step 5) | A file in the operator's home during that step; removed from the identities file afterwards or kept only in the operator's custody (§9.3) |

The key pairs are random, made on the host (`keys:generate --out` for the application pair, as for local, DOC-69; the other two by `openssl rand`).

**4. The Tunnel route.** `files-staging.<domain>` → HTTPS `seaweedfs:8333` (§5.2). The DNS record is the Tunnel's own. The client-visible settings follow from it: `S3_PUBLIC_ENDPOINT=https://files-staging.<domain>` (§9.2), the web CMS's CSP and CORS name that host (DOC-39 §5.1 owes the line, DR-268), and the signed `Content-Type` of the presigned `PUT` is unchanged (DR-61, DR-268 item 6). Presigned POST is not relied on.

**5. Buckets and CORS**, after the first deploy has started the `seaweedfs` container (§11). The local stack does the same with the AWS CLI because SeaweedFS has no CLI for CORS (DOC-69 §6); on the host the one-shot runs on the `rms` network and trusts the private CA (the `aws-cli` image tag is the local stack's, `amazon/aws-cli:2.38.3`):

```bash
aws() { docker run --rm --network rms -v /etc/rms/tls/ca.pem:/ca.pem:ro -v /tmp/cors-files.json:/cors.json:ro \
  -e AWS_ACCESS_KEY_ID="$ADMIN_KEY" -e AWS_SECRET_ACCESS_KEY="$ADMIN_SECRET" -e AWS_DEFAULT_REGION=auto -e AWS_CA_BUNDLE=/ca.pem \
  amazon/aws-cli:2.38.3 --endpoint-url https://seaweedfs:8333 "$@"; }
aws s3api create-bucket --bucket rms-staging-files
aws s3api create-bucket --bucket rms-staging-backup
cat > /tmp/cors-files.json <<'EOF'
{ "CORSRules": [ { "AllowedOrigins": ["https://admin-staging.<domain>"], "AllowedMethods": ["GET", "PUT", "HEAD"],
  "AllowedHeaders": ["Content-Type"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3600 } ] }
EOF
aws s3api put-bucket-cors --bucket rms-staging-files --cors-configuration file:///cors.json
aws s3 ls                                                  # expected: both buckets
```

Neither bucket is public: there is no anonymous policy and the gateway is reachable only through the Tunnel route and the bridge. **P1-20 checks** the commands (the bucket-creation path, `put-bucket-cors` against 4.48 as in the local stack) and the identity syntax. The mobile apps do not need CORS; the web CMS does.

**6. Incomplete multipart uploads.** On R2 a lifecycle rule removed orphaned parts of a failed `archive-push`. Whether SeaweedFS removes them by itself, or offers a lifecycle rule, is **to verify in P1-20**; if not, the operator lists and aborts old multipart uploads of the backup bucket on a timer (`s3api list-multipart-uploads`) and the disk alert of §14 is the backstop.

**7. Firewall and exposure.** No `ports:` entry (§6.1) and no new `ufw` rule: the host reaches `172.30.0.20` over the bridge (outbound), the containers reach it on the same network. §14 check 17 proves that only the files host answers from outside.

## 6. Compose, start order, migrations, the deploy script

### 6.1 Compose files and profiles

The files are in `docker/` of each release: `compose.base.yml` (everything common), `compose.staging.yml` and `compose.production.yml` (limits, replicas, profiles). The project name is `rms`; the host's `/opt/rms/env/compose.env` selects them:

```
# /opt/rms/env/compose.env (staging)
COMPOSE_PROJECT_NAME=rms
RMS_ENV=staging
COMPOSE_PROFILES=
# production: RMS_ENV=production and COMPOSE_PROFILES=api2,logs
```

Profiles: `api2` starts `api-2`; `logs` starts `loki` and `alloy`; `deploy` holds the one-shot `migrate` service. **Staging runs without Loki and Alloy** (DOC-10 §6.1 gives the staging monitoring 0.6 GB and DR-06 lists Prometheus and Grafana only); logs there are read with `docker logs`. P1-18 starts the `logs` profile on staging for the check of DOC-11 §10 row 15 and stops it (DR-161; DOC-40 §3.2 says Alloy and Loki on each host, which this refines).

`docker/compose.base.yml`:

```yaml
name: rms

x-app: &app
  image: ghcr.io/<org>/rms-api:${RMS_TAG:?RMS_TAG is set by deploy.sh}
  user: "10001:10001"
  restart: unless-stopped
  read_only: true
  tmpfs: [/tmp]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  networks: [rms]
  extra_hosts: ["host.docker.internal:172.30.0.1"]       # the bridge gateway: PostgreSQL listens there (§8.2)
  env_file: [/opt/rms/env/app.env]
  volumes: ["/etc/rms/tls/ca.pem:/etc/rms/seaweedfs-ca.pem:ro"]   # the private CA of §5.5, read through NODE_EXTRA_CA_CERTS (§9.2)
  stop_grace_period: 60s                                  # longer than WORKER_STOP_TIMEOUT_SECONDS 40 + close (DOC-38 §5.4)
  healthcheck:
    test: ["CMD", "bun", "scripts/healthcheck.ts"]
    interval: 10s
    timeout: 3s
    retries: 3
    start_period: 20s
  logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }

x-third-party: &third
  restart: unless-stopped
  networks: [rms]
  group_add: ["10001"]                                    # reads the secret files (group rms, 0440)
  logging: { driver: json-file, options: { max-size: 10m, max-file: "5" } }

networks:
  rms: { external: true, name: rms }                      # created by hand in §4.6

secrets:
  db-app-url:                { file: /etc/rms/secrets/db-app-url }
  db-migrator-url:           { file: /etc/rms/secrets/db-migrator-url }
  db-readonly-url:           { file: /etc/rms/secrets/db-readonly-url }
  jwt-keys:                  { file: /etc/rms/secrets/jwt-keys }
  qr-keys:                   { file: /etc/rms/secrets/qr-keys }
  otp-hmac-key:              { file: /etc/rms/secrets/otp-hmac-key }
  settings-encryption-keys:  { file: /etc/rms/secrets/settings-encryption-keys }
  pii-encryption-keys:       { file: /etc/rms/secrets/pii-encryption-keys }
  s3-access-key-id:          { file: /etc/rms/secrets/s3-access-key-id }
  s3-secret-access-key:      { file: /etc/rms/secrets/s3-secret-access-key }
  smtp-password:             { file: /etc/rms/secrets/smtp-password }
  expo-access-token:         { file: /etc/rms/secrets/expo-access-token }
  demo-staff-password:       { file: /etc/rms/secrets/demo-staff-password }
  tunnel-token:              { file: /etc/rms/secrets/tunnel-token }
  seaweedfs-s3-config:       { file: /etc/rms/secrets/seaweedfs-s3-config }     # the identities of §5.5 (holds the backup and admin keys: only seaweedfs mounts it)
  seaweedfs-tls-key:         { file: /etc/rms/secrets/seaweedfs-tls-key }
  grafana-admin-password:    { file: /etc/rms/secrets/grafana-admin-password }
  telegram-bot-token:        { file: /etc/rms/secrets/telegram-bot-token }
  alertmanager-smtp-password: { file: /etc/rms/secrets/alertmanager-smtp-password }
  # SMS_* provider secrets: file names fixed in P1-22 after DR-68 records the provider

volumes: { caddy-data: {}, prometheus-data: {}, alertmanager-data: {}, grafana-data: {}, loki-data: {} }

services:
  api-1:
    <<: *app
    environment: { APP_ROLES: api, DATABASE_URL_FILE: /run/secrets/db-app-url }
    secrets: &api-secrets [db-app-url, jwt-keys, qr-keys, otp-hmac-key, settings-encryption-keys, pii-encryption-keys, s3-access-key-id, s3-secret-access-key, demo-staff-password]
  api-2:
    <<: *app
    profiles: [api2]
    environment: { APP_ROLES: api, DATABASE_URL_FILE: /run/secrets/db-app-url }
    secrets: *api-secrets
  worker:
    <<: *app
    environment: { APP_ROLES: worker, DATABASE_URL_FILE: /run/secrets/db-app-url }
    secrets: [db-app-url, settings-encryption-keys, s3-access-key-id, s3-secret-access-key, smtp-password, expo-access-token, demo-staff-password]
  migrate:                                                # one-shot, role rms_migrator (DR-113)
    <<: *app
    profiles: [deploy]
    restart: "no"
    user: "${DEPLOY_UID:?}:10001"                         # the owner of db-migrator-url (0400)
    healthcheck: { disable: true }
    command: ["bun", "scripts/migrate.ts"]
    environment: { APP_ROLES: migrate, MIGRATION_DATABASE_URL_FILE: /run/secrets/db-migrator-url }
    secrets: [db-migrator-url]
  caddy:
    <<: *third
    image: caddy:2.11.7
    user: "10001:10001"
    read_only: true
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 128m
    memswap_limit: 128m
    tmpfs: [/config]
    environment: { RMS_UPSTREAMS: "api-1:3000", RMS_CONFIG_HASH: "${RMS_CFG_CADDY:-}" }
    volumes:
      - /opt/rms/current/ops/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
    depends_on: { api-1: { condition: service_healthy } }
  seaweedfs:                                              # DR-268: files and the pgBackRest repository, no R2
    <<: *third
    image: chrislusf/seaweedfs:4.48                       # the local stack's tag; P1-20 verifies and records the release (DOC-11)
    command: >
      server -dir=/data -ip.bind=0.0.0.0 -filer -volume.max=8 -master.volumeSizeLimitMB=512
      -s3 -s3.port=8333 -s3.config=/run/secrets/seaweedfs-s3-config
      -s3.cert.file=/etc/seaweedfs/tls/seaweedfs.pem -s3.key.file=/run/secrets/seaweedfs-tls-key
    secrets: [seaweedfs-s3-config, seaweedfs-tls-key]
    networks: { rms: { ipv4_address: 172.30.0.20 } }      # fixed, so that pgBackRest on the host can reach it (§8.4); the CA names this IP
    volumes:
      - /srv/rms-data/seaweedfs:/data                     # the separate data volume (§5.5)
      - /etc/rms/tls/seaweedfs.pem:/etc/seaweedfs/tls/seaweedfs.pem:ro
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider --no-check-certificate https://127.0.0.1:8333/healthz"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 30s
  cloudflared:
    <<: *third
    image: cloudflare/cloudflared:2026.10.1
    command: tunnel --no-autoupdate run --token-file /run/secrets/tunnel-token
    secrets: [tunnel-token]
    depends_on: [caddy, seaweedfs]
  prometheus:
    <<: *third
    image: prom/prometheus:v3.15.1
    command: >
      --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus
      --storage.tsdb.retention.time=15d --storage.tsdb.retention.size=1800MB --web.enable-lifecycle
      --enable-feature=expand-external-labels
    environment: { RMS_ENV: "${RMS_ENV}", RMS_CONFIG_HASH: "${RMS_CFG_PROMETHEUS:-}" }
    volumes:
      - /opt/rms/current/ops/prometheus:/etc/prometheus:ro
      - prometheus-data:/prometheus
  alertmanager:
    <<: *third
    image: prom/alertmanager:v0.34.1
    command: --config.file=/etc/alertmanager/alertmanager.yml --storage.path=/alertmanager
    secrets: [telegram-bot-token, alertmanager-smtp-password]
    environment: { RMS_CONFIG_HASH: "${RMS_CFG_ALERTMANAGER:-}" }
    volumes:
      - /opt/rms/current/ops/alertmanager:/etc/alertmanager:ro
      - alertmanager-data:/alertmanager
  grafana:
    <<: *third
    image: grafana/grafana:13.2.4
    secrets: [grafana-admin-password]
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD__FILE: /run/secrets/grafana-admin-password
      GF_SERVER_ROOT_URL: "https://monitor${RMS_HOST_SUFFIX:-}.${RMS_DOMAIN:?}"
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_AUTH_ANONYMOUS_ENABLED: "false"
      GF_SECURITY_COOKIE_SECURE: "true"
      GF_ANALYTICS_REPORTING_ENABLED: "false"
      GF_ANALYTICS_CHECK_FOR_UPDATES: "false"
      RMS_CONFIG_HASH: "${RMS_CFG_GRAFANA:-}"
    volumes:
      - /opt/rms/current/ops/grafana/provisioning:/etc/grafana/provisioning:ro
      - /opt/rms/current/ops/grafana/dashboards:/var/lib/grafana/dashboards:ro
      - grafana-data:/var/lib/grafana
  postgres-exporter:
    <<: *third
    image: quay.io/prometheuscommunity/postgres-exporter:v0.20.1
    extra_hosts: ["host.docker.internal:172.30.0.1"]
    secrets: [db-readonly-url]
    entrypoint: ["/bin/sh", "-c", 'DATA_SOURCE_NAME="$$(cat /run/secrets/db-readonly-url)" exec /bin/postgres_exporter']
  node-exporter:
    <<: *third
    image: prom/node-exporter:v1.12.1
    command: >
      --path.rootfs=/host --collector.textfile.directory=/textfile
    volumes: ["/:/host:ro,rslave", "/var/lib/node_exporter/textfile:/textfile:ro"]
  loki:
    <<: *third
    profiles: [logs]
    image: grafana/loki:3.7.9
    command: -config.file=/etc/loki/config.yml
    environment: { RMS_CONFIG_HASH: "${RMS_CFG_LOKI:-}" }
    volumes: ["/opt/rms/current/ops/loki:/etc/loki:ro", "loki-data:/loki"]
  alloy:
    <<: *third
    profiles: [logs]
    image: grafana/alloy:v1.21.2
    command: run --server.http.listen-addr=0.0.0.0:12345 --storage.path=/var/lib/alloy/data /etc/alloy/config.alloy
    environment: { RMS_ENV: "${RMS_ENV}", RMS_CONFIG_HASH: "${RMS_CFG_ALLOY:-}" }
    volumes:
      - /opt/rms/current/ops/alloy/config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
```

Notes on the file:

- **No `ports:`** anywhere. Services reach each other by name on the `rms` network; the Tunnel reaches `caddy`, `grafana` and `seaweedfs` the same way (§5.2). `seaweedfs` is the only service with a fixed address (`172.30.0.20`), because the host's pgBackRest cannot resolve Docker names. Only the S3 port 8333 is meant to be used; the filer, master and volume ports stay on the network and have no route.
- **`seaweedfs`.** The service holds the bucket data on the data volume of §5.5 and is **not** recreated by a deploy unless its image tag or its secret changes (a recreate stops uploads and the WAL archive for a few seconds; the archive retries, §6.2). Every option on its `command` line is copied from the local stack (`-dir`, `-filer`, `-s3`, `-s3.port`, `-volume.max`, `-master.volumeSizeLimitMB`) or is **to verify in P1-20** (`-s3.config`, `-s3.cert.file`, `-s3.key.file`, the identity syntax, the health path over TLS, running as a non-root user with `read_only`). The value `-master.volumeSizeLimitMB=512` is the local value; production sizing follows the volume of §2 input 16.
- **Exact image tags** (DR-95), the versions of DOC-11 §7. The image of `api`, `worker` and `migrate` is `rms-api:${RMS_TAG}`, which `deploy.sh` sets.
- **Config hashes.** The bind mounts use the stable path `/opt/rms/current/…`, so Compose would not notice a changed config file. `deploy.sh` computes a hash of each `ops/<service>/` directory and passes it as `RMS_CFG_<SERVICE>`, which is an environment variable of the container: the container is recreated **only** when its configuration changed (DR-158).
- **Secrets.** Each service mounts only the files it needs; `db-migrator-url` appears only in `migrate` (DR-65, DR-113, CF-15). Inside a container a secret is `/run/secrets/<name>`, and the variable `X_FILE` names it (DOC-41 §2 rule 4).
- **Docker socket for Alloy.** Alloy reads container logs through the Docker API; a read-only mount of the socket does **not** limit the API, so a compromised Alloy is root on the host. Accepted for a read-only, outward-only collector from an official image (risk in §15).
- **`postgres-exporter`** reads the URL of `rms_readonly` from the secret file through a one-line entrypoint, because the exporter's own `_FILE` forms are for the user and the password separately. **P1-18 checks** the option names of `postgres_exporter` 0.20.1.

`docker/compose.staging.yml`:

```yaml
services:
  api-1:
    mem_limit: 1g
    memswap_limit: 1g
    environment: { DB_POOL_MAX: "15" }
  worker:
    mem_limit: 1536m
    memswap_limit: 1536m
    cpus: 1.0
    environment: { DB_POOL_MAX: "10", PDF_CONCURRENCY: "1" }
  prometheus:     { mem_limit: 300m, memswap_limit: 300m }
  alertmanager:   { mem_limit: 50m,  memswap_limit: 50m }
  grafana:        { mem_limit: 200m, memswap_limit: 200m }
  postgres-exporter: { mem_limit: 50m, memswap_limit: 50m }
  node-exporter:  { mem_limit: 50m, memswap_limit: 50m }
  seaweedfs:      { mem_limit: 512m, memswap_limit: 512m }      # provisional: P1-20 and EXP-07 set it, DOC-10 §6 gets the SeaweedFS budget (DR-268)
```

`docker/compose.production.yml`:

```yaml
services:
  api-1: { mem_limit: 1g, memswap_limit: 1g, environment: { DB_POOL_MAX: "20" } }
  api-2: { mem_limit: 1g, memswap_limit: 1g, environment: { DB_POOL_MAX: "20" } }
  caddy: { environment: { RMS_UPSTREAMS: "api-1:3000 api-2:3000" } }
  worker:
    mem_limit: 1536m
    memswap_limit: 1536m
    cpus: 2.0
    environment: { DB_POOL_MAX: "15", PDF_CONCURRENCY: "2" }
  prometheus:   { mem_limit: 400m, memswap_limit: 400m }
  alertmanager: { mem_limit: 50m,  memswap_limit: 50m }
  grafana:      { mem_limit: 200m, memswap_limit: 200m }
  loki:         { mem_limit: 200m, memswap_limit: 200m }
  alloy:        { mem_limit: 80m,  memswap_limit: 80m }
  postgres-exporter: { mem_limit: 50m, memswap_limit: 50m }
  node-exporter: { mem_limit: 50m, memswap_limit: 50m }
  seaweedfs:    { mem_limit: 768m, memswap_limit: 768m }      # provisional, as on staging
```

These are DR-06, DR-102 and DOC-10 §6.1 as numbers: the `cloudflared` limit is left open until EXP-07 measures it (DR-06), and the `seaweedfs` limits are provisional values that share the VPS with PostgreSQL (DR-268: the ceilings of DR-06 are rechecked by P1-20, EXP-07 and EXP-08). `memswap_limit` equal to `mem_limit` gives containers no swap.

### 6.2 Start order and health

| Order | Unit | Ready when | Waits for |
| --- | --- | --- | --- |
| 0 | PostgreSQL 18 (host, systemd) | `pg_isready -h 172.30.0.1` | Docker's bridge `br-rms` (§8.2: `After=docker.service`) |
| 0 | `seaweedfs` | `healthy` (the S3 port answers over TLS) | The data volume mounted (§5.5), the network `rms` |
| 1 | `migrate` (a deploy only) | Exits 0 | PostgreSQL |
| 2 | `api-1` | `healthy` (`/health/ready` on the ops port answers 200) | Migrations |
| 3 | `caddy` | Its health check passes an upstream | `api-1` healthy (`depends_on`) |
| 4 | `cloudflared` | The Tunnel shows **Healthy** in the dashboard | `caddy` |
| 5 | `api-2` (production) | `healthy` | After `api-1` in a rolling deploy |
| 6 | `worker` | `healthy` (relay finished a pass, DOC-38 §5.2) | |
| any | Monitoring | Prometheus targets up | |

**After a host reboot** Docker restarts every container (`restart: unless-stopped`) at the same moment, and PostgreSQL starts after Docker (it needs the bridge). `api` and `worker` therefore start before the database answers. The requirement on the application is: **the first connection is retried for 30 seconds, then the process exits with code 1** and Docker restarts it; `/health/ready` is 503 until the database answers (E-02). PostgreSQL's `archive_command` fails until `seaweedfs` is up and retries (pgBackRest's async archive keeps the WAL in the spool and `pg_wal`); after a reboot the archive resumes by itself, which §14 check 9 includes. P1-04 implements and tests that (DOC-38 §5.1, DR-248: the ops port answers 503 during the wait); §14 check 9 proves the whole reboot.

Health, at three levels:

| Level | What | By |
| --- | --- | --- |
| Container | `bun scripts/healthcheck.ts` → `GET http://localhost:3001/health/ready` | Docker, every 10 s |
| Upstream | Caddy's active check: `health_uri /health/ready`, `health_port 3001`, every 5 s (§7.1) | Caddy |
| External | The uptime probe: `GET https://api(-staging).<domain>/api/v1/health/ready` every 60 s (NFR-10) | An external service (§2 input 12) |

### 6.3 Migrations

Migrations are a separate step of a deploy, never run at application boot (DOC-14 §14, DR-08). `docker compose run --rm migrate` runs `bun scripts/migrate.ts` in the new image as role `rms_migrator`:

1. read `MIGRATION_DATABASE_URL_FILE`; connect with `prepare: false`;
2. `0000-bootstrap.sql` (idempotent), the pending migrations of every module in catalog order, then `0900-grants.sql` in one transaction (DOC-19 §3.1, steps 2 to 4);
3. print `migrated: <n> pending applied, <k> schemas` and `grants applied`; exit 0, or non-zero on the first failure (built in P1-06).

The step runs **before** the containers of the new image start and while the old ones serve. That is safe only because of expand then contract (DR-08, original SDD §16.3): the old image works against a schema that has gained a column, a table or an index. A migration that cannot satisfy this is a **contract** step and uses the maintenance flag (§6.4). The `migrate` container runs as the uid of `deploy` so it can read the 0400 secret file; the file is mounted into no other container.

Connection budget during a deploy: `rms_migrator` has a limit of 3 and the migration step uses 1 (DOC-10 §6.3, DOC-19 §2.1).

### 6.4 Maintenance flag

`platform.maintenance` is not part of a routine deploy (DR-05). For a contract migration that cannot be backward compatible, `deploy.sh --maintenance <tag>` wraps steps 3 to 5 of §6.5:

```bash
ops/deploy/maintenance.sh on  "Planned maintenance, back at 14:30"    # UPDATE platform.maintenance … as rms_migrator
ops/deploy/deploy.sh --maintenance sha-1a2b3c4
ops/deploy/maintenance.sh off
```

While it is on every process answers 503 `maintenance`; `/api/v1/health/ready` stays 200 with `"maintenance": true`, so the uptime probe does not page (E-02). Only `rms_migrator` can write the row; the script runs the statement in the `migrate` container with the migrator secret (DOC-17 §3.4, DOC-19 §6). The window is announced beforehand and subtracted from the availability figure (DR-80).

### 6.5 The deploy script

`ops/deploy/deploy.sh`, run on the host as `deploy`, called by CI over the Tunnel (DOC-71 §7.2). The contract is DOC-71 §7.2; this is the implementation. CI uploads `docker/` and `ops/` as `/opt/rms/incoming/<tag>.tgz` and then **streams the script of that commit** to the host (`ssh host "bash -s -- <tag>" < ops/deploy/deploy.sh`), so no copy of the script has to exist on the host before the first deploy and the script is always the one of the release it deploys. An operator who is on the host runs the copy inside the release: `/opt/rms/current/ops/deploy/deploy.sh <tag>`.

```bash
#!/usr/bin/env bash
# usage: deploy.sh <tag> | --rollback | --maintenance <tag>
set -euo pipefail
RMS=/opt/rms; STATE=/var/lib/rms/deploy-state
. "$RMS/env/compose.env"
export RMS_TAG RMS_ENV COMPOSE_PROFILES DEPLOY_UID="$(id -u)"
started=$(date +%s)
step() { echo "step $1/6 $2"; }
fail() { echo "deploy failed at step $1"; exit 1; }

case "${1:-}" in
  --rollback) tag=$(sed -n 's/^previous=//p' "$STATE"); [ -n "$tag" ] || { echo "no previous tag"; exit 1; } ;;
  --maintenance) maint=1; tag="${2:?tag}" ;;
  "") echo "usage: deploy.sh <tag> | --rollback | --maintenance <tag>"; exit 2 ;;
  *) tag="$1" ;;
esac
RMS_TAG="$tag"
current=$(sed -n 's/^current=//p' "$STATE" 2>/dev/null || true)

# 1. unpack the release and point /opt/rms/current at it
step 1 unpack
if [ ! -d "$RMS/releases/$tag" ]; then
  mkdir -p "$RMS/releases/$tag"
  tar -xzf "$RMS/incoming/$tag.tgz" -C "$RMS/releases/$tag" || fail 1
fi
ln -sfn "$RMS/releases/$tag" "$RMS/current"
cd "$RMS/current"
dc() { docker compose --env-file "$RMS/env/compose.env" -f docker/compose.base.yml -f "docker/compose.$RMS_ENV.yml" "$@"; }
for d in caddy prometheus alertmanager grafana loki alloy; do      # a hash of each service's configuration
  v="RMS_CFG_$(echo "$d" | tr a-z A-Z)"
  export "$v=$(find "ops/$d" -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null | sha256sum | cut -c1-16)"
done

# 2. pull images
step 2 pull
docker pull "ghcr.io/<org>/rms-api:$tag" >/dev/null || fail 2
dc pull --quiet --ignore-buildable caddy seaweedfs cloudflared prometheus alertmanager grafana postgres-exporter node-exporter || fail 2

# 3. migrations (maintenance on first when asked)
[ "${maint:-0}" = 1 ] && "$RMS/current/ops/deploy/maintenance.sh" on "Planned maintenance"
step 3 migrate
dc run --rm migrate || fail 3

# 4. edge and monitoring services (recreated only when their config hash changed)
step 4 infrastructure
dc up -d --no-deps caddy seaweedfs cloudflared postgres-exporter node-exporter prometheus alertmanager grafana || fail 4
[[ ",$COMPOSE_PROFILES," == *",logs,"* ]] && { dc up -d --no-deps loki alloy || fail 4; }

# 5. rolling restart: api-1 -> ready -> api-2 -> ready -> worker
step 5 rolling
wait_healthy() {   # name, timeout seconds
  local t=$(( $(date +%s) + ${2:-90} ))
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "rms-$1-1" 2>/dev/null)" = healthy ]; do
    [ "$(date +%s)" -lt "$t" ] || return 1; sleep 3
  done
}
for svc in api-1 api-2 worker; do
  if [ "$svc" = api-2 ] && [[ ",$COMPOSE_PROFILES," != *",api2,"* ]]; then continue; fi
  dc up -d --no-deps --force-recreate "$svc" || fail 5
  wait_healthy "$svc" 90 || { echo "$svc not healthy"; fail 5; }
done
[ "${maint:-0}" = 1 ] && "$RMS/current/ops/deploy/maintenance.sh" off

# 6. record the state, prune old releases
step 6 record
if [ "$current" != "$tag" ]; then printf 'current=%s\nprevious=%s\n' "$tag" "${current:-none}" > "$STATE"; fi
ls -1dt "$RMS"/releases/* | tail -n +6 | xargs -r rm -rf          # keep 5 releases
rm -f "$RMS"/incoming/*.tgz
echo "deploy ok $tag in $(( $(date +%s) - started )) s"
```

What it guarantees, and does not:

- It stops at the first failing step and prints its number (`deploy failed at step 3`); it does **not** roll back by itself. After a failed step 3 nothing of the new image runs and the old one still serves. After a failed step 5 the schema is expanded and the previous image works with it; the operator runs `deploy.sh --rollback` (DOC-71 §7.6).
- A **rollback** of the API is the same script with the tag stored as `previous`: unpack is skipped (the release directory still exists), the migration step finds nothing pending (the schema is not rolled back), the containers are recreated with the old image. It is **not** a rollback of a contract migration (DOC-71 §7.6).
- The container names `rms-<service>-1` are Compose's, with the project name `rms`.
- Two deploys never overlap: CI queues them (DOC-71 §3 rule 4) and the script takes `flock /var/lock/rms-deploy.lock` as its first line (P1-20 adds it).

`ops/deploy/smoke.sh <env>` is the test of DOC-71 §7.3; it runs on the CI runner against the public hosts, with `curl` and `jq`:

```bash
#!/usr/bin/env bash
# usage: smoke.sh staging|production   (env: DOMAIN, STAGING_DEMO_PASSWORD, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET)
set -euo pipefail
env="$1"; sfx=$([ "$env" = staging ] && echo -staging || echo ""); api="https://api$sfx.$DOMAIN"; admin="https://admin$sfx.$DOMAIN"
ok() { echo "smoke ok: $1"; }; bad() { echo "smoke FAILED: $1"; exit 1; }
for i in $(seq 1 12); do                                            # 1. ready, retried for 60 s
  curl -fsS "$api/api/v1/health/ready" | jq -e '.status=="ok" and .maintenance==false' >/dev/null && break
  [ "$i" = 12 ] && bad "ready"; sleep 5
done; ok ready
curl -fsS -D- -o /tmp/cfg.json "$api/api/v1/public/config" | grep -qi 'cache-control: public, max-age=60' || bad "config cache header"
jq -e '.apps.resident.minVersion and .apps.staff.minVersion' /tmp/cfg.json >/dev/null || bad "config body"; ok config
[ "$(curl -s -o /dev/null -w '%{http_code}' "$api/api/v1/health/live")" = 404 ] || bad "ops route is public"; ok "ops route not public"
curl -fsS -D- -o /dev/null -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" "$admin/" \
  | grep -qi '^content-security-policy:' || bad "admin CSP"; ok "admin headers"
if [ "$env" = staging ]; then                                       # sign-in only on staging
  tok=$(curl -fsS -X POST "$api/api/v1/auth/staff/login" -H 'Content-Type: application/json' -H 'X-App-Id: staff' -H 'X-App-Version: 1.0.0' \
        -d "{\"email\":\"manager@demo.rms.invalid\",\"password\":\"$STAGING_DEMO_PASSWORD\",\"client\":\"app\"}")
  echo "$tok" | jq -e '.accessToken and .refreshToken' >/dev/null || bad "staff login"
  curl -fsS -o /dev/null -X POST "$api/api/v1/auth/logout" -H 'Content-Type: application/json' -H 'X-App-Id: staff' -H 'X-App-Version: 1.0.0' \
       -d "{\"refreshToken\":$(echo "$tok" | jq .refreshToken)}" || bad "logout"; ok "sign-in and sign-out"
fi
echo "smoke passed ($env)"
```

The request and response shapes are E-02, E-03, E-05 and E-12 (DOC-51); step 7 of DOC-71 §7.3 (container health) is the end of `deploy.sh`. The version `1.0.0` in the header is the minimum of `MIN_APP_VERSION_STAFF`; the script reads it from `public/config` in a refinement P1-20 makes if the minimum is raised.

### 6.6 Rollback timing

The rollback target is **10 minutes or less** (DR-08, DR-83 item 9). Steps and planned times: start the workflow and connect through the Tunnel 1 min; `deploy.sh --rollback` (no pull when the image is on the host, containers recreated one by one with health waits) about 3 min; smoke test 1 min. **Measured:** not yet. P1-20 measures staging and P6-13 production, and writes the result here with the date.

### 6.7 One-shot containers on the compose network (experiments)

The experiments that need the real host (EXP-09 first, DOC-98; EXP-01, 02, 05, 06, 12 later; DOC-88 §12) run as one-shot containers attached to the application network. The names they rely on are fixed here:

| Name | Value |
| --- | --- |
| Docker network | `rms` (created by hand in §4.6; external to Compose) |
| Container names | `rms-<service>-1`: `rms-api-1-1`, `rms-worker-1`, `rms-caddy-1`, `rms-prometheus-1`, … |
| API through Caddy, as Cloudflare would send it | `http://caddy/api/v1` (the harness sets `CF-Connecting-IP` itself; Caddy and the API believe it because the peer is inside the trusted private range, DOC-39 §5.3) |
| Prometheus | `http://prometheus:9090` (queried from inside the network; no port is published) |
| PostgreSQL | `host.docker.internal`, which a container on this network must map explicitly: `--add-host host.docker.internal:172.30.0.1` (the value `host-gateway` would resolve to the default bridge, where PostgreSQL does not listen) |
| Secret files an experiment may mount read-only | `/etc/rms/secrets/db-app-url` (a read-only `SELECT` as `rms_app`); a per-experiment file such as `/etc/rms/secrets/exp-manager`, made for the run and deleted after it |
| Source of the commit under test | `/opt/rms/src/<commit>`, copied from a checkout over the Tunnel with `git archive <commit> \| ssh ops@ssh-staging.<domain> 'mkdir -p /opt/rms/src/<commit> && tar -x -C /opt/rms/src/<commit>'` (the host holds no Git credentials and no clone); the experiment container installs its dependencies with `bun install --frozen-lockfile` and runs `bun run exp:NN` |
| Image | `oven/bun:1.4.3` (the exact tag of DOC-11 §1); never the production `rms-api` image, which has no test code |

An experiment never runs while a deploy is in progress and EXP-07 and EXP-08 never run together (DR-102). The run does not change the compose project: a one-shot container is `docker run --rm`, not a service.

## 7. Caddy and the Tunnel

### 7.1 `ops/caddy/Caddyfile`

Plain HTTP inside the host; TLS ends at Cloudflare (DR-83 item 3, DR-07). Caddy trusts the private Docker ranges and passes `CF-Connecting-IP`, which the application reads (DOC-39 §5.3). The headers are those of DOC-39 §5.1.

```
{
	auto_https off
	admin off
	servers {
		trusted_proxies static private_ranges
		trusted_proxies_strict
	}
}

(upstream) {
	reverse_proxy {$RMS_UPSTREAMS} {
		lb_policy least_conn
		health_uri /health/ready
		health_port 3001
		health_interval 5s
		health_timeout 2s
		health_status 200
		fail_duration 10s
		{args[0]}
	}
}

:80 {
	request_body {
		max_size 2MB
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		-Server
	}
	@notdocs not path /api/v1/docs*
	header @notdocs Content-Security-Policy "default-src 'none'; frame-ancestors 'none'"

	log {
		output stdout
		format json
	}

	@sse path /api/v1/staff/events
	handle @sse {
		import upstream "flush_interval -1"
	}
	handle {
		import upstream ""
	}
}
```

Points to know:

- `request_body max_size 2MB`: a larger body gets **413** from Caddy before it reaches the application (Caddy documentation); uploads go to SeaweedFS by presigned `PUT` through `files.<domain>`, a Tunnel route that does not pass Caddy (§5.2), so the API never receives a video (DR-07, DR-268).
- **SSE** (`GET /api/v1/staff/events`, E-xxx of DOC-52): `flush_interval -1` disables buffering. The application sends a heartbeat every 25 s (`SSE_HEARTBEAT_SECONDS`) because Cloudflare closes a proxied request that receives no data for 100 s (DR-83 item 10).
- **Health check on the ops port:** `health_port 3001` with `health_uri /health/ready` checks the same endpoint as Docker without routing the ops port to the world (DR-07). An upstream that fails is skipped for `fail_duration`.
- **`-Server`** removes the `Server` header. The app's `Cache-Control` and `ETag` are not touched (DOC-39 §5.1).
- **Logging.** Caddy writes one JSON access line per request to stdout (Alloy collects it in production). Caddy replaces `Authorization` and `Cookie` header values with `REDACTED` unless `log_credentials` is enabled; it is not. **P1-20 checks** one real line (DOC-39, never logged: tokens). The application already logs a request line with the request id (DOC-40 §3), so Caddy's line is for the cases the application never saw (a 413, a 502).
- **`RMS_UPSTREAMS`**: `api-1:3000` on staging, `api-1:3000 api-2:3000` on production (§6.1).
- **`:80`** is the only listener and is reachable only on the `rms` network. The `Caddyfile` is validated in CI with `docker run --rm -v ./ops/caddy:/etc/caddy caddy:2.11.7 caddy validate --config /etc/caddy/Caddyfile` (DOC-71 stage `verify`, P1-19).

### 7.2 The Tunnel

The Tunnel is remote-managed (§5.2): the routes live in Cloudflare, not in a file. The table of §5.2 (api, monitor, ssh and files) is the source of truth and is copied into `ops/cloudflared/README.md`; the Caddyfile does not change for DR-268 (the files host does not pass Caddy); a change of a route is a change to that table in the same pull request. The connector is the container of §6.1, started with `--token-file` (**P1-20 checks** the flag on `cloudflared` 2026.10.1 and falls back to the `TUNNEL_TOKEN` environment variable read through an entrypoint, as for the exporter). `--no-autoupdate` keeps the version pinned by DR-95: the image tag is the update path.

A second connector replica for the same Tunnel is **not** run: the VPS is the single point (DR-83). Cloudflare shows the Tunnel as *Down* when the VPS or the container stops; the external probe (§6.2) is what pages.

## 8. PostgreSQL and pgBackRest

### 8.1 Install PostgreSQL 18 natively

From the PostgreSQL project's apt repository (DR-83 item 6; the package for Ubuntu 26.04 is `postgresql-18` 18.6, DOC-11 §1). Contrib modules `pg_trgm`, `unaccent` and `citext` are part of that package; **P1-20 checks** `CREATE EXTENSION` on the host (DOC-11 §1).

```bash
install -d /usr/share/postgresql-common/pgdg
curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update
# do not create the default cluster: it would take the host's locale and the default listen address
install -d /etc/postgresql-common && echo 'create_main_cluster = false' > /etc/postgresql-common/createcluster.conf
apt-get -y install postgresql-18 pgbackrest                      # pgBackRest from PGDG: 2.59.3 today (DR-93)
pg_createcluster 18 main --locale=C.UTF-8 --encoding=UTF8 -- --data-checksums
apt-mark hold postgresql-18 pgbackrest                           # a restart is planned, §4.5
```

The cluster locale is `C.UTF-8` with data checksums on (DR-162): Vietnamese sorting is done in the application and text search uses `unaccent` and trigrams (DOC-14 §13, DOC-19 §3). `psql --version` should print 18.6; the repository state is checked as in DOC-11 §12 step 5.

### 8.2 Listen address and ordering

PostgreSQL listens on the loopback and on the Docker bridge's gateway only (DR-83 item 6). The bridge exists only after Docker has started, so the service starts after Docker:

```bash
install -d /etc/systemd/system/postgresql@18-main.service.d
install -m 0644 ops/host/postgres-override.conf /etc/systemd/system/postgresql@18-main.service.d/override.conf
```

```
[Unit]
After=docker.service
Wants=docker.service

[Service]
OOMScoreAdjust=-900
```

`OOMScoreAdjust=-900` is DR-102. The ordering is the reason the application waits for the database at boot (§6.2).

### 8.3 Configuration

`ops/postgres/rms.conf` → `/etc/postgresql/18/main/conf.d/rms.conf` (the packaged `postgresql.conf` includes `conf.d`):

```
listen_addresses = 'localhost,172.30.0.1'
port = 5432
password_encryption = scram-sha-256
timezone = 'UTC'
log_timezone = 'UTC'

# memory and connections: staging | production (DR-06, DR-102)
shared_buffers = 512MB          # production: 1GB
effective_cache_size = 1GB      # production: 3GB
max_connections = 60            # production: 100
work_mem = 8MB
maintenance_work_mem = 128MB
random_page_cost = 1.1

# WAL and the archive (DR-66: RPO <= 5 minutes)
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=rms archive-push %p'
archive_timeout = 60
max_wal_size = 2GB
min_wal_size = 256MB
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9

# diagnostics
log_min_duration_statement = 500
log_lock_waits = on
log_checkpoints = on
log_line_prefix = '%m [%p] %u@%d '
```

`archive_timeout = 60` forces a WAL switch each minute so the archive trails the database by at most about a minute plus the upload time. The per-role defaults (statement and lock timeouts, connection limits) are set by `0001-provision.sql` (DOC-19 §3). `max_connections` follows DOC-10 §6.3 (38 of 60 used on staging, 69 of 100 on production). Two files differ per environment: the three values commented above.

`pg_hba.conf` and `pg_ident.conf` are DOC-19 §7 as written, with `<docker-subnet>` = `172.30.0.0/24`:

```bash
install -m 0640 -o postgres -g postgres ops/postgres/pg_hba.conf   /etc/postgresql/18/main/pg_hba.conf
install -m 0640 -o postgres -g postgres ops/postgres/pg_ident.conf /etc/postgresql/18/main/pg_ident.conf
install -m 0644 ops/postgres/rms.conf /etc/postgresql/18/main/conf.d/rms.conf
systemctl daemon-reload && systemctl restart postgresql@18-main
sudo -u postgres psql -c 'show listen_addresses' -c 'show shared_buffers' -c 'show archive_mode'
# expected: localhost,172.30.0.1 ; 512MB ; on   (archive_mode on needs the stanza of §8.4 and a running `seaweedfs` before it archives: do §8.4's stanza step after the first deploy, §11)
```

### 8.4 Roles, the database, the stanza

```bash
# the password files exist already (§9.1); the provisioning script receives them as psql variables (DOC-19 §3)
sudo -u postgres psql -v ON_ERROR_STOP=1 -v db=rms -v app_conn_limit=45 \
  -v migrator_password="$(cat /etc/rms/secrets/db-migrator-password)" \
  -v app_password="$(cat /etc/rms/secrets/db-app-password)" \
  -v readonly_password="$(cat /etc/rms/secrets/db-readonly-password)" \
  -f ops/postgres/0001-provision.sql
# expected: CREATE ROLE ×4, CREATE DATABASE, GRANT …; no ERROR
```

`app_conn_limit` is 45 on staging and 80 on production (DR-113). The password files must be readable by `ops` for this one command (the operator runs it with `sudo cat`); they are root-equivalent secrets already.

pgBackRest, as `ops/pgbackrest/pgbackrest.conf.template` → `/etc/pgbackrest/pgbackrest.conf` (owner `postgres`, 0600) with the values filled in. The repository is the SeaweedFS S3 gateway of §5.5, over TLS on the Docker bridge (DR-268 item 7); **this exact combination is unproven until P1-20**:

```
[global]
repo1-type=s3
repo1-s3-endpoint=172.30.0.20:8333
repo1-s3-bucket=rms-staging-backup
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-storage-ca-file=/etc/pgbackrest/seaweedfs-ca.pem
repo1-s3-key=<access key id of the backup identity>
repo1-s3-key-secret=<secret access key of the backup identity>
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=<passphrase, 32 random bytes in base64>
repo1-retention-full=4
repo1-retention-diff=7
archive-async=y
spool-path=/var/spool/pgbackrest
compress-type=zst
start-fast=y
process-max=2
log-level-console=info

[rms]
pg1-path=/var/lib/postgresql/18/main
pg1-socket-path=/var/run/postgresql
pg1-database=rms
pg1-user=rms_backup
```

Option names and meanings were read in the pgBackRest configuration reference (2026-10-20): `repo-s3-uri-style` is `host` by default and `path` addresses the bucket in the path; `repo-cipher-type` is `none` or `aes-256-cbc` and encryption is client-side; `repo-retention-full` and `repo-retention-diff` are counts; `archive-async` defaults to `n`; `spool-path` defaults to `/var/spool/pgbackrest`. `repo-storage-ca-file` (a file of CA certificates for the repository's TLS) is in the same reference as the S3 and TLS options; **P1-20 checks** it on 2.59.3. The endpoint by IP (`172.30.0.20:8333`, which the certificate of §5.5 names) avoids a DNS entry on the host; the region is any fixed string (`auto` as for the application, DOC-41 §6); the `path` style is required because there is no wildcard DNS for bucket names. pgBackRest's own `archive-timeout` (default 1 minute) is the wait for a segment to reach the repository; it is a different setting from PostgreSQL's `archive_timeout` above. **P1-20 proves** that archiving, a full backup, a differential, `check` and a restore on an empty host work against this gateway, and that the gateway keeps up with a WAL segment every 60 s with `archive-async=y`.

**Fallback if it does not work: a POSIX repository on the backup volume** (DR-268 item 7). The mechanism does not change (schedule, retention, encryption, `archive_command`); only the repository lines do, and the SeaweedFS `rms-<env>-backup` bucket and the backup identity are then not used:

```
repo1-type=posix
repo1-path=/srv/rms-data/pgbackrest          # on the separate data volume, owned by postgres
```

**Key custody (DR-268 item 2).** The passphrase `repo1-cipher-pass` and the backup identity's key pair are generated on the host and a **sealed copy of each is kept offline by the Owner, off the VPS** (§2 input 14, §9.3, DR-65): an encrypted repository that is copied off the VPS later (the replica, an operator-held `pg_dump`) is readable only with the passphrase, and the host's own copy is lost with the host. Losing the passphrase makes every backup unreadable.

```bash
install -d -o postgres -g postgres -m 0750 /var/spool/pgbackrest /var/lib/node_exporter/textfile
sudo -u postgres pgbackrest --stanza=rms stanza-create           # expected: stanza-create command end: completed successfully
sudo -u postgres pgbackrest --stanza=rms check                   # expected: check command end: completed successfully
sudo -u postgres pgbackrest --stanza=rms --type=full backup      # expected: backup command end: completed successfully
sudo -u postgres pgbackrest info                                 # shows one full backup and the WAL range
```

### 8.5 Backup schedule

systemd timers with an explicit time zone (the host runs UTC; the schedule is in building time):

```
# /etc/systemd/system/rms-backup@.service
[Unit]
Description=pgBackRest %i backup
After=postgresql@18-main.service
[Service]
Type=oneshot
User=postgres
ExecStart=/usr/local/sbin/rms-backup %i
TimeoutStartSec=3h

# /etc/systemd/system/rms-backup@full.timer          # Sunday 02:00 Asia/Ho_Chi_Minh
[Timer]
OnCalendar=Sun *-*-* 02:00:00 Asia/Ho_Chi_Minh
Persistent=true
[Install]
WantedBy=timers.target

# /etc/systemd/system/rms-backup@diff.timer          # Monday to Saturday 02:00
[Timer]
OnCalendar=Mon..Sat *-*-* 02:00:00 Asia/Ho_Chi_Minh
Persistent=true
```

`/usr/local/sbin/rms-backup` (`ops/backup/backup.sh`):

```bash
#!/usr/bin/env bash
set -euo pipefail
type="${1:?full|diff}"
pgbackrest --stanza=rms --type="$type" backup
d=/var/lib/node_exporter/textfile
t=$(mktemp "$d/.backup.XXXXXX")
printf '# TYPE backup_last_success_timestamp gauge\nbackup_last_success_timestamp %s\n' "$(date +%s)" > "$t"
chmod 0644 "$t" && mv "$t" "$d/backup.prom"                      # the metric of DR-154, written after a success only
```

```bash
systemctl enable --now rms-backup@full.timer rms-backup@diff.timer
systemctl list-timers 'rms-backup*'                              # two timers with the next run times
```

Full weekly, differential daily and continuous WAF… archive are DR-66. The weekly `pg_dump` (the portable copy), its encryption on the host, the retention of four weeks, the restore and the drill are **DOC-72** (P6). The risk that the database, the files and the backups share one VPS (DR-268; it replaces the shared-provider-account risk of DR-66) is recorded there and in §15.

## 9. Secrets and environment

### 9.1 The secret files

One file per secret under `/etc/rms/secrets`, mode 0440, owner `deploy`, group `rms` (gid 10001); the application containers run as uid 10001 and the third-party containers get `group_add: ["10001"]`, so the group read works (DR-158, revising the "root, 0400" of DR-65, which only a root container could read). `db-migrator-url` and the three role-password files are 0400 and owned by `deploy`. DR-65, DOC-39 §7 and DOC-41 §6 list the application secrets; the rows marked ¹ are infrastructure secrets outside DR-65 (DOC-07 §7.2).

| File | Becomes | Mounted into | Generated by |
| --- | --- | --- | --- |
| `db-app-url`, `db-migrator-url` | `DATABASE_URL_FILE`, `MIGRATION_DATABASE_URL_FILE` | `api-*`, `worker`; `migrate` only | `keys:generate --out` |
| `db-readonly-url` | read by the exporter's entrypoint | `postgres-exporter` | the same |
| `db-app-password`, `db-migrator-password`, `db-readonly-password` | psql variables of §8.4 | none | the same |
| `jwt-keys`, `qr-keys`, `otp-hmac-key` | `JWT_KEYS_FILE`, `QR_KEYS_FILE`, `OTP_HMAC_KEY_FILE` | `api-*` | the same |
| `settings-encryption-keys`, `pii-encryption-keys` | `SETTINGS_ENCRYPTION_KEYS_FILE` (`api-*`, `worker`), `PII_ENCRYPTION_KEYS_FILE` (`api-*`) | as named | the same |
| `s3-access-key-id`, `s3-secret-access-key` | `S3_ACCESS_KEY_ID_FILE`, `S3_SECRET_ACCESS_KEY_FILE` | `api-*`, `worker` | The files identity of §5.5 |
| `smtp-password`, `expo-access-token`, `sms-*` | `SMTP_PASSWORD_FILE`, `EXPO_ACCESS_TOKEN_FILE`, `SMS_*_FILE` | `worker` | the providers (P1-22) |
| `demo-staff-password` | `DEMO_STAFF_PASSWORD_FILE` | `api-*`, `worker` | `keys:generate --out` (≥ 12 characters) |
| `tunnel-token` ¹ | `--token-file` | `cloudflared` | Cloudflare (§5.2) |
| `seaweedfs-s3-config` ¹ | `-s3.config` (the identities JSON: files, backup and admin keys) | `seaweedfs` only | Built by the operator from `ops/seaweedfs/s3-config.template.json` (§5.5) |
| `seaweedfs-tls-key` ¹ | `-s3.key.file` | `seaweedfs` only | `openssl` (§5.5) |
| `grafana-admin-password` ¹ | `GF_SECURITY_ADMIN_PASSWORD__FILE` | `grafana` | `keys:generate --out` |
| `telegram-bot-token`, `alertmanager-smtp-password` ¹ | read by `alertmanager.yml` as `bot_token_file`, `smtp_auth_password_file` | `alertmanager` | the bot and the second mail account (§2 input 11) |
| `/etc/pgbackrest/pgbackrest.conf` ¹ | the SeaweedFS backup key and the repository passphrase | pgBackRest on the host | §8.4 |
| GHCR read token ¹ | `~deploy/.docker/config.json` | Docker on the host | §4.7 |

The key names of `alertmanager.yml` (`bot_token_file`, `smtp_auth_password_file`) are **P1-18 checks** against Alertmanager 0.34.1 (DOC-40 §6 already lists the Telegram keys as open).

Generate the application files on the host from the image, so the keys are never created on a laptop or in CI:

```bash
sudo install -d -m 0750 -o deploy -g rms /etc/rms/secrets
sudo -u deploy docker run --rm -u 10001:10001 -v /etc/rms/secrets:/out ghcr.io/<org>/rms-api:sha-<7> \
  bun scripts/keys-generate.ts --out /out --env staging --db-host host.docker.internal
sudo chown deploy:rms /etc/rms/secrets/* && sudo chmod 0440 /etc/rms/secrets/*
sudo chmod 0400 /etc/rms/secrets/db-migrator-url /etc/rms/secrets/db-*-password
ls -l /etc/rms/secrets | head                                      # mode -r--r----- and owner deploy rms
```

Expected: `created 17 files` (the two `seaweedfs-*` files above are made by the operator in §5.5, not by `keys:generate`; P1-20 may extend it); a second run prints `kept 17 files` and changes nothing (CF-16). `--env staging` and `production` make `keys:generate` refuse a plain `.env.local` form (DOC-41 §2 rule 4).

### 9.2 Non-secret environment

`/opt/rms/env/app.env` is read by `api`, `worker` and `migrate`; it holds the keys of DOC-41 that differ from the defaults. Staging:

```
APP_ENV=staging
LOG_LEVEL=info
TRUSTED_PROXY_HOPS=1
TRUSTED_PROXY_CIDRS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128,fc00::/7
CORS_ORIGINS=https://admin-staging.<domain>
ADMIN_BASE_URL=https://admin-staging.<domain>
APP_DOWNLOAD_URL=<the page that links the staging builds>
OPENAPI_ENABLED=true
S3_ENDPOINT=https://seaweedfs:8333
S3_PUBLIC_ENDPOINT=https://files-staging.<domain>
S3_REGION=auto
S3_BUCKET=rms-staging-files
S3_FORCE_PATH_STYLE=true
NODE_EXTRA_CA_CERTS=/etc/rms/seaweedfs-ca.pem
SMS_DRIVER=allowlist
MAIL_DRIVER=allowlist
SMS_ALLOWLIST=<test phones, comma separated, E.164>
MAIL_ALLOWLIST=<test addresses>
SMTP_HOST=<relay>
SMTP_PORT=587
SMTP_USER=<user>
MAIL_FROM=no-reply@<domain>
MIN_APP_VERSION_RESIDENT=1.0.0
MIN_APP_VERSION_STAFF=1.0.0
```

`S3_ENDPOINT` is the gateway inside the `rms` network (the application signs and uses it directly, over TLS with the private CA); `S3_PUBLIC_ENDPOINT` is the files host the clients receive in presigned URLs (DR-61, DR-268 item 5); path-style is on (DOC-41 §6). That the runtime reads the CA from `NODE_EXTRA_CA_CERTS` (the key is not in DOC-41; it is a Bun and Node variable) is **to verify in P1-20**; if it is not honored, DOC-41 gets a CA-file key. The `global` profile's values are in the table of §1.

Production: `APP_ENV=production`, `OPENAPI_ENABLED=false` (the boot guard refuses `true`), `SMS_DRIVER=provider`, `MAIL_DRIVER=smtp`, `SMS_BRAND=<brand>`, the production hosts and buckets, and the four `STORE_URL_*` (Owner input); `SMS_ALLOWLIST` and `MAIL_ALLOWLIST` are removed. Every other key keeps its default (DOC-41 §16). A key that is set in a way DOC-41 §17 refuses stops the boot with `config_invalid`, exit 78, so a typo is found at the first start of the first deploy.

`DB_POOL_MAX` and `PDF_CONCURRENCY` come from the compose files (§6.1), not from `app.env`.

The values that Compose itself interpolates (`RMS_DOMAIN`, `RMS_HOST_SUFFIX` for Grafana's root URL) go in `compose.env`:

```
RMS_DOMAIN=<domain>
RMS_HOST_SUFFIX=-staging          # empty on production
```

### 9.3 Custody and loss

| Secret | Held by | If lost |
| --- | --- | --- |
| `pii-encryption-keys` | The host, and a **sealed offline copy** with the Owner | CCCD numbers unrecoverable (DR-65, DOC-39 §7) |
| pgBackRest passphrase | The host, and a sealed offline copy with the Owner, **off the VPS** (DR-268) | Every backup unreadable (DR-66); with the VPS gone and no offline copy, an off-VPS backup is useless |
| `settings-encryption-keys`, `jwt-keys`, `qr-keys` | The host only | The gateway credentials are entered again; tokens and QR codes are reissued (RB-12) |
| Backup S3 identity (key pair) | The host (`pgbackrest.conf`, the identities file), and a sealed offline copy with the Owner | Create a new key pair in the identities file and `pgbackrest.conf`; the backups stay readable (the passphrase is separate) |
| `seaweedfs-s3-config` (files, backup, admin keys) | The host only (the files key is also a host secret of §9.1) | Re-create the identities and update the consumers; no data is lost |
| The private CA and gateway certificate | The host (`ca.pem`, the certificate); the CA key is **not** kept | Re-create the CA and certificate (§5.5) and restart `seaweedfs`; update `ca.pem` for pgBackRest and the application |
| `tunnel-token` | The host and Cloudflare | Create a new connector token in the dashboard; replace the file |
| CI secrets | GitHub | Recreate; the host is unaffected |

Rotation steps for each key are RB-12 (P6). Nothing in §9 enters the image, the repository, the CI logs or `/metrics` (DR-65, SC-20…22).

## 10. Monitoring files

The behavior, metrics, rules and dashboards are DOC-40; the files and their mounts are here. Every file is under `ops/`.

| File | Service | What it holds |
| --- | --- | --- |
| `prometheus/prometheus.yml` | Prometheus | `global: scrape_interval: 15s, evaluation_interval: 15s`, `external_labels: {env: staging}`, `rule_files: [rules/*.yml]`, `alerting` to `alertmanager:9093`; scrape jobs below |
| `prometheus/rules/*.yml` | Prometheus | The alert rules of DOC-40 §5, one file per group; `promtool check rules` runs in `verify` |
| `alertmanager/alertmanager.yml` | Alertmanager | DOC-40 §6 as built: routes, the inhibition (`ApiDown`, `PostgresDown`, `ReadinessFailing`), one receiver with email and Telegram, `bot_token_file` and `smtp_auth_password_file`. The addresses, the SMTP host and the chat id are placeholders until DOC-70 §2 rows 11 and 12 are filled. `alertmanager.local.yml` is the same routing with Mailpit, for `monitor:up` |
| `loki/config.yml` | Loki | Single binary, filesystem storage, schema v13 (`tsdb`), `compactor.retention_enabled: true`, `limits_config.retention_period: 336h` (14 days), `auth_enabled: false` |
| `alloy/config.alloy` | Alloy | The stages of DOC-40 §3.2 |
| `grafana/provisioning/datasources/*.yml` | Grafana | Prometheus `http://prometheus:9090`, Loki `http://loki:3100`, Alertmanager `http://alertmanager:9093` (type `alertmanager`, implementation `prometheus`) |
| `grafana/provisioning/dashboards/rms.yml`, `grafana/dashboards/*.json` | Grafana | Provisioned dashboards (DOC-40 §7); never edited in the UI |

Scrape jobs (the label `job` is Prometheus's; DR-154):

```yaml
scrape_configs:
  - job_name: rms-api
    static_configs: [{ targets: ["api-1:3001", "api-2:3001"] }]        # staging: only api-1
  - job_name: rms-worker
    static_configs: [{ targets: ["worker:3001"] }]
  - job_name: postgres
    static_configs: [{ targets: ["postgres-exporter:9187"] }]
  - job_name: node
    static_configs: [{ targets: ["node-exporter:9100"] }]
```

`api-2:3001` stays in the file on staging and shows `down` there: no rule fires on a single target of `rms-api` (`ApiDown` takes `max(up)`), so P1-18 kept one file for both environments and dropped the template `prometheus.yml.tmpl`. The file takes its `env` label from `${RMS_ENV}`, which the `expand-external-labels` flag of the command replaces. Prometheus keeps 15 days and at most 1,800 MB (§6.1).

`alloy/config.alloy` is written and checked (P1-18, Alloy 1.21.2): `alloy validate` and `alloy fmt` run in `bun run check:ops`, and Alloy shipped the JSON lines of a test container to Loki with the labels `env`, `service` (the Compose service), `container` and `level`, dropped the `/health/` request lines and kept `time` as the timestamp. Its stages are listed in DOC-40 §3.2. The file in the repository is the source; the earlier skeleton of this section is gone.

The files of this section as built: `ops/prometheus/{prometheus.yml, rules/rms-alerts.yml, rules/rms-jobs.yml, tests/rms-alerts.test.yml}`, `ops/alertmanager/{alertmanager.yml, alertmanager.local.yml}`, `ops/loki/config.yml`, `ops/alloy/config.alloy`, `ops/grafana/provisioning/{datasources,dashboards}/*.yml` and `ops/grafana/dashboards/*.json` (generated by `bun run ops:dashboards`). The `postgres` and `node` scrape jobs, their exporters and the host alerts join with P1-20 and P1-21. The Loki service has no healthcheck (the image has no shell tools); Alloy starts after it and retries its pushes.

Grafana's public host is `monitor(-staging).<domain>` behind Access (§5.2); its own sign-in (the admin password) stays (DR-88). Alert delivery needs the two secrets of §9.1 and the test of DOC-40 §6 (the first of each month).

## 11. First deploy, step by step

The whole sequence for staging. Production is the same with its values. Time: about half a day the first time (planned).

| Step | Do | Expected |
| --- | --- | --- |
| 1 | §2: inputs 2 to 5, 14 and 16 are known | The table has no *Open* in those rows |
| 2 | §5.1: the zone is **Active**; Bot Fight Mode off | Dashboard shows Active |
| 3 | §5.5 steps 1 to 3: the data volume mounted on `/srv/rms-data`, the private CA and certificate, the three S3 identities (the identities file) | `findmnt /srv/rms-data` shows a separate device; the files exist in `/etc/rms/tls` and `/etc/rms/secrets` |
| 4 | §4.1 to §4.7 on the VPS (firewall still off) | `docker compose version` v5.6.0; the network `rms` exists |
| 5 | §8.1 to §8.4 up to the roles and the configuration file: PostgreSQL, the cluster, roles, `pgbackrest.conf` written (the stanza **waits**: the repository does not exist before step 11) | `psql` works; `archive_mode` on |
| 6 | §9.1: generate the secrets; paste the Tunnel token, the files identity, the identities file | 17 files plus the two `seaweedfs-*` files, modes as listed |
| 7 | §9.2: write `app.env` and `compose.env` | `config` check below passes |
| 8 | §5.2: create the Tunnel and its **four** routes, the Access applications and the service token | The Tunnel is created |
| 9 | CI step: a merge to `dev` builds and publishes `sha-<7>` (DR-239); or by hand: `docker pull` the image and upload `docker/` and `ops/` as `/opt/rms/incoming/sha-<7>.tgz` | The image and the tarball exist |
| 10 | **First deploy only**, while SSH on the VPS's public address still works (§4.9 step 1; the Tunnel is not up before this deploy starts `cloudflared`): from a checkout of the commit, `tar -czf - docker ops \| ssh deploy@<VPS IP> 'cat > /opt/rms/incoming/sha-<7>.tgz'`, then `ssh deploy@<VPS IP> "bash -s -- sha-<7>" < ops/deploy/deploy.sh`. Every later deploy goes through the Tunnel (DOC-71 §7.1) | `deploy ok sha-<7> in <n> s`; all containers `healthy`, `seaweedfs` included |
| 11 | §5.5 steps 5 and 6: the buckets and the CORS rule; then §8.4: `stanza-create`, `check` and the first full backup; `systemctl enable --now` the timers of §8.5 | `aws s3 ls` shows both buckets; `pgbackrest info` shows a full backup |
| 12 | The Tunnel shows **Healthy**; from a laptop: `curl -s https://api-staging.<domain>/api/v1/health/ready` | `{"status":"ok","maintenance":false}` |
| 13 | §4.9 steps 3 to 5: SSH through the Tunnel, then `ufw --force enable` | A session through `ssh-staging.<domain>`; `ufw status` active |
| 14 | `ops/deploy/smoke.sh staging` from a laptop with the staging variables | `smoke passed (staging)` |
| 15 | `bun --env-file=<staging values> test tools/compat/uploads.test.ts` against `files-staging.<domain>` (P1-07: U1…U11 through the Tunnel and the files host) | The upload checks pass |
| 16 | Web: `wrangler pages deploy` (DOC-71 §8) and open `https://admin-staging.<domain>` | The Access login page, then the CMS sign-in |
| 17 | §10: Grafana at `https://monitor-staging.<domain>`; a test alert (DOC-40 §6) | Dashboard loads; email and Telegram arrive |
| 18 | Reboot (§14 check 9) | Every container is `healthy` within 5 minutes without a command |

The config check of step 7, before the first deploy: `docker compose --env-file /opt/rms/env/compose.env -f docker/compose.base.yml -f docker/compose.staging.yml config -q` prints nothing and exits 0.

## 12. Staging versus production

| | Staging | Production |
| --- | --- | --- |
| Hosts | `*-staging.<domain>` | `*.<domain>` (monitor at `monitor.<domain>`, ssh at `ssh.<domain>`) |
| VPS | 2 vCPU, 4 GB, 60 GB | 4 vCPU, 8 GB, 100 GB |
| `COMPOSE_PROFILES` | empty | `api2,logs` |
| Containers | `api-1`, `worker`, `caddy`, `cloudflared`, `prometheus`, `alertmanager`, `grafana`, exporters | the same plus `api-2`, `loki`, `alloy` |
| PostgreSQL | `shared_buffers` 512 MB, `effective_cache_size` 1 GB, `max_connections` 60; `app_conn_limit` 45 | 1 GB, 3 GB, 100; 80 |
| `DB_POOL_MAX` api / worker | 15 / 10 | 20 / 15 |
| Worker CPU, `PDF_CONCURRENCY` | `cpus: 1.0`, 1 | `cpus: 2.0`, 2 |
| Drivers | `allowlist` for SMS and mail; gateway `fake` on the demo building | `provider`, `smtp`; `payos` on the real building |
| OpenAPI | on | off (boot guard) |
| Demo building | present | present (store review) |
| Access allow-list | operators and web staff of staging | operators and the building's web staff |
| Deploy trigger | merge to `dev` (DR-239) | a `v*` tag with the Owner's approval |
| Files host | `files-staging.<domain>` | `files.<domain>` |
| SeaweedFS, data volume, buckets, S3 identities, CA | own (own container, own volume, `rms-staging-*`) | own (`rms-production-*`); the sizes of the volume and of the `seaweedfs` limit differ (§2 input 16, §6.1) |
| Tunnel, Pages, keys | own | own: nothing is shared across environments except the Cloudflare account, the zone and its one rate rule |

## 13. Teardown

Order matters: data first, then access, then the host.

1. Announce; set maintenance on (§6.4) if users exist.
2. Take a last backup and a `pg_dump` (DOC-72) and copy them to a place the Owner controls **outside the VPS**: in the `vn` profile the backups live on the host that is being destroyed, so this copy is the only one that survives (DR-268). Copy the files bucket too if the files are to be kept (`aws s3 sync` through the bridge). Record where.
3. `ops/deploy/deploy.sh` is not needed: on the host `docker compose … down` (volumes kept for now); `systemctl disable --now rms-backup@full.timer rms-backup@diff.timer`.
4. Cloudflare, in this order: delete the Access applications and the service token `deploy-ci`; delete the Tunnel (the dashboard removes its DNS records); delete the Pages project and its custom domain; remove the WAF, configuration and cache rules and the rate rule for that environment.
5. GitHub: delete the environment secrets of that environment and the deploy key; delete the GHCR read token.
6. Stop `seaweedfs`; destroy the VPS **and the data volume** at the provider, with their snapshots (the volume holds the files and the backups: personal data, DR-58). If the provider cannot confirm that a deleted volume is erased, overwrite the device first. Revoke the operators' SSH keys wherever they were copied.
7. Personal data in the database or in the buckets is erased by step 6 (the database, the files and the backups are all on the host); a copy kept by the Owner is theirs to protect or destroy (DR-58, DOC-35). In the `global` profile the R2 buckets are emptied and deleted and the R2 tokens revoked instead (ADR-0016, ADR-0017).

## 14. Checks

These are the checks of P1-20 (staging) and P6-13 (production). They are **not run** yet. They are not test cases and take no test ID; the matching automated tests are SC-16, SC-21, SC-22 and the others named in the last column.

| # | Check | Expected | Related |
| --- | --- | --- | --- |
| 1 | From a machine outside the VPS: `nmap -Pn -p- <VPS IP>` and `ssh deploy@<VPS IP>` | No open port; the SSH connection times out (inbound denied, SSH included, DR-83) | NFR-14 |
| 2 | The provider console gives a root shell on the host | Works; recorded in P1-20 | §4.9 |
| 3 | `ssh ops@ssh-staging.<domain>` through the Tunnel as an operator; as an email outside `rms-operators` | The first works after the Access login; the second is refused by Access | DR-88 |
| 4 | The CI key with the service token from a runner | `deploy` shell opens; with a wrong token Access answers 401 or 403 and no SSH banner | DOC-71 §7.1 |
| 5 | `GET https://api-staging.<domain>/api/v1/health/ready`; `…/health/live`; `…/metrics` | 200; 404; 404 | DR-07, E-01, E-02 |
| 6 | `GET https://api-staging.<domain>/api/v1/docs` on staging; on production | A page with no CSP header; 404 | SC-16, AG-03 |
| 7 | `docker inspect rms-api-1-1` environment and `GET /metrics` | `*_FILE` paths, no secret value, none in `/metrics` | SC-22 |
| 8 | `pgbackrest info` against the SeaweedFS repository; wait for the next differential; `backup_last_success_timestamp` in Prometheus | A backup exists; the timestamp moves after 02:00 ICT | NFR-11, OB- |
| 9 | Reboot the VPS | After the reboot, with no command: the data volume mounted, PostgreSQL up, all containers `healthy` in 5 minutes (`seaweedfs` included), the Tunnel Healthy, the WAL archive resumes (`pgbackrest check`), the smoke test passes | §6.2 |
| 10 | A deploy of a second tag with a new migration | `deploy ok`; the old container served until `api-1` was recreated; the probe saw no failure | NFR-10 |
| 11 | `deploy.sh --rollback` then the smoke test; time it | Within 10 minutes; written in §6.6 | DR-08 |
| 12 | Stop the database (`systemctl stop postgresql@18-main`) | `/api/v1/health/ready` is 503; `ReadinessFailing` fires; the email and Telegram arrive within 2 minutes | OB-14 |
| 13 | A PITR restore onto an empty host from this repository (the SeaweedFS gateway, or the POSIX fallback of §8.4 if P1-20 chose it) | Works and is timed (formerly spike S-09; the drill is EXP-12); the result decides between the S3 repository and the fallback | NFR-11 |
| 14 | Cloudflare: the rate rule | A script of 150 requests in 10 s to `/api/v1/auth/staff/login` from one IP is blocked for 10 s; ordinary traffic passes | §5.3 |
| 15 | Webhook skip: `POST /api/v1/payments/webhooks/payos/<id>` without a signature | 401 `invalid_signature` from the application, not a Cloudflare block page | SC-11 |
| 16 | `unattended-upgrade --dry-run -d` | PostgreSQL, pgBackRest and Docker packages are in the blacklist | §4.5 |
| 17 | From a machine outside the VPS: `curl -sI https://files-staging.<domain>/`; `curl` to `https://files-staging.<domain>:8888`, `:9333` | The S3 gateway answers (an S3 error body, no listing); the filer, master and volume ports do not answer; no S3 port is open on the VPS address (check 1) | DR-268 item 5 |
| 18 | With the **files** identity: `aws s3 ls s3://rms-staging-backup`; with the **backup** identity: `aws s3 ls s3://rms-staging-files` | Both refused (`AccessDenied`): the identities are limited to their bucket | DR-268 item 2, DOC-07 TB5 |
| 19 | `findmnt -no SOURCE /srv/rms-data`, `findmnt -no SOURCE /`, `findmnt -no SOURCE /var/lib/postgresql/18/main`; `df -h` | The data volume's device differs from the root and PostgreSQL's | DR-268 item 3 |
| 20 | `pgbackrest --stanza=rms check` with the repository CA removed, and with the right CA | Fails the TLS check; passes with the CA (verification is on, not skipped) | DR-268 item 7 |
| 21 | `ops/deploy/smoke.sh` plus `tools/compat/uploads.test.ts` against the files host; a presigned `PUT` of 50 MB | U1…U11 pass; the video limit fits the Tunnel's 100 MB | P1-07, DR-61 |

## 15. Risks recorded here

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| One VPS per environment | The loss of the host is an RTO of up to 4 h **for a rebuild with a restore from backups that survive**; in the `vn` profile they do not (next row) | Rebuild from this document (RB-10); the Owner accepted one VPS (DR-83) |
| **The whole VPS, or its provider account, is lost** (DR-268 consequences) | **The database, the files and the backups are lost together** until the SeaweedFS replica on another server exists. This breaks the claim of DR-66 that backups survive the host | Accepted by the Owner (DR-268). Mitigations without a decision: the separate data volume (it protects against a disk fault, **not** against the loss of the VPS), a provider snapshot if the provider offers one (§2 input 16), the weekly `pg_dump` copied to an operator-held place at the Owner's discretion (DOC-72). The replica is a later DR; recorded in DOC-72 and DOC-10 |
| **RPO and RTO scope** (NFR-11) | RPO <= 5 min and RTO <= 4 h hold for a PostgreSQL fault, a bad migration, a dropped table or a bad deploy (what PITR serves). They do **not** hold for the loss of the whole VPS: there the recovery point is the last off-VPS copy, if any, and may be total loss | Stated in DOC-10 §7 and DOC-72; restated when the replica exists |
| **pgBackRest against the SeaweedFS S3 gateway is not proven** | The WAL archive or a restore may fail, or the gateway may not keep up with a segment per minute | P1-20 runs archive, backup, restore and the load; the POSIX fallback on the backup volume (§8.4) |
| SeaweedFS shares the VPS's CPU, memory and disk with PostgreSQL and the API | A burst of uploads or a backup slows the API; a full data volume stops uploads **and** the archive | Separate volume, provisional limits (§6.1), disk and archive-failure alerts, EXP-07 and EXP-08 recalibrate (DR-268) |
| The Owner operates SeaweedFS (upgrades, volume growth, the TLS certificate of §5.5 expires) | An unnoticed expiry or a version drift breaks uploads and the archive | A calendar reminder before the certificate's expiry; a restore drill that includes the backup bucket (DOC-72) |
| Uploads and downloads cross the Cloudflare Tunnel | The free plan's 100 MB request limit; the files host depends on `cloudflared` | The 50 MB video limit fits; check 21 |
| Docker is a dependency of SSH over the Tunnel (`cloudflared` is a container) | A broken Docker daemon removes the SSH path | The provider console (§14 check 2) |
| `deploy` is root-equivalent | A leaked CI key is a root on that host | Access service token, pinned host key, per-environment keys, nothing shared (§3.3) |
| The Docker socket in Alloy | A compromised Alloy is root | Official image, read-only intent, no inbound; revisit if Loki is dropped |
| Access on the web CMS does not protect the API | A stolen staff password still works against the API | Application limits and lockout (DOC-39 §3); not an Access matter |
| A new web staff member is not in `rms-web-staff` | They see the Access page, not the CMS | The Admin's checklist for creating a staff member (DOC-67 owes the line) |
| Bot Fight Mode off | No bot challenge on any host of the zone | Managed WAF, the app's buckets, the rate rule (§5.3) |
| Cloudflare free-plan limits change | A rule may stop being allowed | §5 states the dates read; P1-20 re-reads them |

## 16. Decisions made while writing

Every new decision in this document is recorded as a DR (decided, Claude delegated by the Owner, unless the row says otherwise). The implementation choices of §5.5 and §6.1 (one `weed server` process set, a fixed bridge address, TLS on the gateway with a private CA, three identities) are proposals that follow DR-268 and are **to confirm in P1-20**; if P1-20 changes one, it is recorded then.

| ID | Title | State | Where used |
| --- | --- | --- | --- |
| DR-158 | Host layout and hardening: `ssh-<env>.<domain>` as the fourth host; `docker/` and `ops/` shipped as one release tarball; configuration hashes passed as an environment variable so Compose recreates only what changed; secret files owned by `deploy`, group `rms` (10001), mode 0440 (revises "root, 0400" of DR-65); unattended upgrades limited to operating-system security updates | Decided | §3.1, §3.2, §4.5, §6.1, §9.1 |
| DR-159 | Cloudflare free-plan rules: the one rate rule on `/api/v1/auth/*` is 100 requests per 10 s per IP, block 10 s, one rule for both hosts; `*.pages.dev` goes behind Access when the plan allows | Decided | §5.3, §5.4 |
| DR-160 | **Bot Fight Mode is off for the zone**, because it cannot be skipped on the free plan (revises DR-83 item 4, DOC-07 TB1, DOC-39 §5.4) | Decided (Owner, 2026-10-20) | §5.3 |
| DR-161 | Staging runs without Loki and Alloy (profile `logs`, production only); `deploy.sh` stops at the first failing step and never rolls back by itself | Decided | §6.1, §6.5 |
| DR-268 | Deployment in Vietnam: files and backups in SeaweedFS on the VPS (separate data volume), no R2; the edge stays; clients reach the S3 gateway through `files.<domain>`; two profiles, `vn` and `global` (**Decided, Owner, 2026-10-26**; ADR-0027) | Decided | §1, §2, §3, §5.2, §5.5, §6.1, §8.4, §9, §11 to §15 |
| DR-162 | PostgreSQL cluster locale `C.UTF-8` with data checksums; backup timers are systemd timers with `Asia/Ho_Chi_Minh` in `OnCalendar` (full Sunday 02:00, differential Monday to Saturday 02:00) | Decided | §8.1, §8.5 |

## 17. Sources read (2026-10-20)

Cloudflare documentation: rate-limiting rules (free plan: 1 rule, 10 s, IP), Bot Fight Mode and WAF skip (cannot be skipped), SSH with client-side `cloudflared` (route type SSH to `localhost:22`, `ProxyCommand cloudflared access ssh --hostname %h`), Access service tokens (`CF-Access-Client-Id`, `CF-Access-Client-Secret`, Service Auth), Pages `_headers` (100 rules, 2,000 characters, not applied to Functions), Pages custom domains and branch aliases. Caddy documentation: `reverse_proxy` health checks and `flush_interval`, `request_body max_size`, global `servers` `trusted_proxies`, `auto_https off`. pgBackRest configuration reference (S3, cipher, retention, async archive). Expo and PostgreSQL package facts are in DOC-11. **SeaweedFS:** no SeaweedFS documentation was read for this revision (2026-10-26). The `weed server` flags that appear in `compose.local.yml` come from the local stack (DOC-69, DR-231); the S3 identities, TLS options, bucket-scoped actions, health path over TLS and multipart cleanup are **to verify in P1-20**, as is `repo-storage-ca-file` against pgBackRest 2.59.3. A statement in this document that no source here covers is marked **P1-20 checks** or **P1-18 checks**.

## 18. Not in this document

| Topic | Lives in |
| --- | --- |
| The pipeline, workflow files, secrets of CI, the smoke test's place in it | DOC-71 |
| Backup retention rationale, the weekly dump, restore, the drill, RB-10 | DOC-72 |
| Rotation of each key | RB-12 (DOC-86) |
| Alert rules, metric names, dashboards | DOC-40 |
| What each configuration key does | DOC-41 |
| Container and capacity budgets (the reasons) | DOC-10 §6 |
| EAS, stores, mobile secrets | DOC-73 |
| Module and package layout | DOC-12 |
| The SeaweedFS replica on another server (later, DR-268 item 4) | A future DR; then DOC-72 and this document |
| The `global` profile with R2 (buckets, tokens, CORS, lifecycle, pgBackRest on R2) | ADR-0016, ADR-0017, ADR-0020, DR-83 |
| SeaweedFS version and upgrade, disk budget | DOC-11 §1 (version), DOC-10 §6 (budget) |

## 19. Traceability

| Section | Decisions | Requirements and tasks |
| --- | --- | --- |
| §4 hardening, §5.2 SSH and the files route | DR-83 item 2, DR-88, DR-268 item 5 | NFR-14; P1-20; check 1 to 4 |
| §5.3 WAF, rate rule | DR-64, DR-83 item 4 | NFR-07; check 14, 15 |
| §5.5 SeaweedFS on the VPS (replaces R2) | DR-61, DR-268 | FR-40; P1-07, P1-20; check 17 to 21 |
| §6 compose, deploy, experiments | DR-05, DR-06, DR-08, DR-95, DR-102, DR-161 | NFR-03, NFR-10; P1-20; check 9 to 11 |
| §7 Caddy | DR-07, DR-75, DR-83 item 3 | NFR-10; check 5, 6 |
| §8 PostgreSQL, pgBackRest (SeaweedFS repository, POSIX fallback) | DR-66, DR-67, DR-93, DR-113, DR-268 | NFR-11; P1-20; check 8, 13 |
| §9 secrets | DR-65, DR-113, DR-156 | NFR-14; CF-15, CF-16; check 7 |
| §10 monitoring | DR-63, DR-88, DR-154 | NFR-09, NFR-10; P1-18; check 12 |

## Open questions

- **The Owner inputs of §2** are open by design: the documents use placeholders and the real value arrives with the task that needs it (DR-228, decided by the Owner on 2026-10-21; column *Blocking?*). None blocks writing this document or starting P1; the lead times are in §2.
- **DR-160 (Bot Fight Mode off)** weakens the edge relative to DR-83 item 4; the Owner confirmed it on 2026-10-20. The alternative, to keep it on, would let a challenge hit an app or the gateway callback.
- **Whether the free plan offers** *Access for `*.pages.dev`*, accepts the `starts_with` operator and host condition in the one rate rule, and covers the staff count in Access is checked by P1-20.
- **The GHCR token type**, the `cloudflared` flags, the Alertmanager `*_file` keys, the Alloy option names and the `postgres_exporter` options are checked by P1-20 and P1-18 as marked.
- **SeaweedFS in P1-20 (DR-268).** Commands and options of §5.5, §6.1 and §8.4 are not run. P1-20 must confirm: pgBackRest 2.59.3 against the S3 gateway over TLS (archive, backup, restore, load; else the POSIX fallback); that the gateway serves TLS with the certificate options named, or a TLS listener goes in front of it; the identities syntax and bucket scoping; that the Tunnel route to an HTTPS origin accepts the private CA or falls back to *No TLS Verify*; that presigned URLs signed for the files host validate behind the Tunnel; the runtime's use of `NODE_EXTRA_CA_CERTS`; multipart cleanup; the `seaweedfs` memory limits and the data-volume size (§2 input 16).
- **The whole-VPS risk (DR-268)** stays open until the SeaweedFS replica on another server has its own DR; the Owner may price a provider snapshot in P0-03.
- Decisions made while writing: DR-158…162 and DR-268 (decided by the Owner).
