#!/usr/bin/env bash
# usage: bootstrap.sh prepare <env> <payload.tgz> | finish <env> <direct|tunnel>        (as root, on the host)
#
# Builds a fresh VPS up to the point where `deploy.sh` can run, and finishes what only a running stack allows (DOC-70 §4 to §8,
# §11; DR-273). CI streams this file over SSH (`ci-deploy.sh --prepare`, `--finish`), so the host needs nothing before the first
# run but Ubuntu and the CI key for one login. Every step looks at the host first and changes only what is missing or different, so
# a second run changes nothing. The values come from GitHub, not from the operator: the payload holds `docker/` and `ops/` of the
# commit and `inputs/` (compose.env, app.env, secrets.tgz, authorized_keys, host.env, stamp).
#   prepare   packages, users, SSH hardening, Docker and the network, the data volume, env files and secret files, the CA and the
#             object-store identities, PostgreSQL 18 with its roles and pgBackRest. It ends by writing /var/lib/rms/prepared (the
#             stamp), which `ci-deploy.sh` compares to skip the whole phase.
#   finish    after `deploy.sh` started the stack: the buckets and the CORS rule, the pgBackRest stanza and first backup, the backup
#             timers and, only when CI came through the Tunnel, the firewall (DOC-70 §4.9: never close the only door first).
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

phase="${1:?usage: bootstrap.sh prepare <env> <payload.tgz> | finish <env> <direct|tunnel>}"
env="${2:?staging|production}"
case "$env" in staging | production) ;; *) echo "unknown environment: $env"; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo "bootstrap.sh runs as root"; exit 1; }

DOCKER_VERSION=29.9.1 # DOC-11 §1
AWS_CLI_IMAGE=amazon/aws-cli:2.38.5 # the local stack's tag (DOC-70 §5.5 step 5)
RMS_UID=10001
log() { echo "bootstrap: $*"; }
# install a file only when its content or mode differs, and set `changed` so the caller restarts the service only then
changed=0
put() { # mode owner:group source target
  if [ -f "$4" ] && cmp -s "$3" "$4" && [ "$(stat -c '%a' "$4")" = "$(printf '%o' "$((8#$1))")" ]; then return 0; fi
  install -m "$1" -o "${2%%:*}" -g "${2##*:}" "$3" "$4"
  changed=1
}
as_deploy() { runuser -u deploy -- "$@"; }

if [ "$phase" = finish ]; then
  via="${3:?direct|tunnel}"
  # shellcheck source=/dev/null
  . /opt/rms/env/compose.env
  sfx="${RMS_HOST_SUFFIX:-}"
  secrets=/etc/rms/secrets

  # 1. buckets and the CORS rule of the files bucket (DOC-70 §5.5 step 5)
  aws() {
    as_deploy docker run --rm --network rms -v /etc/rms/tls/ca.pem:/ca.pem:ro -v "$cors:/cors.json:ro" \
      -e AWS_ACCESS_KEY_ID="$(tr -d '\n' < "$secrets/seaweedfs-admin-access-key")" \
      -e AWS_SECRET_ACCESS_KEY="$(tr -d '\n' < "$secrets/seaweedfs-admin-secret-key")" \
      -e AWS_DEFAULT_REGION=auto -e AWS_CA_BUNDLE=/ca.pem "$AWS_CLI_IMAGE" --endpoint-url https://seaweedfs:8333 "$@" < /dev/null
  }
  cors=$(mktemp)
  trap 'rm -f "$cors"' EXIT
  chmod 0644 "$cors"
  printf '{"CORSRules":[{"AllowedOrigins":["https://admin%s.%s"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}\n' \
    "$sfx" "$RMS_DOMAIN" > "$cors"
  for kind in files backup; do
    bucket="rms-$env-$kind"
    aws s3api head-bucket --bucket "$bucket" > /dev/null 2>&1 || { aws s3api create-bucket --bucket "$bucket" > /dev/null; log "bucket $bucket created"; }
  done
  aws s3api put-bucket-cors --bucket "rms-$env-files" --cors-configuration file:///cors.json > /dev/null
  log "buckets and CORS ok"

  # 2. pgBackRest stanza, check and the first full backup (DOC-70 §8.4)
  pgb() { # quiet on success; on failure its whole output, which is where pgBackRest says why
    local out
    out=$(runuser -u postgres -- pgbackrest --stanza=rms "$@" 2>&1) || { echo "$out"; echo "pgbackrest $* failed"; return 1; }
  }
  pgb stanza-create
  pgb check
  if ! runuser -u postgres -- pgbackrest --stanza=rms info 2> /dev/null | grep -q 'full backup'; then
    log "first full backup"
    pgb --type=full backup
  fi
  systemctl enable --now rms-backup@full.timer rms-backup@diff.timer > /dev/null
  log "pgBackRest ok"

  # 3. firewall: only when this session came through the Tunnel, so the door CI used is still open afterwards (DOC-70 §4.9)
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  ufw allow in on br-rms to 172.30.0.1 port 22,5432 proto tcp comment 'containers: cloudflared to sshd, apps to PostgreSQL' > /dev/null
  if ufw status | grep -q '^Status: active'; then
    log "firewall already on"
  elif [ "$via" = tunnel ]; then
    ufw --force enable > /dev/null
    log "firewall on: no inbound port is open"
  else
    log "firewall left off: this session did not come through the Tunnel"
  fi
  exit 0
fi

[ "$phase" = prepare ] || { echo "unknown phase: $phase"; exit 2; }
payload="${3:?payload.tgz}"
work=$(mktemp -d /run/rms-bootstrap.XXXXXX)
trap 'rm -rf "$work"' EXIT
tar -xzf "$payload" -C "$work"
in="$work/inputs"
chmod 0755 "$work" # `deploy` runs tls.sh and identities.sh from here
chmod 0700 "$in"
# shellcheck source=/dev/null
. "$in/host.env"
secrets=/etc/rms/secrets
tls=/etc/rms/tls

# 1. base system (DOC-70 §4.1)
log "base system"
apt-get update -qq
apt-get -y -qq install ca-certificates curl gnupg lsb-release ufw unattended-upgrades jq openssl openssh-server > /dev/null
timedatectl set-timezone UTC
hostnamectl set-hostname "rms-$env"
grep -q "[[:space:]]rms-$env\$" /etc/hosts || echo "127.0.1.1 rms-$env" >> /etc/hosts # sudo resolves its own host name

# 2. swap and kernel settings (DR-102)
log "swap and kernel"
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  [ -f /swapfile ] || { fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null; }
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
put 0644 root:root "$work/ops/host/sysctl-rms.conf" /etc/sysctl.d/90-rms.conf
[ "$changed" = 0 ] || sysctl --system > /dev/null
changed=0

# 3. users, groups and the CI key (DOC-70 §4.3). The CI key logs in as `deploy` and as `ops`.
log "users"
getent group rms > /dev/null || groupadd --gid "$RMS_UID" rms
id deploy > /dev/null 2>&1 || adduser --disabled-password --gecos "" deploy > /dev/null
id ops > /dev/null 2>&1 || adduser --disabled-password --gecos "" ops > /dev/null
usermod -aG sudo ops
usermod -aG rms deploy
usermod -aG rms ops
echo 'ops ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-ops
chmod 440 /etc/sudoers.d/90-ops
for u in deploy ops; do
  install -d -m 700 -o "$u" -g "$u" "/home/$u/.ssh"
  install -m 600 -o "$u" -g "$u" "$in/authorized_keys" "/home/$u/.ssh/authorized_keys"
done
install -d -o deploy -g deploy /opt/rms /opt/rms/incoming /opt/rms/releases /opt/rms/env /var/lib/rms
install -d -m 0750 -o deploy -g rms "$secrets" "$tls"

# 4. unattended upgrades: security only, never the database or Docker (DOC-70 §4.5)
put 0644 root:root "$work/ops/host/unattended-upgrades-rms.conf" /etc/apt/apt.conf.d/52rms-unattended
changed=0

# 5. Docker Engine, the daemon settings and the application network (DOC-70 §4.6)
log "Docker"
if ! command -v docker > /dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  # shellcheck source=/dev/null
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $codename stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  full=$(apt-cache madison docker-ce | awk -v v="$DOCKER_VERSION" '$3 ~ ("^5:" v "-") { print $3; exit }')
  [ -n "$full" ] || { echo "docker-ce $DOCKER_VERSION is not in the repository for $codename"; exit 1; }
  apt-get -y -qq install "docker-ce=$full" "docker-ce-cli=$full" containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
  apt-mark hold docker-ce docker-ce-cli docker-compose-plugin > /dev/null
fi
put 0644 root:root "$work/ops/host/daemon.json" /etc/docker/daemon.json
[ "$changed" = 0 ] || systemctl restart docker
changed=0
systemctl enable --now docker > /dev/null 2>&1
usermod -aG docker deploy
docker network inspect rms > /dev/null 2>&1 ||
  docker network create --driver bridge --subnet 172.30.0.0/24 --gateway 172.30.0.1 -o com.docker.network.bridge.name=br-rms rms > /dev/null

# 6. the data volume of the object store (DOC-70 §5.5 step 1). Without a device the OS disk is used and the log says so.
log "data volume"
install -d -m 0755 /srv/rms-data
if ! mountpoint -q /srv/rms-data; then
  if [ -n "${RMS_DATA_DEVICE:-}" ]; then
    blkid "$RMS_DATA_DEVICE" > /dev/null 2>&1 || mkfs.ext4 -q -L rms-data "$RMS_DATA_DEVICE"
    grep -q ' /srv/rms-data ' /etc/fstab || echo 'LABEL=rms-data /srv/rms-data ext4 defaults,nofail 0 2' >> /etc/fstab
    mount /srv/rms-data
  else
    log "WARNING: RMS_DATA_DEVICE is not set; the files and the backups share the OS disk (DR-268 item 3 asks for a separate volume)"
  fi
fi
install -d -m 0755 -o "$RMS_UID" -g "$RMS_UID" /srv/rms-data/seaweedfs

# 7. env files and secret files, from GitHub (DR-273). A `ghcr-*` entry is the pull login, not a secret file of the stack.
log "env and secrets"
install -m 0644 -o deploy -g deploy "$in/compose.env" /opt/rms/env/compose.env
install -m 0644 -o deploy -g deploy "$in/app.env" /opt/rms/env/app.env
mkdir -m 0700 "$work/pack"
tar -xzf "$in/secrets.tgz" -C "$work/pack"
for f in "$work/pack"/*; do
  name=$(basename "$f")
  case "$name" in
    ghcr-* | ssh-host-*) continue ;;
    db-migrator-url | db-*-password) mode=0400 owner=deploy:deploy ;;
    *) mode=0440 owner=deploy:rms ;;
  esac
  install -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$f" "$secrets/$name"
done
# the SSH host key comes from GitHub too, so the key that DEPLOY_KNOWN_HOSTS pins is the host's from the first Tunnel login on
if [ -f "$work/pack/ssh-host-ed25519-key" ]; then
  put 0600 root:root "$work/pack/ssh-host-ed25519-key" /etc/ssh/ssh_host_ed25519_key
  ssh-keygen -y -f /etc/ssh/ssh_host_ed25519_key > "$work/host.pub"
  put 0644 root:root "$work/host.pub" /etc/ssh/ssh_host_ed25519_key.pub
fi
hostkey_changed=$changed
changed=0
if [ -f "$work/pack/ghcr-read-token" ]; then
  tr -d '\n' < "$work/pack/ghcr-read-token" | as_deploy docker login ghcr.io -u "$(tr -d '\n' < "$work/pack/ghcr-user")" --password-stdin > /dev/null
fi

# 8. the CA and the object-store identities, made here the first time and kept (DOC-70 §5.5 steps 2 and 3)
log "object-store certificate and identities"
as_deploy bash "$work/ops/seaweedfs/tls.sh" "$env"
as_deploy bash "$work/ops/seaweedfs/identities.sh" "$env"
# the object store runs as 10001:10001 (group rms) and reads these two; the scripts make them as `deploy` (found on 24.04: unreadable, the gateway never started)
chgrp rms "$secrets/seaweedfs-s3-config" "$secrets/seaweedfs-tls-key"

# 9. PostgreSQL 18, native (DOC-70 §8.1 to §8.4)
log "PostgreSQL"
if ! command -v pg_createcluster > /dev/null || ! dpkg -s postgresql-18 > /dev/null 2>&1; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  # shellcheck source=/dev/null
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $codename-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  # no default cluster: it would take the host's locale and the default listen address
  install -d /etc/postgresql-common
  install -m 0644 "$work/ops/postgres/createcluster.conf" /etc/postgresql-common/createcluster.conf
  apt-get -y -qq install postgresql-18 pgbackrest > /dev/null
  apt-mark hold postgresql-18 pgbackrest > /dev/null
fi
pg_lsclusters --no-header | awk '$1 == 18 && $2 == "main" { found = 1 } END { exit !found }' ||
  pg_createcluster 18 main --locale=C.UTF-8 --encoding=UTF8 -- --data-checksums
install -d /etc/systemd/system/postgresql@18-main.service.d /etc/postgresql/18/main/conf.d
# the packaged postgresql.conf of Ubuntu does not read conf.d once createcluster.conf is replaced (found on 24.04: the settings were silently ignored)
grep -q "^include_dir *= *'conf.d'" /etc/postgresql/18/main/postgresql.conf || {
  echo "include_dir = 'conf.d'" >> /etc/postgresql/18/main/postgresql.conf
  changed=1
}
put 0644 root:root "$work/ops/host/postgres-override.conf" /etc/systemd/system/postgresql@18-main.service.d/override.conf
put 0640 postgres:postgres "$work/ops/postgres/pg_hba.conf" /etc/postgresql/18/main/pg_hba.conf
put 0640 postgres:postgres "$work/ops/postgres/pg_ident.conf" /etc/postgresql/18/main/pg_ident.conf
put 0644 root:root "$work/ops/postgres/rms.conf" /etc/postgresql/18/main/conf.d/rms.conf
put 0644 root:root "$work/ops/postgres/rms-$env.conf" /etc/postgresql/18/main/conf.d/rms-memory.conf
systemctl daemon-reload
if [ "$changed" = 1 ]; then systemctl restart postgresql@18-main; else systemctl enable --now postgresql@18-main > /dev/null 2>&1; fi
changed=0
until runuser -u postgres -- pg_isready -q; do sleep 1; done
app_conn_limit=$([ "$env" = staging ] && echo 45 || echo 80)
pw() { tr -d '\n' < "$secrets/$1"; }
psql_pw=(-v "migrator_password=$(pw db-migrator-password)" -v "app_password=$(pw db-app-password)" -v "readonly_password=$(pw db-readonly-password)")
# roles and the database once; the passwords follow the secret files on every run, so GitHub stays the source of truth
if [ "$(runuser -u postgres -- psql -tAc "select 1 from pg_roles where rolname = 'rms_app'")" != 1 ]; then
  log "creating the roles and the database"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -v db=rms -v "app_conn_limit=$app_conn_limit" "${psql_pw[@]}" < "$work/ops/postgres/0001-provision.sql" > /dev/null
fi
runuser -u postgres -- psql -v ON_ERROR_STOP=1 "${psql_pw[@]}" > /dev/null <<'SQL'
ALTER ROLE rms_migrator PASSWORD :'migrator_password';
ALTER ROLE rms_app PASSWORD :'app_password';
ALTER ROLE rms_readonly PASSWORD :'readonly_password';
SQL

# 10. pgBackRest configuration and the backup timers' files; the stanza and the timers wait for `finish` (DOC-70 §8.4, §8.5)
log "pgBackRest"
bash "$work/ops/pgbackrest/render.sh" "$env"
install -d -m 0750 -o postgres -g postgres /var/spool/pgbackrest
install -d -m 0755 -o postgres -g postgres /var/lib/node_exporter/textfile
install -m 0755 "$work/ops/backup/backup.sh" /usr/local/sbin/rms-backup
for unit in rms-backup@.service rms-backup@full.timer rms-backup@diff.timer; do
  install -m 0644 "$work/ops/backup/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload

# 11. SSH hardening, last: the session that runs this script keeps working (DOC-70 §4.4)
log "SSH"
install -d /etc/ssh/sshd_config.d
put 0644 root:root "$work/ops/host/sshd-rms.conf" /etc/ssh/sshd_config.d/10-rms.conf
if [ "$changed" = 1 ] || [ "$hostkey_changed" = 1 ]; then
  sshd -t # a broken file stops here, with the old configuration still in force
  systemctl reload ssh
fi
changed=0

# 12. the stamp
log "stamp"
install -m 0644 -o deploy -g deploy "$in/stamp" /var/lib/rms/prepared
log "prepared ($env)"
