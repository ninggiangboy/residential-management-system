# Deploy: staging and production

> Status: **Approved** (Owner, 2026-10-21, as the first version for staging (gate P1); final in P6) · Updated: 2026-10-22 (DR-239: the trunk is `dev`; earlier 2026-10-21: DR-228: placeholders and the *Blocking?* column of §2; DR-68: providers picked at P1-22; stale open question removed) · DOC-70
> Depends on: original SDD §19.1, §19.3, [DR](../00-decision-register.md) (DR-05, 06, 07, 08, 33, 61, 63, 64, 65, 66, 67, 68, 69, 83, 88, 93, 95, 102, 113, 152, 154, 156, DR-158…162, DR-228), [DOC-06](../02-glossary.md), [DOC-07](../03-architecture/system-context-and-containers.md) §3, §4, §7, [DOC-10](../03-architecture/quality-attributes.md) §6, §7, [DOC-11](../03-architecture/tech-stack-and-versions.md) §1, §7, [DOC-19](../05-data/db-roles-and-grants.md) §3, §7, §8, [DOC-38](../06-design/jobs-and-outbox-runtime.md) §5.4, [DOC-39](../06-design/security.md) §5, §7, [DOC-40](../06-design/observability.md) §2, §6, [DOC-41](../06-design/configuration-reference.md) §4…16, [DOC-71](ci-cd.md) §7
> Main readers: P0-03, P1-18, P1-20, P1-22, P6-05, P6-13; the Owner and the operator who builds a host; [DOC-72](backup-restore.md) (backup, restore), [DOC-71](ci-cd.md) (calls the deploy command)

This document builds one environment from nothing: the inputs the Owner must supply, the VPS and its hardening, the Cloudflare setup, native PostgreSQL and pgBackRest, the compose files, the Caddyfile and the Tunnel, the secrets as files, the rolling deploy script, the migrations, the first deploy and the teardown. It does not hold the pipeline that calls the deploy command (DOC-71), the restore procedure and the drill (DOC-72, RB-10), the meaning of a configuration key (DOC-41), the alert rules (DOC-40) or the application's design (DOC-07). Staging and production use the same files; §12 lists the few values that differ.

**State of this document.** Nothing has been installed: there is no VPS, no Cloudflare account configured and no domain yet (the inputs of §2 are open and are placeholders until the task that needs them, DR-228). Every command is written from the vendor documentation read on 2026-10-20 (sources in §17) and **not run**. P1-20 builds staging by following this document and corrects it where reality differs; each place that task must confirm is marked **P1-20 checks**. The values for production are the same files with the sizes of DR-06.

## 1. Purpose and scope

| Item | Where |
| --- | --- |
| Inputs the Owner supplies (P0-03) | §2 |
| Hosts, sizes, names, the layout on the host | §3 |
| VPS provisioning and hardening | §4 |
| Cloudflare: DNS, Tunnel, Access, WAF, rate rule, Pages, R2 | §5 |
| Compose files, profiles, start order, health, migrations, the deploy script, rollback, one-shot containers for experiments | §6 |
| Caddyfile and the Tunnel routes | §7 |
| PostgreSQL native install and tuning, pgBackRest | §8 |
| Secrets and environment variables | §9 |
| Monitoring files | §10 |
| First deploy, step by step | §11 |
| Staging versus production | §12 |
| Teardown | §13 |
| Checks | §14 |

## 2. Owner inputs (P0-03)

Task P0-03 collects these and records them in this table. **The documents never hold the real data** (DR-228, Owner, 2026-10-21): they use placeholders (`<domain>`, `<reverse-domain>`, `<company-name>`, `<tax-code>`, `<github-org>`, …), and the Owner supplies the real value only when the task that needs it starts, to the place that uses it (the Cloudflare account, the EAS project, the secret files of §9, the operator), never to this repository. The column *Needed by* is the task that stops without the real value; the column *Blocking?* says what happens before that task. **No input is needed to start coding phase 1**: P1-01…P1-16, P1-19 and P1-21 run locally with placeholders, Mailpit and the fake drivers.

| # | Input | Used in | Needed by | Blocking? | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Company legal name, address, tax code | Terms, receipts, store listings (DOC-73) | P1-12, P6-10 | **Placeholder, then required.** The terms seed of P1-12 uses `<company-name>`, `<company-address>`, `<tax-code>`; the real text is needed before the staging UAT and for the store listing (P6-10) | Open |
| 2 | **Company domain** `<domain>` and where it is registered; the Owner can change its name servers to Cloudflare | §5.1; every host name | P1-20 | **Required at P1-20 (staging), not before.** Lead time: buying the domain and moving its name servers to Cloudflare can take days | Open |
| 3 | Cloudflare account: owner email, two-factor on; R2 enabled; what the free plan asks (payment method) | §5 | P1-20 | **Required at P1-20 (staging), not before** | Open |
| 4 | **VPS provider, location, plan and price** for staging (2 vCPU, 4 GB, 60 GB) and production (4 vCPU, 8 GB, 100 GB), Ubuntu Server 26.04 LTS available (else 24.04, DR-83); out-of-band console access; whether the location is in Vietnam (DR-58 residency review) | §3, §4 | P1-20 | **Required at P1-20 (staging), not before**; production is needed at P6 | Open |
| 5 | Operators: names and emails of the Owner and of the Admin who operates the system; their SSH public keys | §4.3, §5.2 (Access allow-list) | P1-20 | **Required at P1-20 (staging), not before** | Open |
| 6 | GitHub organization and repository (private); who administers it | DOC-71 | P1-01 | **Not blocking: satisfied.** The repository already exists; documents use `<github-org>` | Satisfied |
| 7 | App display names, bundle ids `<reverse-domain>.rms.resident` and `<reverse-domain>.rms.staff` (DR-69) | DOC-73 | P1-17 | **Placeholder, then required.** `<reverse-domain>` and `<app-name>` until the first EAS build of P1-17, which needs the real ids | Open |
| 8 | Apple Developer Program account; Google Play Console account; Expo organization (all company-owned) | DOC-73 | P1-17, P6-10 | **Expo organization: required at P1-17.** Apple Developer: only for an iOS device build or a store build; Google Play: only for the store build (P6-10). The Android development build and the simulators work without either. Lead time: Apple Developer enrolment (company verification takes days to weeks) | Open |
| 9 | Receiving bank account (bank, number, holder) and payOS merchant account with test credentials (P0-04) | DOC-24 | P3-01 | **Not P1.** Needed at P3 (P3-01); the fake driver runs until then | Open |
| 10 | SMS provider with brandname OTP and SMTP relay chosen (DR-68: not chosen yet; ports, `console`/`allowlist` drivers and Mailpit first); brandname registration started | DOC-26, §9 | P1-22 (and M1, which needs a real SMS OTP) | **Required at P1-22, not before.** P1-10 and P1-11 run on the fake drivers. Lead time: brandname registration takes up to about 3 weeks after the pick | Open |
| 11 | A second mail account for alert delivery (not the application's SMTP), and a Telegram bot with the chat id of the alert group (DR-63) | §10 | P1-18 | **Required for the acceptance of P1-18 on staging** (the alert must reach email and Telegram); locally the alerts go to Mailpit | Open |
| 12 | An external uptime probe service (free tier) and who receives its messages (DOC-40 §6) | NFR-10 | P1-18 | **Required for the acceptance of P1-18 on staging**; not needed locally | Open |
| 13 | Manager contact; time zone confirmation `Asia/Ho_Chi_Minh` (DR-09) | DOC-36 | P1-12 | **Placeholder (demo seed), then required** before the staging UAT. The time zone is already decided (DR-09) | Open |
| 14 | Where the Owner keeps the **sealed offline copies** of the PII key and the pgBackRest passphrase (a safe or a password manager with an emergency kit) | §9.3 | P1-20 | **Required at P1-20 (staging), not before**; the keys of staging are created then (EXP-09 of P1-23 runs on it) | Open |
| 15 | Expo push credentials: FCM service account and APNs key (DOC-73) | `EXPO_ACCESS_TOKEN`, §9 | P1-17 | **Required for the acceptance of P1-17 on a real device** (a push reaching a phone); the development build and simulators run without | Open |

**Lead times to start early** (DR-228): the SMS brandname registration (up to about 3 weeks, row 10), the Apple Developer enrolment (row 8) and the domain registration with the name-server change (row 2). None blocks coding; each can delay the staging UAT or the first iOS build if started late.

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
| R2 buckets | `rms-staging-files`, `rms-staging-backup` | `rms-production-files`, `rms-production-backup` |
| Pages project | `rms-admin-staging` | `rms-admin-production` |
| Compose project | `rms` | `rms` |

`ssh-<env>.<domain>` is a fourth host that DR-83 and DOC-07 imply (SSH through the Tunnel) without naming; it is behind Access and never serves a web page (DR-158).

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
| `/etc/pgbackrest/pgbackrest.conf` | pgBackRest configuration, **holds the R2 backup key and the repository passphrase** | `postgres:postgres` · 0600 |
| `/var/lib/postgresql/18/main` | The database cluster (PostgreSQL 18, native) | `postgres` |
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

A single Cloudflare account on the free plan holds everything (DR-83). Plan limits were read on 2026-10-20: **one** rate-limiting rule per zone, 10-second period, counted per IP, 10-second mitigation (Cloudflare rate-limiting documentation).

### 5.1 Zone and DNS

1. Add `<domain>` to Cloudflare (Add a domain, free plan). At the registrar, set the two name servers Cloudflare shows. Wait for status **Active**.
2. SSL/TLS: encryption mode **Full (strict)**; *Always Use HTTPS* on; *Minimum TLS Version* 1.2; *Automatic HTTPS Rewrites* on.
3. **Do not turn on** *Bot Fight Mode* and turn it **off** if it is on (Security → Bots). Reason in §5.3.
4. DNS records are made by the steps below, not by hand: the Tunnel's public hostnames add proxied `CNAME` records to `<tunnel-id>.cfargotunnel.com` (§5.2); the Pages custom domains add records to `<project>.pages.dev` (§5.4). Nothing else is created. In particular **there is no `A` record to the VPS address**: the host is not addressable from the Internet.
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

   The catch-all rule is `http_status:404`. The three hostnames are the only way in.
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

**Access never fronts `api-<env>.<domain>`** (DR-83 item 4): the mobile apps and the payment gateway cannot pass a login. The Access layer on the web CMS is therefore one more lock on the static site, **not** a protection of the API: a staff password and the API's own limits remain the real gate (DOC-39 §3). The Owner adds an email to `rms-web-staff` when the Admin creates a staff member who needs the CMS; forgetting it shows the person the Access login page, not an error of the application (a known cost, in §15 risks).

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

### 5.5 R2

Two private buckets per environment (DR-83 item 8). Bucket names are fixed; the location hint is `apac` (best effort, no Vietnam location; DR-83).

```bash
bunx wrangler@4.151.1 r2 bucket create rms-staging-files  --location apac
bunx wrangler@4.151.1 r2 bucket create rms-staging-backup --location apac
bunx wrangler@4.151.1 r2 bucket list
# the files bucket needs CORS (DR-61: PUT and GET from the admin origin only)
cat > cors-files.json <<'EOF'
{ "rules": [ {
  "allowed": { "origins": ["https://admin-staging.<domain>"], "methods": ["GET", "PUT"], "headers": ["Content-Type"] },
  "exposeHeaders": ["ETag"], "maxAgeSeconds": 3600 } ] }
EOF
bunx wrangler@4.151.1 r2 bucket cors set rms-staging-files --file cors-files.json
```

The CORS file format and the `wrangler r2 bucket cors set` command are **P1-20 checks** against `wrangler` 4.151.1 and the R2 documentation. Neither bucket is public: there is no custom domain and no `r2.dev` access (the default is off; confirm in the dashboard).

**API tokens** (R2 → Manage API tokens → Create API token), two per environment, each limited to **one bucket**:

| Token | Permission | Bucket | Stored as |
| --- | --- | --- | --- |
| `rms-staging-files` | Object Read & Write | `rms-staging-files` | Host secrets `s3-access-key-id`, `s3-secret-access-key` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, DOC-41 §6) |
| `rms-staging-backup` | Object Read & Write | `rms-staging-backup` | `repo1-s3-key`, `repo1-s3-key-secret` in `/etc/pgbackrest/pgbackrest.conf` (§8.4). **Not** shared with the application (DOC-07 TB5) |

Each token shows an Access Key ID and a Secret Access Key **once**. The S3 endpoint is `https://<account-id>.r2.cloudflarestorage.com`, region `auto` (R2 documentation). The account id is on the R2 overview page; it goes in `app.env` (`S3_ENDPOINT`) and in `pgbackrest.conf`.

A lifecycle rule on the backup bucket aborts incomplete multipart uploads after 1 day (R2 → bucket → Settings → Object lifecycle rules): a failed `archive-push` must not leave orphan parts that are billed.

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
  cloudflared:
    <<: *third
    image: cloudflare/cloudflared:2026.10.1
    command: tunnel --no-autoupdate run --token-file /run/secrets/tunnel-token
    secrets: [tunnel-token]
    depends_on: [caddy]
  prometheus:
    <<: *third
    image: prom/prometheus:v3.15.0
    command: >
      --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus
      --storage.tsdb.retention.time=15d --storage.tsdb.retention.size=1800MB --web.enable-lifecycle
    environment: { RMS_CONFIG_HASH: "${RMS_CFG_PROMETHEUS:-}" }
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
    image: grafana/loki:3.7.8
    command: -config.file=/etc/loki/config.yml
    environment: { RMS_CONFIG_HASH: "${RMS_CFG_LOKI:-}" }
    volumes: ["/opt/rms/current/ops/loki:/etc/loki:ro", "loki-data:/loki"]
  alloy:
    <<: *third
    profiles: [logs]
    image: grafana/alloy:v1.20.1
    command: run --server.http.listen-addr=0.0.0.0:12345 --storage.path=/var/lib/alloy/data /etc/alloy/config.alloy
    environment: { RMS_ENV: "${RMS_ENV}", RMS_CONFIG_HASH: "${RMS_CFG_ALLOY:-}" }
    volumes:
      - /opt/rms/current/ops/alloy/config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
```

Notes on the file:

- **No `ports:`** anywhere. Services reach each other by name on the `rms` network; the Tunnel reaches `caddy` and `grafana` the same way (§5.2).
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
```

These are DR-06, DR-102 and DOC-10 §6.1 as numbers: the `cloudflared` limit is left open until EXP-07 measures it (DR-06). `memswap_limit` equal to `mem_limit` gives containers no swap.

### 6.2 Start order and health

| Order | Unit | Ready when | Waits for |
| --- | --- | --- | --- |
| 0 | PostgreSQL 18 (host, systemd) | `pg_isready -h 172.30.0.1` | Docker's bridge `br-rms` (§8.2: `After=docker.service`) |
| 1 | `migrate` (a deploy only) | Exits 0 | PostgreSQL |
| 2 | `api-1` | `healthy` (`/health/ready` on the ops port answers 200) | Migrations |
| 3 | `caddy` | Its health check passes an upstream | `api-1` healthy (`depends_on`) |
| 4 | `cloudflared` | The Tunnel shows **Healthy** in the dashboard | `caddy` |
| 5 | `api-2` (production) | `healthy` | After `api-1` in a rolling deploy |
| 6 | `worker` | `healthy` (relay finished a pass, DOC-38 §5.2) | |
| any | Monitoring | Prometheus targets up | |

**After a host reboot** Docker restarts every container (`restart: unless-stopped`) at the same moment, and PostgreSQL starts after Docker (it needs the bridge). `api` and `worker` therefore start before the database answers. The requirement on the application is: **the first connection is retried for 30 seconds, then the process exits with code 1** and Docker restarts it; `/health/ready` is 503 until the database answers (E-02). P1-04 implements and tests that (DOC-38 §5.1, DR-248: the ops port answers 503 during the wait); §14 check 9 proves the whole reboot.

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
dc pull --quiet --ignore-buildable caddy cloudflared prometheus alertmanager grafana postgres-exporter node-exporter || fail 2

# 3. migrations (maintenance on first when asked)
[ "${maint:-0}" = 1 ] && "$RMS/current/ops/deploy/maintenance.sh" on "Planned maintenance"
step 3 migrate
dc run --rm migrate || fail 3

# 4. edge and monitoring services (recreated only when their config hash changed)
step 4 infrastructure
dc up -d --no-deps caddy cloudflared postgres-exporter node-exporter prometheus alertmanager grafana || fail 4
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

- `request_body max_size 2MB`: a larger body gets **413** from Caddy before it reaches the application (Caddy documentation); uploads go to R2 by presigned `PUT`, so the API never receives a video (DR-07).
- **SSE** (`GET /api/v1/staff/events`, E-xxx of DOC-52): `flush_interval -1` disables buffering. The application sends a heartbeat every 25 s (`SSE_HEARTBEAT_SECONDS`) because Cloudflare closes a proxied request that receives no data for 100 s (DR-83 item 10).
- **Health check on the ops port:** `health_port 3001` with `health_uri /health/ready` checks the same endpoint as Docker without routing the ops port to the world (DR-07). An upstream that fails is skipped for `fail_duration`.
- **`-Server`** removes the `Server` header. The app's `Cache-Control` and `ETag` are not touched (DOC-39 §5.1).
- **Logging.** Caddy writes one JSON access line per request to stdout (Alloy collects it in production). Caddy replaces `Authorization` and `Cookie` header values with `REDACTED` unless `log_credentials` is enabled; it is not. **P1-20 checks** one real line (DOC-39, never logged: tokens). The application already logs a request line with the request id (DOC-40 §3), so Caddy's line is for the cases the application never saw (a 413, a 502).
- **`RMS_UPSTREAMS`**: `api-1:3000` on staging, `api-1:3000 api-2:3000` on production (§6.1).
- **`:80`** is the only listener and is reachable only on the `rms` network. The `Caddyfile` is validated in CI with `docker run --rm -v ./ops/caddy:/etc/caddy caddy:2.11.7 caddy validate --config /etc/caddy/Caddyfile` (DOC-71 stage `verify`, P1-19).

### 7.2 The Tunnel

The Tunnel is remote-managed (§5.2): the routes live in Cloudflare, not in a file. The table of §5.2 is the source of truth and is copied into `ops/cloudflared/README.md`; a change of a route is a change to that table in the same pull request. The connector is the container of §6.1, started with `--token-file` (**P1-20 checks** the flag on `cloudflared` 2026.10.1 and falls back to the `TUNNEL_TOKEN` environment variable read through an entrypoint, as for the exporter). `--no-autoupdate` keeps the version pinned by DR-95: the image tag is the update path.

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
# expected: localhost,172.30.0.1 ; 512MB ; on   (archive_mode on needs the stanza of §8.4 before it archives)
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

pgBackRest, as `ops/pgbackrest/pgbackrest.conf.template` → `/etc/pgbackrest/pgbackrest.conf` (owner `postgres`, 0600) with the values filled in:

```
[global]
repo1-type=s3
repo1-s3-endpoint=<account-id>.r2.cloudflarestorage.com
repo1-s3-bucket=rms-staging-backup
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-s3-key=<access key id of the backup token>
repo1-s3-key-secret=<secret access key of the backup token>
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

Option names and meanings were read in the pgBackRest configuration reference (2026-10-20): `repo-s3-uri-style` is `host` by default and `path` addresses the bucket in the path; `repo-cipher-type` is `none` or `aes-256-cbc` and encryption is client-side; `repo-retention-full` and `repo-retention-diff` are counts; `archive-async` defaults to `n`; `spool-path` defaults to `/var/spool/pgbackrest`. The endpoint without `https://`, the `path` style and `region=auto` for R2 are **P1-20 checks** (a bucket host style with a wildcard certificate may work as well; `path` is the one that avoids DNS). pgBackRest's own `archive-timeout` (default 1 minute) is the wait for a segment to reach the repository; it is a different setting from PostgreSQL's `archive_timeout` above.

```bash
install -d -o postgres -g postgres -m 0750 /var/spool/pgbackrest /var/lib/node_exporter/textfile
sudo -u postgres pgbackrest --stanza=rms stanza-create           # expected: stanza-create command end: completed successfully
sudo -u postgres pgbackrest --stanza=rms check                   # expected: check command end: completed successfully
sudo -u postgres pgbackrest --stanza=rms --type=full backup      # expected: backup command end: completed successfully
sudo -u postgres pgbackrest info                                 # shows one full backup and the WAL range
```

The passphrase `repo1-cipher-pass` is generated on the host and a **sealed copy is kept offline by the Owner** (DR-65, §9.3): losing it makes every backup unreadable.

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

Full weekly, differential daily and continuous WAF… archive are DR-66. The weekly `pg_dump` (the portable copy), its encryption on the host, the retention of four weeks, the restore and the drill are **DOC-72** (P6). The risk that backups, files and the edge share one provider account is recorded there (DR-66, Owner 2026-10-19).

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
| `s3-access-key-id`, `s3-secret-access-key` | `S3_ACCESS_KEY_ID_FILE`, `S3_SECRET_ACCESS_KEY_FILE` | `api-*`, `worker` | R2 token of §5.5 |
| `smtp-password`, `expo-access-token`, `sms-*` | `SMTP_PASSWORD_FILE`, `EXPO_ACCESS_TOKEN_FILE`, `SMS_*_FILE` | `worker` | the providers (P1-22) |
| `demo-staff-password` | `DEMO_STAFF_PASSWORD_FILE` | `api-*`, `worker` | `keys:generate --out` (≥ 12 characters) |
| `tunnel-token` ¹ | `--token-file` | `cloudflared` | Cloudflare (§5.2) |
| `grafana-admin-password` ¹ | `GF_SECURITY_ADMIN_PASSWORD__FILE` | `grafana` | `keys:generate --out` |
| `telegram-bot-token`, `alertmanager-smtp-password` ¹ | read by `alertmanager.yml` as `bot_token_file`, `smtp_auth_password_file` | `alertmanager` | the bot and the second mail account (§2 input 11) |
| `/etc/pgbackrest/pgbackrest.conf` ¹ | the R2 backup key and the repository passphrase | pgBackRest on the host | §8.4 |
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

Expected: `created 17 files`; a second run prints `kept 17 files` and changes nothing (CF-16). `--env staging` and `production` make `keys:generate` refuse a plain `.env.local` form (DOC-41 §2 rule 4).

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
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_PUBLIC_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=rms-staging-files
S3_FORCE_PATH_STYLE=false
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

Production: `APP_ENV=production`, `OPENAPI_ENABLED=false` (the boot guard refuses `true`), `SMS_DRIVER=provider`, `MAIL_DRIVER=smtp`, `SMS_BRAND=<brand>`, the production hosts and bucket, and the four `STORE_URL_*` (Owner input); `SMS_ALLOWLIST` and `MAIL_ALLOWLIST` are removed. Every other key keeps its default (DOC-41 §16). A key that is set in a way DOC-41 §17 refuses stops the boot with `config_invalid`, exit 78, so a typo is found at the first start of the first deploy.

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
| pgBackRest passphrase | The host, and a sealed offline copy with the Owner | Every backup unreadable (DR-66) |
| `settings-encryption-keys`, `jwt-keys`, `qr-keys` | The host only | The gateway credentials are entered again; tokens and QR codes are reissued (RB-12) |
| `tunnel-token` | The host and Cloudflare | Create a new connector token in the dashboard; replace the file |
| CI secrets | GitHub | Recreate; the host is unaffected |

Rotation steps for each key are RB-12 (P6). Nothing in §9 enters the image, the repository, the CI logs or `/metrics` (DR-65, SC-20…22).

## 10. Monitoring files

The behavior, metrics, rules and dashboards are DOC-40; the files and their mounts are here. Every file is under `ops/`.

| File | Service | What it holds |
| --- | --- | --- |
| `prometheus/prometheus.yml` | Prometheus | `global: scrape_interval: 15s, evaluation_interval: 15s`, `external_labels: {env: staging}`, `rule_files: [rules/*.yml]`, `alerting` to `alertmanager:9093`; scrape jobs below |
| `prometheus/rules/*.yml` | Prometheus | The alert rules of DOC-40 §5, one file per group; `promtool check rules` runs in `verify` |
| `alertmanager/alertmanager.yml` | Alertmanager | The skeleton of DOC-40 §6 (routes, inhibition, receivers) with `bot_token_file` and `smtp_auth_password_file` |
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

`api-2:3001` is absent on staging: the file is generated from a template by `deploy.sh` for the environment (`prometheus.yml.tmpl`, `RMS_ENV`), or the target is left in and shows `down`; P1-18 chooses (an `up == 0` alert for a target that never existed would fire, so the template form is the proposal). Prometheus keeps 15 days and at most 1,800 MB (§6.1).

`alloy/config.alloy` (skeleton; **P1-18 checks** every option name against Alloy 1.20.1, DOC-40 §2):

```
discovery.docker "rms" {
  host = "unix:///var/run/docker.sock"
  filter { name = "label", values = ["com.docker.compose.project=rms"] }
}
discovery.relabel "rms" {
  targets = discovery.docker.rms.targets
  rule { source_labels = ["__meta_docker_container_label_com_docker_compose_service"], target_label = "service" }
  rule { source_labels = ["__meta_docker_container_name"], regex = "/(.*)", target_label = "container" }
  rule { target_label = "env", replacement = sys.env("RMS_ENV") }
}
loki.source.docker "rms" {
  host       = "unix:///var/run/docker.sock"
  targets    = discovery.relabel.rms.output
  forward_to = [loki.process.rms.receiver]
}
loki.process "rms" {
  stage.json   { expressions = { level = "level" } }
  stage.labels { values = { level = "" } }                 // the four labels: env, service, container, level
  // drop the request lines of /health*: the stage that matches {msg="request", route=~"/health.*"}
  forward_to = [loki.write.local.receiver]
}
loki.write "local" { endpoint { url = "http://loki:3100/loki/api/v1/push" } }
```

Grafana's public host is `monitor(-staging).<domain>` behind Access (§5.2); its own sign-in (the admin password) stays (DR-88). Alert delivery needs the two secrets of §9.1 and the test of DOC-40 §6 (the first of each month).

## 11. First deploy, step by step

The whole sequence for staging. Production is the same with its values. Time: about half a day the first time (planned).

| Step | Do | Expected |
| --- | --- | --- |
| 1 | §2: inputs 2 to 5 and 14 are known | The table has no *Open* in those rows |
| 2 | §5.1: the zone is **Active**; Bot Fight Mode off | Dashboard shows Active |
| 3 | §5.5: buckets, CORS, the two tokens | `wrangler r2 bucket list` shows both |
| 4 | §4.1 to §4.7 on the VPS (firewall still off) | `docker compose version` v5.6.0; the network `rms` exists |
| 5 | §8.1 to §8.4: PostgreSQL, the cluster, roles, the stanza, the first full backup | `pgbackrest info` shows a full backup |
| 6 | §9.1: generate the secrets; paste the Tunnel token, the R2 files credentials, the pgBackRest values | 17 files, modes as listed |
| 7 | §9.2: write `app.env` and `compose.env` | `config` check below passes |
| 8 | §5.2: create the Tunnel and its three routes, the Access applications and the service token | The Tunnel is created |
| 9 | CI step: a merge to `dev` builds and publishes `sha-<7>` (DR-239); or by hand: `docker pull` the image and upload `docker/` and `ops/` as `/opt/rms/incoming/sha-<7>.tgz` | The image and the tarball exist |
| 10 | **First deploy only**, while SSH on the VPS's public address still works (§4.9 step 1; the Tunnel is not up before this deploy starts `cloudflared`): from a checkout of the commit, `tar -czf - docker ops \| ssh deploy@<VPS IP> 'cat > /opt/rms/incoming/sha-<7>.tgz'`, then `ssh deploy@<VPS IP> "bash -s -- sha-<7>" < ops/deploy/deploy.sh`. Every later deploy goes through the Tunnel (DOC-71 §7.1) | `deploy ok sha-<7> in <n> s`; all containers `healthy` |
| 11 | The Tunnel shows **Healthy**; from a laptop: `curl -s https://api-staging.<domain>/api/v1/health/ready` | `{"status":"ok","maintenance":false}` |
| 12 | §4.9 steps 3 to 5: SSH through the Tunnel, then `ufw --force enable` | A session through `ssh-staging.<domain>`; `ufw status` active |
| 13 | `ops/deploy/smoke.sh staging` from a laptop with the staging variables | `smoke passed (staging)` |
| 14 | Web: `wrangler pages deploy` (DOC-71 §8) and open `https://admin-staging.<domain>` | The Access login page, then the CMS sign-in |
| 15 | §10: Grafana at `https://monitor-staging.<domain>`; a test alert (DOC-40 §6) | Dashboard loads; email and Telegram arrive |
| 16 | Reboot (§14 check 9) | Every container is `healthy` within 5 minutes without a command |

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
| R2, Tunnel, Pages, tokens, keys | own | own: nothing is shared across environments except the Cloudflare account, the zone and its one rate rule |

## 13. Teardown

Order matters: data first, then access, then the host.

1. Announce; set maintenance on (§6.4) if users exist.
2. Take a last backup and a `pg_dump` (DOC-72) and copy them to a place the Owner controls **outside** this account. Record where.
3. `ops/deploy/deploy.sh` is not needed: on the host `docker compose … down` (volumes kept for now); `systemctl disable --now rms-backup@full.timer rms-backup@diff.timer`.
4. Cloudflare, in this order: delete the Access applications and the service token `deploy-ci`; delete the Tunnel (the dashboard removes its DNS records); delete the Pages project and its custom domain; empty and delete the two R2 buckets (an R2 bucket must be empty before it is deleted) and revoke the two R2 tokens; remove the WAF, configuration and cache rules and the rate rule for that environment.
5. GitHub: delete the environment secrets of that environment and the deploy key; delete the GHCR read token.
6. Destroy the VPS at the provider and its snapshots. Revoke the operators' SSH keys wherever they were copied.
7. Personal data in the database or in the buckets is erased by 2 and 4; a copy kept by the Owner is theirs to protect or destroy (DR-58, DOC-35).

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
| 8 | `pgbackrest info`; wait for the next differential; `backup_last_success_timestamp` in Prometheus | A backup exists; the timestamp moves after 02:00 ICT | NFR-11, OB- |
| 9 | Reboot the VPS | After the reboot, with no command: PostgreSQL up, all containers `healthy` in 5 minutes, the Tunnel Healthy, the smoke test passes | §6.2 |
| 10 | A deploy of a second tag with a new migration | `deploy ok`; the old container served until `api-1` was recreated; the probe saw no failure | NFR-10 |
| 11 | `deploy.sh --rollback` then the smoke test; time it | Within 10 minutes; written in §6.6 | DR-08 |
| 12 | Stop the database (`systemctl stop postgresql@18-main`) | `/api/v1/health/ready` is 503; `ReadinessFailing` fires; the email and Telegram arrive within 2 minutes | OB-14 |
| 13 | A PITR restore onto an empty host from this repository | Works and is timed (formerly spike S-09; the drill is EXP-12) | NFR-11 |
| 14 | Cloudflare: the rate rule | A script of 150 requests in 10 s to `/api/v1/auth/staff/login` from one IP is blocked for 10 s; ordinary traffic passes | §5.3 |
| 15 | Webhook skip: `POST /api/v1/payments/webhooks/payos/<id>` without a signature | 401 `invalid_signature` from the application, not a Cloudflare block page | SC-11 |
| 16 | `unattended-upgrade --dry-run -d` | PostgreSQL, pgBackRest and Docker packages are in the blacklist | §4.5 |

## 15. Risks recorded here

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| One VPS per environment | The loss of the host is an RTO of up to 4 h | Rebuild from this document and restore (RB-10); the Owner accepted it (DR-83) |
| Backups, files and the edge share one Cloudflare account | An account compromise or suspension affects all | Accepted by the Owner (DR-66); recorded in DOC-72 |
| Docker is a dependency of SSH over the Tunnel (`cloudflared` is a container) | A broken Docker daemon removes the SSH path | The provider console (§14 check 2) |
| `deploy` is root-equivalent | A leaked CI key is a root on that host | Access service token, pinned host key, per-environment keys, nothing shared (§3.3) |
| The Docker socket in Alloy | A compromised Alloy is root | Official image, read-only intent, no inbound; revisit if Loki is dropped |
| Access on the web CMS does not protect the API | A stolen staff password still works against the API | Application limits and lockout (DOC-39 §3); not an Access matter |
| A new web staff member is not in `rms-web-staff` | They see the Access page, not the CMS | The Admin's checklist for creating a staff member (DOC-67 owes the line) |
| Bot Fight Mode off | No bot challenge on any host of the zone | Managed WAF, the app's buckets, the rate rule (§5.3) |
| Cloudflare free-plan limits change | A rule may stop being allowed | §5 states the dates read; P1-20 re-reads them |

## 16. Decisions made while writing

Every new decision in this document is recorded as a DR (decided, Claude delegated by the Owner, unless the row says otherwise).

| ID | Title | State | Where used |
| --- | --- | --- | --- |
| DR-158 | Host layout and hardening: `ssh-<env>.<domain>` as the fourth host; `docker/` and `ops/` shipped as one release tarball; configuration hashes passed as an environment variable so Compose recreates only what changed; secret files owned by `deploy`, group `rms` (10001), mode 0440 (revises "root, 0400" of DR-65); unattended upgrades limited to operating-system security updates | Decided | §3.1, §3.2, §4.5, §6.1, §9.1 |
| DR-159 | Cloudflare free-plan rules: the one rate rule on `/api/v1/auth/*` is 100 requests per 10 s per IP, block 10 s, one rule for both hosts; `*.pages.dev` goes behind Access when the plan allows | Decided | §5.3, §5.4 |
| DR-160 | **Bot Fight Mode is off for the zone**, because it cannot be skipped on the free plan (revises DR-83 item 4, DOC-07 TB1, DOC-39 §5.4) | Decided (Owner, 2026-10-20) | §5.3 |
| DR-161 | Staging runs without Loki and Alloy (profile `logs`, production only); `deploy.sh` stops at the first failing step and never rolls back by itself | Decided | §6.1, §6.5 |
| DR-162 | PostgreSQL cluster locale `C.UTF-8` with data checksums; backup timers are systemd timers with `Asia/Ho_Chi_Minh` in `OnCalendar` (full Sunday 02:00, differential Monday to Saturday 02:00) | Decided | §8.1, §8.5 |

## 17. Sources read (2026-10-20)

Cloudflare documentation: rate-limiting rules (free plan: 1 rule, 10 s, IP), Bot Fight Mode and WAF skip (cannot be skipped), SSH with client-side `cloudflared` (route type SSH to `localhost:22`, `ProxyCommand cloudflared access ssh --hostname %h`), Access service tokens (`CF-Access-Client-Id`, `CF-Access-Client-Secret`, Service Auth), Pages `_headers` (100 rules, 2,000 characters, not applied to Functions), Pages custom domains and branch aliases. Caddy documentation: `reverse_proxy` health checks and `flush_interval`, `request_body max_size`, global `servers` `trusted_proxies`, `auto_https off`. pgBackRest configuration reference (S3, cipher, retention, async archive). Expo and PostgreSQL package facts are in DOC-11. A statement in this document that no source here covers is marked **P1-20 checks** or **P1-18 checks**.

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

## 19. Traceability

| Section | Decisions | Requirements and tasks |
| --- | --- | --- |
| §4 hardening, §5.2 SSH | DR-83 item 2, DR-88 | NFR-14; P1-20; check 1 to 4 |
| §5.3 WAF, rate rule | DR-64, DR-83 item 4 | NFR-07; check 14, 15 |
| §5.5 R2 | DR-61, DR-83 item 8 | FR-40; P1-07, P1-20 |
| §6 compose, deploy, experiments | DR-05, DR-06, DR-08, DR-95, DR-102, DR-161 | NFR-03, NFR-10; P1-20; check 9 to 11 |
| §7 Caddy | DR-07, DR-75, DR-83 item 3 | NFR-10; check 5, 6 |
| §8 PostgreSQL, pgBackRest | DR-66, DR-67, DR-93, DR-113 | NFR-11; P1-20; check 8, 13 |
| §9 secrets | DR-65, DR-113, DR-156 | NFR-14; CF-15, CF-16; check 7 |
| §10 monitoring | DR-63, DR-88, DR-154 | NFR-09, NFR-10; P1-18; check 12 |

## Open questions

- **The Owner inputs of §2** are open by design: the documents use placeholders and the real value arrives with the task that needs it (DR-228, decided by the Owner on 2026-10-21; column *Blocking?*). None blocks writing this document or starting P1; the lead times are in §2.
- **DR-160 (Bot Fight Mode off)** weakens the edge relative to DR-83 item 4; the Owner confirmed it on 2026-10-20. The alternative, to keep it on, would let a challenge hit an app or the gateway callback.
- **Whether the free plan offers** *Access for `*.pages.dev`*, accepts the `starts_with` operator and host condition in the one rate rule, and covers the staff count in Access is checked by P1-20.
- **The GHCR token type**, the `cloudflared` flags, the Alertmanager `*_file` keys, the Alloy option names and the `postgres_exporter` options are checked by P1-20 and P1-18 as marked.
- Decisions made while writing: DR-158…162.
