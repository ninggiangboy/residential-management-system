#!/usr/bin/env bash
# usage: smoke.sh staging|production
# env: DOMAIN, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, and STAGING_DEMO_PASSWORD on staging
#
# The smoke test of DOC-71 §7.3, run on the CI runner or a laptop against the public hosts, with `curl` and `jq` (DOC-70 §6.5).
# Production runs the public checks only: the pipeline never signs in to the live system.
set -euo pipefail
env="${1:?usage: smoke.sh staging|production}"
case "$env" in staging | production) ;; *) echo "usage: smoke.sh staging|production"; exit 2 ;; esac
sfx=$([ "$env" = staging ] && echo -staging || echo "")
# SMOKE_SCHEME is for the test of this script (tools/ops-files), which serves plain HTTP on localhost.
scheme="${SMOKE_SCHEME:-https}"
api="$scheme://api$sfx.${DOMAIN:?DOMAIN}"
admin="$scheme://admin$sfx.$DOMAIN"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
ok() { echo "smoke ok: $1"; }
bad() { echo "smoke FAILED: $1"; exit 1; }

for i in $(seq 1 12); do # 1. ready, retried for 60 s
  curl -fsS "$api/api/v1/health/ready" | jq -e '.status=="ok" and .maintenance==false' >/dev/null && break
  [ "$i" = 12 ] && bad "ready"
  sleep "${SMOKE_RETRY_SECONDS:-5}"
done
ok ready

curl -fsS -D "$work/cfg.headers" -o "$work/cfg.json" "$api/api/v1/public/config" || bad "config"
grep -qi '^cache-control: public, max-age=60' "$work/cfg.headers" || bad "config cache header"
jq -e '.apps.resident.minVersion and .apps.staff.minVersion' "$work/cfg.json" >/dev/null || bad "config body"
ok config

[ "$(curl -s -o /dev/null -w '%{http_code}' "$api/api/v1/health/live")" = 404 ] || bad "ops route is public"
ok "ops route not public"

curl -fsS -D "$work/admin.headers" -o /dev/null \
  -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID:?CF_ACCESS_CLIENT_ID}" \
  -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET:?CF_ACCESS_CLIENT_SECRET}" "$admin/" || bad "admin page"
grep -qi '^content-security-policy:' "$work/admin.headers" || bad "admin CSP"
ok "admin headers"

if [ "$env" = staging ]; then # sign-in only on staging
  json=(-H 'Content-Type: application/json' -H 'X-App-Id: staff' -H 'X-App-Version: 1.0.0')
  login=$(jq -n --arg password "${STAGING_DEMO_PASSWORD:?STAGING_DEMO_PASSWORD}" \
    '{email: "manager@demo.rms.invalid", password: $password, client: "app"}')
  tok=$(curl -fsS -X POST "$api/api/v1/auth/staff/login" "${json[@]}" -d "$login") || bad "staff login"
  echo "$tok" | jq -e '.accessToken and .refreshToken' >/dev/null || bad "staff login body"
  logout=$(echo "$tok" | jq '{refreshToken: .refreshToken}')
  curl -fsS -o /dev/null -X POST "$api/api/v1/auth/logout" "${json[@]}" -d "$logout" || bad "logout"
  ok "sign-in and sign-out"
fi
echo "smoke passed ($env)"
