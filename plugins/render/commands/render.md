---
description: Render a Mermaid diagram to an offline HTML file and print its file:// URL (does not auto-open)
argument-hint: "[file.mmd] [-o|--open]"
allowed-tools:
  - Bash(bash:*)
---

Render a Mermaid diagram using the bundled offline renderer at
`${CLAUDE_PLUGIN_ROOT}/scripts/render.sh`. The renderer wraps the diagram in a
self-contained HTML page (vendored mermaid.js, no network after the one-time
library fetch) and prints a `file://` URL — nothing about the diagram leaves the
machine.

Optional arguments: `$ARGUMENTS`

Do this:

1. **Find the Mermaid source.**
   - If `$ARGUMENTS` contains a file path, render that file.
   - Otherwise, take the most recent ```mermaid fenced block from your own previous
     message in this conversation. If there is none, tell the user there is nothing
     to render and stop — do not invent a diagram.

2. **Run the renderer in a single Bash call**, passing the source on stdin via a
   heredoc so the command begins with `bash`. Add `-o` only if the user passed
   `-o`/`--open`. The script strips ```mermaid fences itself, so pass the block as-is:

   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/render.sh" <<'MERMAID'
   <the mermaid source>
   MERMAID
   ```

3. **Report the printed `file://` URL** to the user on its own line so they can click
   or copy it. Do **not** open the browser unless the user asked (`-o`) — the default
   is print-only, so it never interrupts their reading.

If the script prints `fetching mermaid.js once`, that is the expected one-time
library download; every render afterward is fully offline.
