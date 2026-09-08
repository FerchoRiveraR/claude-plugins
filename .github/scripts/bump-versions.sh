#!/usr/bin/env bash
# Sync plugin.json <-> marketplace.json versions for every plugin touched
# between $1 and $2 (git refs). If plugin.json was already bumped by hand,
# marketplace.json is synced to match. Otherwise the version is auto-bumped
# from Conventional Commit messages touching that plugin's directory
# (BREAKING CHANGE/! -> major, feat -> minor, else -> patch).
# Emits any=1 to $GITHUB_OUTPUT if anything changed.
set -euo pipefail

before="$1"
after="$2"
mp=".claude-plugin/marketplace.json"

# First push to a new branch, or a force-push: no usable diff base.
if ! git cat-file -e "$before" 2>/dev/null; then
  before="$after~1"
fi

changed_files=$(git diff --name-only "$before" "$after")
any=0

for pj in plugins/*/.claude-plugin/plugin.json; do
  dir=$(dirname "$(dirname "$pj")")
  name=$(basename "$dir")

  grep -q "^$dir/" <<<"$changed_files" || continue

  pv=$(jq -r .version "$pj")
  mv=$(jq -r --arg n "$name" '.plugins[] | select(.name==$n) | .version' "$mp")

  if [[ "$pv" != "$mv" ]]; then
    new="$pv" # manual bump already in plugin.json, just sync marketplace
  else
    # Only commits scoped to this plugin (or unscoped) drive the bump type —
    # a commit that happens to touch this dir under an unrelated scope
    # (e.g. a repo-wide "feat(ci):" commit) must not escalate it.
    bump=patch
    while IFS= read -r msg; do
      [[ "$msg" =~ ^[a-zA-Z]+(\($name\))?!: ]] && bump=major
      [[ "$msg" == *"BREAKING CHANGE"* ]] && bump=major
      [[ "$bump" != major && "$msg" =~ ^feat(\($name\))?: ]] && bump=minor
    done < <(git log --format=%s "$before".."$after" -- "$dir")

    IFS=. read -r maj min pat <<<"$pv"
    case "$bump" in
      major) new="$((maj + 1)).0.0" ;;
      minor) new="$maj.$((min + 1)).0" ;;
      patch) new="$maj.$min.$((pat + 1))" ;;
    esac
    jq --arg v "$new" '.version = $v' "$pj" >"$pj.tmp" && mv "$pj.tmp" "$pj"
  fi

  jq --arg n "$name" --arg v "$new" \
    '(.plugins[] | select(.name == $n) | .version) = $v' "$mp" >"$mp.tmp" && mv "$mp.tmp" "$mp"

  echo "$name: $pv -> $new"
  any=1
done

echo "any=$any" >>"$GITHUB_OUTPUT"
