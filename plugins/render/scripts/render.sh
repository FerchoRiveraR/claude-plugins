#!/usr/bin/env bash
# render.sh — render a diagram/markup block to a self-contained, OFFLINE HTML file and print its file:// URL.
#
# Kinds: mermaid (default), chart (Chart.js), svg, html.
# The browser does the rendering, so there is no headless Chromium / mmdc. Libraries (mermaid.js,
# chart.js) are vendored ONCE (public libs, no PHI); every render afterward touches no network, so
# your content never leaves the machine — safe for a HIPAA org, unlike pasting into a public editor.
#
# Cross-platform: Linux, macOS, WSL, and Windows (Git Bash).
#
# Usage:
#   render.sh diagram.mmd                  # kind inferred from extension; print file:// URL (does NOT open)
#   render.sh --kind chart config.json     # force a kind
#   render.sh < diagram.mmd                # read from stdin
#   render.sh -o diagram.svg               # also open it in the default browser
#   pbpaste | render.sh --kind html        # macOS: render the clipboard as HTML
#
# ```-fenced blocks are stripped, so you can paste a whole fenced block from a Claude answer.
set -euo pipefail

open=0
kind=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--open)  open=1; shift ;;
    -k|--kind)  kind="${2:-}"; shift 2 ;;
    --kind=*)   kind="${1#*=}"; shift ;;
    *) break ;;
  esac
done

# --- cross-platform helpers ---
open_url() {  # returns non-zero if no opener is found
  if   command -v xdg-open       >/dev/null 2>&1; then xdg-open "$1"
  elif command -v open           >/dev/null 2>&1; then open "$1"                        # macOS
  elif command -v wslview        >/dev/null 2>&1; then wslview "$1"                     # WSL
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile start "$1"  # Git Bash / Windows
  else return 1; fi
}
fetch() {  # $1 url  $2 dest
  if   command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -qO "$2" "$1"
  else echo "render.sh: need curl or wget to fetch a library the first time" >&2; return 1; fi
}

# --- 1. read the source (file arg, or stdin); infer kind from extension when not forced ---
if [[ $# -ge 1 ]]; then
  src="$(cat -- "$1")"
  if [[ -z "$kind" ]]; then case "$1" in
    *.mmd|*.mermaid) kind=mermaid ;;
    *.svg)           kind=svg ;;
    *.html|*.htm)    kind=html ;;
    *.json|*.chart)  kind=chart ;;
  esac; fi
elif [[ ! -t 0 ]]; then
  src="$(cat)"
else
  echo "usage: render.sh [-o] [--kind mermaid|chart|svg|html] <file>   (or pipe on stdin)" >&2
  exit 2
fi
kind="${kind:-mermaid}"  # backward-compatible default
[[ -n "${src//[[:space:]]/}" ]] || { echo "render.sh: empty input" >&2; exit 1; }

# strip ```-fences (```mermaid / ```html / ... and the closing ```), keep the content between them
src="$(printf '%s' "$src" | sed '/^```/d')"

# --- 2. vendor a library once (only kinds that need one); symlink it beside the page ---
lib_dir="${XDG_DATA_HOME:-$HOME/.local/share}/mermaid-render"
dir="$(mktemp -d "${TMPDIR:-/tmp}/render.XXXXXX")"
out="$dir/index.html"
place_lib() {  # $1 filename  $2 url
  local f="$lib_dir/$1"
  if [[ ! -s "$f" ]]; then
    mkdir -p "$lib_dir"
    echo "render.sh: fetching $1 once -> $f" >&2
    fetch "$2" "$f"
  fi
  ln -sf "$f" "$dir/$1" 2>/dev/null || cp "$f" "$dir/$1"  # symlink; copy where symlinks are unavailable (Windows)
}

# --- 3. build the self-contained page for the requested kind ---
case "$kind" in
  mermaid)
    # ponytail: pinned to major 10 (has a global <script> build); pin an exact version for reproducible renders
    place_lib mermaid.min.js "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"
    {
      cat <<'HTML'
<!doctype html><meta charset="utf-8"><title>mermaid</title>
<style>body{margin:2rem;font:14px system-ui;background:#fff;color:#111}.mermaid{max-width:100%}</style>
<pre class="mermaid">
HTML
      # HTML-encode < > & so mermaid sees the true source via textContent
      printf '%s' "$src" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
      cat <<'HTML'
</pre>
<script src="mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true});</script>
HTML
    } > "$out"
    ;;

  chart)
    # Input is a Chart.js config object: { "type": ..., "data": ..., "options": ... }
    # ponytail: pinned to major 4 (UMD global build); a `</script>` inside the config would break inlining
    place_lib chart.umd.min.js "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"
    {
      cat <<'HTML'
<!doctype html><meta charset="utf-8"><title>chart</title>
<style>body{margin:2rem;font:14px system-ui;background:#fff;color:#111}#wrap{max-width:900px;margin:auto}</style>
<div id="wrap"><canvas id="c"></canvas></div>
<script src="chart.umd.min.js"></script>
<script>new Chart(document.getElementById('c'),
HTML
      printf '%s' "$src"   # the config, inlined as a JS object literal (JSON is valid JS)
      cat <<'HTML'
);</script>
HTML
    } > "$out"
    ;;

  svg)
    # Browsers render SVG natively; just wrap the markup in a minimal page for a consistent file://
    {
      cat <<'HTML'
<!doctype html><meta charset="utf-8"><title>svg</title>
<style>body{margin:2rem;background:#fff}svg{max-width:100%;height:auto}</style>
HTML
      printf '%s\n' "$src"
    } > "$out"
    ;;

  html)
    # The source IS the page — write it verbatim.
    printf '%s\n' "$src" > "$out"
    ;;

  *)
    echo "render.sh: unknown kind '$kind' (use mermaid|chart|svg|html)" >&2
    exit 2
    ;;
esac

echo "file://$out"
if [[ "$open" == 1 ]]; then
  open_url "$out" >/dev/null 2>&1 || echo "render.sh: no browser opener found; open the URL above manually" >&2
fi
