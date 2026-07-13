#!/usr/bin/env bash
# selftest.sh — smoke-test render.sh across all kinds. Fails loudly if the case
# logic, kind inference, or a template breaks. Run: bash scripts/selftest.sh
# (mermaid/chart fetch their lib once on a fresh machine; svg/html are fully offline.)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
render="$here/render.sh"
fails=0

check() {  # $1 label  $2 marker that must appear in the generated index.html  $3.. render.sh args (source on stdin)
  local label="$1" marker="$2"; shift 2
  local url dir
  url="$(bash "$render" "$@")" || { echo "FAIL $label: render.sh exited nonzero"; fails=$((fails+1)); return; }
  dir="${url#file://}"
  if [[ -s "$dir" ]] && grep -qF "$marker" "$dir"; then
    echo "ok   $label -> $url"
  else
    echo "FAIL $label: marker '$marker' not found in $dir"; fails=$((fails+1))
  fi
}

check mermaid 'class="mermaid"' --kind mermaid <<<'graph TD; A-->B'
check chart   'new Chart('       --kind chart   <<<'{"type":"bar","data":{"labels":["A"],"datasets":[{"data":[1]}]}}'
check svg     '<svg'             --kind svg     <<<'<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>'
check html    '<h1>hi</h1>'      --kind html    <<<'<h1>hi</h1>'
check default 'class="mermaid"'  <<<'graph LR; X-->Y'   # no --kind => mermaid

# fence stripping + bad-kind rejection
check fenced 'class="mermaid"' --kind mermaid <<<'```mermaid
graph TD; A-->B
```'
if bash "$render" --kind png <<<'x' 2>/dev/null; then
  echo "FAIL bad-kind: png should exit nonzero"; fails=$((fails+1))
else
  echo "ok   bad-kind rejected"
fi

[[ $fails -eq 0 ]] && echo "PASS" || { echo "$fails FAILED"; exit 1; }
