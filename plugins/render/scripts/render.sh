#!/usr/bin/env bash
# render.sh — render a Mermaid diagram to a self-contained, OFFLINE HTML file and print its file:// URL.
#
# The browser renders it (mermaid.js), so there is no headless Chromium / mmdc.
# mermaid.js is vendored ONCE (a public library, no PHI); every render afterward touches no
# network, so your diagram never leaves the machine — safe for a HIPAA org, unlike pasting a
# diagram into a public live editor.
#
# Cross-platform: Linux, macOS, WSL, and Windows (Git Bash).
#
# Usage:
#   render.sh diagram.mmd              # render a file, print the file:// URL (does NOT open)
#   render.sh < diagram.mmd            # read from stdin
#   pbpaste | render.sh                # macOS: render the clipboard
#   xclip -sel clip -o | render.sh     # Linux/X11: render the clipboard
#   wl-paste | render.sh               # Linux/Wayland: render the clipboard
#   render.sh -o diagram.mmd           # also open it in the default browser
#
# ```mermaid fences are stripped, so you can paste a whole fenced block from a Claude answer.
set -euo pipefail

open=0
[[ "${1:-}" == "-o" || "${1:-}" == "--open" ]] && { open=1; shift; }

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
  else echo "render.sh: need curl or wget to fetch mermaid.js the first time" >&2; return 1; fi
}

# --- 1. read the diagram source (file arg, or stdin) ---
if [[ $# -ge 1 ]]; then
  src="$(cat -- "$1")"
elif [[ ! -t 0 ]]; then
  src="$(cat)"
else
  echo "usage: render.sh [-o] <diagram.mmd>   (or pipe mermaid on stdin)" >&2
  exit 2
fi
[[ -n "${src//[[:space:]]/}" ]] || { echo "render.sh: empty input" >&2; exit 1; }

# --- 2. vendor mermaid.js once; reuse forever, fully offline afterward ---
lib_dir="${XDG_DATA_HOME:-$HOME/.local/share}/mermaid-render"
lib="$lib_dir/mermaid.min.js"
if [[ ! -s "$lib" ]]; then
  mkdir -p "$lib_dir"
  echo "render.sh: fetching mermaid.js once -> $lib" >&2
  # ponytail: pinned to major 10 (has a global <script> build); pin an exact version in the URL for reproducible renders
  fetch "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" "$lib"
fi

# --- 3. self-contained page: lib beside it, loaded relatively (reliable file:// load, no </script> escaping) ---
dir="$(mktemp -d "${TMPDIR:-/tmp}/mermaid.XXXXXX")"
ln -sf "$lib" "$dir/mermaid.min.js" 2>/dev/null || cp "$lib" "$dir/mermaid.min.js"  # symlink; copy where symlinks are unavailable (Windows)
out="$dir/index.html"

{
  cat <<'HTML'
<!doctype html><meta charset="utf-8"><title>mermaid</title>
<style>body{margin:2rem;font:14px system-ui;background:#fff;color:#111}.mermaid{max-width:100%}</style>
<pre class="mermaid">
HTML
  # strip ```mermaid fences, then HTML-encode < > & so mermaid sees the true source via textContent
  printf '%s' "$src" | sed '/^```/d; s/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
  cat <<'HTML'
</pre>
<script src="mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true});</script>
HTML
} > "$out"

echo "file://$out"
if [[ "$open" == 1 ]]; then
  open_url "$out" >/dev/null 2>&1 || echo "render.sh: no browser opener found; open the URL above manually" >&2
fi
