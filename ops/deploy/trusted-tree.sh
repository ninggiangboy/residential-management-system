#!/usr/bin/env bash
# usage: trusted-tree.sh
# env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, [GITHUB_REF_NAME], [TRUNK=dev], [STAGING=staging], [GITHUB_OUTPUT]
#
# The `trusted` job of a push to the trunk or to `staging` (DOC-71 §4.3, DR-274, DR-276). `bun run pr:merge` merges a pull request only when its head is
# up to date with the trunk and `gate` is green on it, and a rebase merge keeps the content: the tree of the pushed commit is then
# the tree that `gate` already passed. A push to `staging` is a fast-forward of `dev` (DR-276): the commit is the one the push to `dev`
# already checked, so `gate` on that very commit is the answer. When that is so, the push skips verify, unit, integration and security (and e2e-web, if the
# pull request ran it); `build`, `publish` and the deploy still run, because they make and ship the image.
#
# It prints `tested=true|false` and `e2e=passed|none` (to $GITHUB_OUTPUT when set). Anything it cannot establish is `tested=false`
# and exit 0: the push then runs every check, as it did before. A direct push, a changed tree, a head that was not green, a
# missing token or an API error all end there. It never fails the workflow.
set -uo pipefail
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY}"
sha="${GITHUB_SHA:?GITHUB_SHA}"
trunk="${TRUNK:-dev}"
staging="${STAGING:-staging}"
ref="${GITHUB_REF_NAME:-$trunk}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
tested=false
e2e=none
reason="no merged pull request of $trunk has the tree of $sha"

# The latest finished run of a check on a commit: success, failure, skipped, ... or `none`.
conclusion() {
  gh api "repos/$repo/commits/$1/check-runs?check_name=$2&per_page=100" \
    --jq '[.check_runs[] | select(.app.slug == "github-actions")] | sort_by(.completed_at) | last | .conclusion // "none"' 2>/dev/null || echo none
}

# `staging` only ever moves forward to a commit of `dev` (DR-276), so the commit keeps the check runs it got on its push to `dev`.
decide_staging() {
  [ "$(conclusion "$sha" gate)" = success ] || { reason="gate is not green on $sha (is it a commit of $trunk that was checked?)"; return 1; }
  tested=true
  [ "$(conclusion "$sha" e2e-web)" = success ] && e2e=passed
  reason="$sha already passed gate on $trunk (e2e-web: $e2e)"
  return 0
}

decide() {
  local tree pr head head_tree
  if [ "$ref" = "$staging" ]; then decide_staging; return; fi
  tree=$(gh api "repos/$repo/git/commits/$sha" --jq .tree.sha) || { reason="cannot read the commit"; return 1; }
  for pr in $(gh api "repos/$repo/commits/$sha/pulls?per_page=100" \
    --jq ".[] | select(.merged_at != null and .base.ref == \"$trunk\") | .number"); do
    head=$(gh api "repos/$repo/pulls/$pr" --jq .head.sha) || continue
    head_tree=$(gh api "repos/$repo/git/commits/$head" --jq .tree.sha) || continue
    [ "$head_tree" = "$tree" ] || { reason="the tree of #$pr differs from the pushed one"; continue; }
    [ "$(conclusion "$head" gate)" = success ] || { reason="gate is not green on the head of #$pr"; continue; }
    tested=true
    [ "$(conclusion "$head" e2e-web)" = success ] && e2e=passed
    reason="the tree is the one of #$pr, where gate passed (e2e-web: $e2e)"
    return 0
  done
  return 1
}

decide || true
{
  echo "tested=$tested"
  echo "e2e=$e2e"
} >> "$out"
echo "trusted-tree: $reason" >&2
exit 0
