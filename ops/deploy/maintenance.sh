#!/usr/bin/env bash
# usage: maintenance.sh on "<reason>" | off
#
# Sets or clears the maintenance flag of `platform.maintenance` (DOC-70 §6.4) from the `migrate` container, which holds the one
# secret that may write it. Every process answers 503 `maintenance` while it is on; `/health/ready` stays 200 (E-02).
set -euo pipefail
RMS="${RMS_ROOT:-/opt/rms}"
set -a
# shellcheck source=/dev/null
. "$RMS/env/compose.env"
set +a
RMS_TAG="${RMS_TAG:-$(sed -n 's/^current=//p' "${RMS_STATE:-/var/lib/rms/deploy-state}")}"
DEPLOY_UID="$(id -u)"
export RMS_TAG DEPLOY_UID
cd "$RMS/current"
# </dev/null: this may run with the deploy script as its standard input (see deploy.sh)
docker compose --env-file "$RMS/env/compose.env" -f docker/compose.base.yml -f "docker/compose.$RMS_ENV.yml" \
  run --rm -T migrate bun scripts/maintenance.ts "$@" </dev/null
