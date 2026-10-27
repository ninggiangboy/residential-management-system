#!/usr/bin/env bash
# usage: rms-backup full|diff   (installed as /usr/local/sbin/rms-backup, run by rms-backup@.service as the user `postgres`)
#
# A pgBackRest backup, then the metric of DR-154: the time of the last success, written for node_exporter's textfile collector
# only after pgBackRest exited 0 (DOC-70 §8.5). `BACKUP_TEXTFILE_DIR` is for the test of this script.
set -euo pipefail
type="${1:?full|diff}"
case "$type" in full | diff) ;; *) echo "usage: rms-backup full|diff"; exit 2 ;; esac
pgbackrest --stanza=rms --type="$type" backup
d="${BACKUP_TEXTFILE_DIR:-/var/lib/node_exporter/textfile}"
t=$(mktemp "$d/.backup.XXXXXX")
printf '# TYPE backup_last_success_timestamp gauge\nbackup_last_success_timestamp %s\n' "$(date +%s)" > "$t"
chmod 0644 "$t"
mv "$t" "$d/backup.prom"
