#!/usr/bin/env bash
# usage: ci-deploy.sh staging|production <tag> | --prepare | --finish | --rollback | --running-tag | --tags
# env: DOMAIN, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
#   --prepare / --finish also: RMS_SECRETS_PACK (secret: a base64 tar.gz of the secret files, made by `bun run secrets:push`) and
#   GITHUB_REPOSITORY_OWNER; optional HOST_IP, HOST_INITIAL_USER (default root), RMS_DATA_DEVICE, OPERATOR_SSH_KEYS and
#   RMS_APP_ENV_EXTRA (lines appended to app.env). The two env files are ops/env/<env>.compose.env and <env>.app.env, filled in here.
#
# What a GitHub runner does to reach a host that denies all inbound traffic, SSH included (DOC-71 §7.1, DOC-70 §3.3): `sshd` is
# behind the Tunnel route `ssh-<env>.<domain>`, Access lets the service token `deploy-ci` through, and the host key is pinned
# in `DEPLOY_KNOWN_HOSTS`. Then it uploads `docker/` and `ops/` of this checkout and streams `ops/deploy/deploy.sh` of the same
# commit, so the script that deploys a release is the script of that release.
#   <tag>           upload this checkout as <tag> and deploy it
#   --prepare       make the host ready (ops/host/bootstrap.sh prepare): skipped when /var/lib/rms/prepared holds the stamp of these
#                   inputs; reaches a host that is not yet behind the Tunnel through HOST_IP (DR-273)
#   --finish        what needs the running stack (buckets, pgBackRest stanza, backup timers, firewall)
#   --rollback      redeploy the tag stored as `previous` (no upload: the release is still on the host)
#   --running-tag   print the tag that runs (the weekly image scan reads it)
#   --tags          print the tag that runs and the one a rollback would redeploy, one per line (the GHCR retention keeps both)
# `HOME` is where `~/.ssh` is made; `CLOUDFLARED_BIN` is for the tests.
set -euo pipefail
env="${1:?usage: ci-deploy.sh staging|production <tag>|--rollback|--running-tag|--tags}"
action="${2:?tag, --rollback, --running-tag or --tags}"
case "$env" in staging | production) ;; *) echo "unknown environment: $env"; exit 2 ;; esac
sfx=$([ "$env" = staging ] && echo -staging || echo "")
host="ssh$sfx.${DOMAIN:?DOMAIN}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"

install -m 700 -d "$HOME/.ssh"
(umask 077 && printf '%s\n' "${DEPLOY_SSH_KEY:?DEPLOY_SSH_KEY}" > "$HOME/.ssh/id_deploy")
printf '%s\n' "${DEPLOY_KNOWN_HOSTS:?DEPLOY_KNOWN_HOSTS}" > "$HOME/.ssh/known_hosts"
cat > "$HOME/.ssh/config" <<CONFIG
Host $host
  User deploy
  IdentityFile $HOME/.ssh/id_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  ProxyCommand ${CLOUDFLARED_BIN:-cloudflared} access ssh --hostname %h
CONFIG
# The token is read from the environment by cloudflared, so it is not in the file above.
export TUNNEL_SERVICE_TOKEN_ID="${CF_ACCESS_CLIENT_ID:?CF_ACCESS_CLIENT_ID}"
export TUNNEL_SERVICE_TOKEN_SECRET="${CF_ACCESS_CLIENT_SECRET:?CF_ACCESS_CLIENT_SECRET}"

# Where to log in. The Tunnel when it answers; otherwise the public address, which only a host that is not yet prepared (or whose
# Tunnel is down) still offers: `ops` first, then the provider's first user. SSH is the command, VIA says which door it is.
ssh_ip=(-o ProxyCommand=none -o IdentitiesOnly=yes -i "$HOME/.ssh/id_deploy" -o StrictHostKeyChecking=accept-new
  -o "UserKnownHostsFile=$HOME/.ssh/known_hosts_ip" -o BatchMode=yes -o ConnectTimeout=20)
route() { # user...
  VIA=tunnel
  RUSER="$1"
  SSH=(ssh -o BatchMode=yes -o ConnectTimeout=20 -l "$RUSER" "$host")
  if "${SSH[@]}" true < /dev/null 2> /dev/null; then return 0; fi
  [ -n "${HOST_IP:-}" ] || { echo "the host does not answer through the Tunnel and HOST_IP is not set"; return 1; }
  VIA=direct
  for RUSER in "$@"; do
    SSH=(ssh "${ssh_ip[@]}" -l "$RUSER" "$HOST_IP")
    if "${SSH[@]}" true < /dev/null 2> /dev/null; then
      ssh-keygen -lf "$HOME/.ssh/known_hosts_ip" 2> /dev/null | sed 's/^/host key seen on first contact: /' || true
      return 0
    fi
  done
  echo "no login worked through the Tunnel or $HOST_IP as: $*"
  return 1
}
sudo_for() { [ "$1" = root ] && echo "" || echo "sudo -n"; }

case "$action" in
  --running-tag)
    ssh "$host" "sed -n 's/^current=//p' /var/lib/rms/deploy-state"
    ;;
  --tags)
    ssh "$host" "sed -n 's/^\(current\|previous\)=//p' /var/lib/rms/deploy-state" | grep -v '^none$' || true
    ;;
  --prepare)
    work=$(mktemp -d)
    trap 'rm -rf "$work"' EXIT
    mkdir "$work/inputs"
    # shellcheck source=../lib/render.sh
    . "$repo/ops/lib/render.sh"
    [ -f "$repo/ops/env/$env.compose.env" ] || { echo "no ops/env/$env.compose.env: $env is not built yet"; exit 2; }
    export GHCR_OWNER="${GITHUB_REPOSITORY_OWNER:?GITHUB_REPOSITORY_OWNER}"
    GHCR_OWNER=$(printf '%s' "$GHCR_OWNER" | tr '[:upper:]' '[:lower:]')
    render_template "$repo/ops/env/$env.compose.env" DOMAIN GHCR_OWNER > "$work/inputs/compose.env"
    { render_template "$repo/ops/env/$env.app.env" DOMAIN; printf '%s\n' "${RMS_APP_ENV_EXTRA:-}"; } | grep -v '^$' > "$work/inputs/app.env"
    printf '%s' "${RMS_SECRETS_PACK:?RMS_SECRETS_PACK}" | base64 -d > "$work/inputs/secrets.tgz"
    { ssh-keygen -y -f "$HOME/.ssh/id_deploy" | sed 's/$/ ci-deploy/'; printf '%s\n' "${OPERATOR_SSH_KEYS:-}"; } | grep . > "$work/inputs/authorized_keys"
    printf 'RMS_DATA_DEVICE=%q\n' "${RMS_DATA_DEVICE:-}" > "$work/inputs/host.env"
    # the stamp: the files that make the host and the values they are made from; a change of either runs the phase again
    stamp=$( (cd "$repo" && find ops/host ops/postgres ops/seaweedfs ops/backup ops/pgbackrest ops/lib ops/env -type f | sort | xargs cat; cat "$work"/inputs/*) | sha256sum | cut -d' ' -f1)
    echo "$stamp" > "$work/inputs/stamp"
    if [ "$(ssh -o BatchMode=yes -o ConnectTimeout=20 "$host" 'cat /var/lib/rms/prepared 2>/dev/null' < /dev/null 2> /dev/null || true)" = "$stamp" ]; then
      echo "host prepared: the stamp matches"
      exit 0
    fi
    route ops "${HOST_INITIAL_USER:-root}"
    tar -czf "$work/payload.tgz" -C "$repo" docker ops -C "$work" inputs
    echo "preparing the host through the $VIA door as $RUSER"
    # shellcheck disable=SC2029
    "${SSH[@]}" "cat > .rms-bootstrap.tgz && chmod 600 .rms-bootstrap.tgz" < "$work/payload.tgz"
    # The script runs from a file, not from stdin: apt, docker and mkfs would read the rest of a streamed script.
    # shellcheck disable=SC2029
    "${SSH[@]}" "p=\$HOME/.rms-bootstrap.tgz; s=\$(mktemp); tar -xzf \"\$p\" -O ops/host/bootstrap.sh > \"\$s\"; $(sudo_for "$RUSER") bash \"\$s\" prepare $env \"\$p\" < /dev/null; rc=\$?; rm -f \"\$p\" \"\$s\"; exit \$rc"
    ;;
  --finish)
    route ops "${HOST_INITIAL_USER:-root}"
    # shellcheck disable=SC2029
    "${SSH[@]}" "s=\$(mktemp); cat > \"\$s\"; $(sudo_for "$RUSER") bash \"\$s\" finish $env $VIA < /dev/null; rc=\$?; rm -f \"\$s\"; exit \$rc" < "$repo/ops/host/bootstrap.sh"
    ;;
  --rollback)
    ssh "$host" "bash -s -- --rollback" < "$repo/ops/deploy/deploy.sh"
    ;;
  *)
    case "$action" in
      sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f] | v[0-9]*.[0-9]*.[0-9]*) ;;
      *) echo "not a release tag: $action"; exit 2 ;;
    esac
    # The tag is checked above, so expanding it on this side is the point: it names the file and the argument.
    # shellcheck disable=SC2029
    # The first deploy starts `cloudflared`, so before it the Tunnel cannot answer: with HOST_IP set, a dead Tunnel means the public address.
    SSH=(ssh "$host")
    if [ -n "${HOST_IP:-}" ] && ! ssh -o BatchMode=yes -o ConnectTimeout=20 "$host" true < /dev/null 2> /dev/null; then
      SSH=(ssh "${ssh_ip[@]}" -l deploy "$HOST_IP")
    fi
    tar -czf - -C "$repo" docker ops | "${SSH[@]}" "cat > /opt/rms/incoming/$action.tgz"
    # shellcheck disable=SC2029
    "${SSH[@]}" "bash -s -- $action" < "$repo/ops/deploy/deploy.sh"
    ;;
esac
