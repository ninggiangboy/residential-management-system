#!/usr/bin/env bash
# usage: deploy.sh <tag> | --rollback | --maintenance <tag>
#
# Run on the host as `deploy` (DOC-70 §6.5): CI uploads `docker/` and `ops/` as /opt/rms/incoming/<tag>.tgz and streams this file
# over the Tunnel (`ssh host "bash -s -- <tag>" < ops/deploy/deploy.sh`), so the script that deploys a release is the one of that
# release. It stops at the first failing step and prints its number; it never rolls back by itself (DOC-71 §7.2).
# The three paths and the lock can be moved by the environment for the tests of tools/ops-files; on a host they are the defaults.
set -euo pipefail
RMS="${RMS_ROOT:-/opt/rms}"
STATE="${RMS_STATE:-/var/lib/rms/deploy-state}"
LOCK="${RMS_LOCK:-/var/lock/rms-deploy.lock}"

# CI streams this file as the standard input of `bash -s`. A command that reads stdin (`docker compose run` is attached to it) would
# swallow the rest of the script and the deploy would stop half way with a zero exit code: every docker call reads /dev/null.
docker() { command docker "$@" </dev/null; }

# Two deploys never overlap: CI queues them (DOC-71 §3 rule 4) and this is the second net.
if command -v flock >/dev/null; then
  exec 9>"$LOCK"
  flock -n 9 || { echo "another deploy is running"; exit 1; }
fi

set -a
# shellcheck source=/dev/null
. "$RMS/env/compose.env"
set +a
DEPLOY_UID="$(id -u)"
export RMS_TAG RMS_ENV COMPOSE_PROFILES DEPLOY_UID
started=$(date +%s)
step() { echo "step $1/6 $2"; }
fail() { echo "deploy failed at step $1"; exit 1; }

case "${1:-}" in
  --rollback) tag=$(sed -n 's/^previous=//p' "$STATE" 2>/dev/null || true); { [ -n "$tag" ] && [ "$tag" != none ]; } || { echo "no previous tag"; exit 1; } ;;
  --maintenance) maint=1; tag="${2:?tag}" ;;
  "") echo "usage: deploy.sh <tag> | --rollback | --maintenance <tag>"; exit 2 ;;
  *) tag="$1" ;;
esac
case "$tag" in
  sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f] | v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "not a release tag: $tag"; exit 2 ;;
esac
RMS_TAG="$tag"
export RMS_TAG
current=$(sed -n 's/^current=//p' "$STATE" 2>/dev/null || true)

# 1. unpack the release and point /opt/rms/current at it
step 1 unpack
if [ ! -d "$RMS/releases/$tag" ]; then
  rm -rf "$RMS/releases/$tag.partial"
  mkdir -p "$RMS/releases/$tag.partial"
  tar -xzf "$RMS/incoming/$tag.tgz" -C "$RMS/releases/$tag.partial" || fail 1
  mv "$RMS/releases/$tag.partial" "$RMS/releases/$tag"
fi
ln -sfn "$RMS/releases/$tag" "$RMS/current"
cd "$RMS/current"
dc() { docker compose --env-file "$RMS/env/compose.env" -f docker/compose.base.yml -f "docker/compose.$RMS_ENV.yml" "$@"; }
for d in caddy prometheus alertmanager grafana loki alloy; do # a hash of each service's configuration
  v="RMS_CFG_$(echo "$d" | tr '[:lower:]' '[:upper:]')"
  export "$v=$( (find "ops/$d" -type f -print0 2>/dev/null | sort -z | xargs -0 sha256sum 2>/dev/null || true) | sha256sum | cut -c1-16)"
done

# 2. pull images
step 2 pull
docker pull "ghcr.io/$RMS_GHCR_OWNER/rms-api:$tag" >/dev/null || fail 2
dc pull --quiet --ignore-buildable caddy seaweedfs cloudflared prometheus alertmanager grafana postgres-exporter node-exporter || fail 2

# 3. migrations (maintenance on first when asked)
[ "${maint:-0}" = 1 ] && "$RMS/current/ops/deploy/maintenance.sh" on "Planned maintenance" </dev/null
step 3 migrate
dc run --rm -T migrate || fail 3

# 4. edge and monitoring services (recreated only when their config hash changed)
step 4 infrastructure
dc up -d --no-deps caddy seaweedfs cloudflared postgres-exporter node-exporter prometheus alertmanager grafana || fail 4
if [[ ",$COMPOSE_PROFILES," == *",logs,"* ]]; then dc up -d --no-deps loki alloy || fail 4; fi

# 5. rolling restart: worker -> ready -> api-1 -> ready -> api-2. The consumer goes first: an event of a new type that the new `api`
#    writes must find its handler, and a worker that has no handler for a type marks the message as done (DR-272).
step 5 rolling
wait_healthy() { # name, timeout seconds
  local t=$(($(date +%s) + ${2:-90}))
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "rms-$1-1" 2>/dev/null)" = healthy ]; do
    [ "$(date +%s)" -lt "$t" ] || return 1
    sleep "${RMS_POLL_SECONDS:-3}"
  done
}
for svc in worker api-1 api-2; do
  if [ "$svc" = api-2 ] && [[ ",$COMPOSE_PROFILES," != *",api2,"* ]]; then continue; fi
  dc up -d --no-deps --force-recreate "$svc" || fail 5
  wait_healthy "$svc" "${RMS_HEALTH_SECONDS:-90}" || { echo "$svc not healthy"; fail 5; }
done
if [ "${maint:-0}" = 1 ]; then "$RMS/current/ops/deploy/maintenance.sh" off </dev/null; fi

# 6. record the state, prune old releases
step 6 record
for svc in caddy seaweedfs; do # the other long-lived services with a health check (DOC-71 §7.3 step 7)
  wait_healthy "$svc" "${RMS_HEALTH_SECONDS:-60}" || { echo "$svc not healthy"; fail 6; }
done
if [ "$current" != "$tag" ]; then printf 'current=%s\nprevious=%s\n' "$tag" "${current:-none}" > "$STATE"; fi
previous=$(sed -n 's/^previous=//p' "$STATE")
# keep the five newest releases, and never the one running or the one a rollback needs
# shellcheck disable=SC2012 # the names are release tags: `ls -t` sorts them by age
ls -1dt "$RMS"/releases/*/ | sed 's#/$##' | tail -n +6 | while read -r old; do
  case "$(basename "$old")" in "$tag" | "$previous") ;; *) rm -rf "$old" ;; esac
done
rm -f "$RMS"/incoming/*.tgz
echo "deploy ok $tag in $(($(date +%s) - started)) s"
