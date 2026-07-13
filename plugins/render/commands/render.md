---
description: Render a diagram/markup block (mermaid, chart, svg, html) to an offline HTML file and print its file:// URL
argument-hint: "[file] [--kind mermaid|chart|svg|html] [-o|--open]"
model: claude-haiku-4-5
allowed-tools:
  - Bash(bash:*)
---

Render a diagram or markup block using the bundled offline renderer at
`${CLAUDE_PLUGIN_ROOT}/scripts/render.sh`. The renderer wraps the source in a
self-contained HTML page (mermaid.js / chart.js vendored once, no network after
that) and prints a `file://` URL — nothing about the content leaves the machine.

Supported kinds: **mermaid** (default), **chart** (a Chart.js config object),
**svg**, **html**.

Optional arguments: `$ARGUMENTS`

Do this:

1. **Find the source and its kind.**
   - If `$ARGUMENTS` contains a file path, render that file (the script infers the
     kind from the extension: `.mmd`→mermaid, `.svg`→svg, `.html`→html,
     `.json`/`.chart`→chart).
   - Otherwise, take the most recent renderable fenced block from your own previous
     message — a ```` ```mermaid ````, ```` ```chart ````, ```` ```svg ````, or
     ```` ```html ```` block. Pass its fence language as `--kind`. If there is none,
     tell the user there is nothing to render and stop — do not invent content.
   - Honor an explicit `--kind` in `$ARGUMENTS` if the user gave one.

2. **Run the renderer in a single Bash call**, passing the source on stdin via a
   heredoc so the command begins with `bash`. Add `-o` only if the user passed
   `-o`/`--open`. The script strips ``` fences itself, so pass the block as-is:

   ```
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/render.sh" --kind <kind> <<'SRC'
   <the source>
   SRC
   ```

3. **Report the printed `file://` URL** to the user on its own line so they can click
   or copy it. Do **not** open the browser unless the user asked (`-o`) — the default
   is print-only, so it never interrupts their reading.

If the script prints `fetching … once`, that is the expected one-time library
download (mermaid.js or chart.js); every render afterward is fully offline.
