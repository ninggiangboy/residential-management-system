#!/usr/bin/env bash
# usage: ci-deploy.sh staging|production <tag> | --rollback | --running-tag | --tags
# env: DOMAIN, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET
#
# What a GitHub runner does to reach a host that denies all inbound traffic, SSH included (DOC-71 §7.1, DOC-70 §3.3): `sshd` is
# behind the Tunnel route `ssh-<env>.<domain>`, Access lets the service token `deploy-ci` through, and the host key is pinned
# in `DEPLOY_KNOWN_HOSTS`. Then it uploads `docker/` and `ops/` of this checkout and streams `ops/deploy/deploy.sh` of the same
# commit, so the script that deploys a release is the script of that release.
#   <tag>           upload this checkout as <tag> and deploy it
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

case "$action" in
  --running-tag)
    ssh "$host" "sed -n 's/^current=//p' /var/lib/rms/deploy-state"
    ;;
  --tags)
    ssh "$host" "sed -n 's/^\(current\|previous\)=//p' /var/lib/rms/deploy-state" | grep -v '^none$' || true
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
    tar -czf - -C "$repo" docker ops | ssh "$host" "cat > /opt/rms/incoming/$action.tgz"
    # shellcheck disable=SC2029
    ssh "$host" "bash -s -- $action" < "$repo/ops/deploy/deploy.sh"
    ;;
esac
