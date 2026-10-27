#!/usr/bin/env bash
# usage: ghcr-cleanup.sh <owner> [--dry-run] [<tag that must stay>...]
#
# The weekly retention of DOC-71 §6.2: of the versions of the package `rms-api` that carry only `sha-<7>` tags, the newest KEEP
# (30) stay, and so does every version that a tag in the arguments names (the tags running in an environment: a rollback needs
# them). A version that has any other tag (`vX.Y.Z`) and a version with no tag are never touched. It is a script and not
# `actions/delete-package-versions`, whose `ignore-versions` matches the digest that names a container version, not its tags,
# so a rule "keep every v* tag" cannot be written with it. Needs `gh` with a token that can delete package versions.
# `KEEP` and `GH_BIN` are for the tests.
set -euo pipefail
owner="${1:?usage: ghcr-cleanup.sh <owner> [--dry-run] [tag...]}"
shift
dry=0
if [ "${1:-}" = --dry-run ]; then
  dry=1
  shift
fi
keep="${KEEP:-30}"
gh="${GH_BIN:-gh}"
protect=$(printf '%s\n' "$@" | jq -R . | jq -s .)

kind=$("$gh" api "/users/$owner" --jq .type)
case "$kind" in
  Organization) scope="orgs/$owner" ;;
  User) scope="users/$owner" ;;
  *) echo "unknown owner type: $kind"; exit 1 ;;
esac
package="$scope/packages/container/rms-api"

versions=$("$gh" api --paginate "/$package/versions?per_page=100" | jq -s 'add // []')
doomed=$(echo "$versions" | jq -r --argjson keep "$keep" --argjson protect "$protect" '
  [ .[]
    | {id, created_at, tags: (.metadata.container.tags // [])}
    | select(.tags | length > 0)
    | select(all(.tags[]; test("^sha-[0-9a-f]{7}$")))
    | select(([.tags[] | select(. as $t | $protect | index($t))] | length) == 0)
  ]
  | sort_by(.created_at) | reverse | .[$keep:] | .[] | "\(.id) \(.tags | join(","))"')

if [ -z "$doomed" ]; then
  echo "nothing to delete"
  exit 0
fi
while read -r id tags; do
  if [ "$dry" = 1 ]; then
    echo "would delete $id ($tags)"
  else
    "$gh" api -X DELETE "/$package/versions/$id" >/dev/null
    echo "deleted $id ($tags)"
  fi
done <<< "$doomed"
