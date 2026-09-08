#!/usr/bin/env bash
# Validate JSON syntax and enforce plugin.json <-> marketplace.json version
# parity. Run from repo root (CI does this on every PR).
set -uo pipefail

mp=".claude-plugin/marketplace.json"
fail=0

for f in "$mp" plugins/*/.claude-plugin/plugin.json; do
  if ! jq empty "$f" 2>/dev/null; then
    echo "::error file=$f::invalid JSON"
    fail=1
  fi
done
[[ $fail -eq 0 ]] || exit 1

for pj in plugins/*/.claude-plugin/plugin.json; do
  dir=$(dirname "$(dirname "$pj")")
  name=$(basename "$dir")
  pv=$(jq -r .version "$pj")
  mv=$(jq -r --arg n "$name" '.plugins[] | select(.name==$n) | .version' "$mp")

  if [[ -z "$mv" ]]; then
    echo "::error file=$mp::plugin '$name' is missing from marketplace.json"
    fail=1
    continue
  fi
  if [[ "$pv" != "$mv" ]]; then
    echo "::error file=$pj::version $pv does not match marketplace.json's $mv for '$name'"
    fail=1
  fi
done

exit $fail
