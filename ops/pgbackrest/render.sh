#!/usr/bin/env bash
# usage: sudo render.sh <env>        (as root on the host; DOC-70 §8.4)
#
# Writes /etc/pgbackrest/pgbackrest.conf (postgres:postgres, 0600) from `pgbackrest.conf.template` and the secret files that
# `ops/seaweedfs/identities.sh` made, and installs the CA of the object store where pgBackRest reads it. The configuration holds
# the backup key and the passphrase, so it is never printed. `RMS_SECRETS_DIR`, `RMS_TLS_DIR` and `PGBACKREST_DIR` move the
# folders for the tests, and `RMS_BACKUP_ENDPOINT` the gateway (`172.30.0.20:8333`, the address of the container, DOC-70 §6.1); `PGBACKREST_OWNER` is the owner of the output (`postgres:postgres` on a host).
set -euo pipefail
env="${1:?usage: render.sh staging|production}"
case "$env" in staging | production) ;; *) echo "usage: render.sh staging|production"; exit 2 ;; esac
secrets="${RMS_SECRETS_DIR:-/etc/rms/secrets}"
tls="${RMS_TLS_DIR:-/etc/rms/tls}"
dir="${PGBACKREST_DIR:-/etc/pgbackrest}"
owner="${PGBACKREST_OWNER:-postgres:postgres}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/render.sh
. "$here/../lib/render.sh"

install -d -m 0755 "$dir"
install -m 0644 "$tls/ca.pem" "$dir/seaweedfs-ca.pem"
RMS_ENV="$env"
BACKUP_ENDPOINT="${RMS_BACKUP_ENDPOINT:-172.30.0.20:8333}"
BACKUP_CA_FILE="$dir/seaweedfs-ca.pem"
BACKUP_ACCESS_KEY="$(tr -d '\n' < "$secrets/seaweedfs-backup-access-key")"
BACKUP_SECRET_KEY="$(tr -d '\n' < "$secrets/seaweedfs-backup-secret-key")"
BACKUP_CIPHER_PASS="$(tr -d '\n' < "$secrets/pgbackrest-cipher-pass")"
export RMS_ENV BACKUP_ENDPOINT BACKUP_CA_FILE BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_CIPHER_PASS
out="$dir/pgbackrest.conf"
rm -f "$out"
render_template "$here/pgbackrest.conf.template" RMS_ENV BACKUP_ENDPOINT BACKUP_CA_FILE BACKUP_ACCESS_KEY BACKUP_SECRET_KEY BACKUP_CIPHER_PASS | (umask 0177 && cat > "$out")
chown "$owner" "$out" "$dir/seaweedfs-ca.pem" 2>/dev/null || true
echo "wrote $out"
