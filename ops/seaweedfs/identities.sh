#!/usr/bin/env bash
# usage: identities.sh <env>        (as `deploy`, on the host; DOC-70 §5.5 step 3)
#
# Makes the S3 identities of the object store: the files pair is the application's (`s3-access-key-id`, `s3-secret-access-key`,
# from `keys:generate --out`); the backup pair (pgBackRest), the admin pair (the operator, once) and the pgBackRest passphrase
# are made here if they do not exist. Then renders `seaweedfs-s3-config` from `s3-config.template.json`. A file that exists is
# kept, so a second run changes nothing but the rendering. `RMS_SECRETS_DIR` moves the folder for the tests.
set -euo pipefail
env="${1:?usage: identities.sh staging|production}"
case "$env" in staging | production) ;; *) echo "usage: identities.sh staging|production"; exit 2 ;; esac
secrets="${RMS_SECRETS_DIR:-/etc/rms/secrets}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/render.sh
. "$here/../lib/render.sh"

make() { # name, command that prints the value
  [ -e "$secrets/$1" ] && return 0
  (umask 0277 && eval "$2" > "$secrets/$1")
  echo "made $1"
}
make seaweedfs-backup-access-key "echo rms\$(openssl rand -hex 8)"
make seaweedfs-backup-secret-key "openssl rand -hex 24"
make seaweedfs-admin-access-key "echo rms\$(openssl rand -hex 8)"
make seaweedfs-admin-secret-key "openssl rand -hex 24"
make pgbackrest-cipher-pass "openssl rand -base64 32"

RMS_ENV="$env"
FILES_ACCESS_KEY="$(tr -d '\n' < "$secrets/s3-access-key-id")"
FILES_SECRET_KEY="$(tr -d '\n' < "$secrets/s3-secret-access-key")"
BACKUP_ACCESS_KEY="$(tr -d '\n' < "$secrets/seaweedfs-backup-access-key")"
BACKUP_SECRET_KEY="$(tr -d '\n' < "$secrets/seaweedfs-backup-secret-key")"
ADMIN_ACCESS_KEY="$(tr -d '\n' < "$secrets/seaweedfs-admin-access-key")"
ADMIN_SECRET_KEY="$(tr -d '\n' < "$secrets/seaweedfs-admin-secret-key")"
export RMS_ENV FILES_ACCESS_KEY FILES_SECRET_KEY BACKUP_ACCESS_KEY BACKUP_SECRET_KEY ADMIN_ACCESS_KEY ADMIN_SECRET_KEY
out="$secrets/seaweedfs-s3-config"
rm -f "$out"
render_template "$here/s3-config.template.json" RMS_ENV FILES_ACCESS_KEY FILES_SECRET_KEY BACKUP_ACCESS_KEY BACKUP_SECRET_KEY ADMIN_ACCESS_KEY ADMIN_SECRET_KEY | (umask 0227 && cat > "$out")
echo "rendered seaweedfs-s3-config"
