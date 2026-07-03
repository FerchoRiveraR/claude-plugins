# render

On-demand **Mermaid → offline HTML** rendering for Claude Code. When an answer
contains a mermaid diagram, run `/render` to turn it into a self-contained HTML
page and get a `file://` URL you open in your browser — instead of copying the
text into a third-party live editor.

## Why it exists

- **No third-party site.** Diagrams often encode detail you'd rather not paste
  into a public web renderer, which sends that data off-machine. `render` keeps
  everything local — a good fit whenever the data must not leave the machine.
- **The browser does the rendering.** It ships no headless Chromium / `mmdc`; the
  page loads `mermaid.js`, which is vendored **once** (a public library).
  Every render after that touches no network.
- **Cheap.** The HTML boilerplate lives in the bundled script, not in Claude's
  output — the model only ever handles the diagram text it already wrote.

## Installation

```sh
claude plugin install render@ferchoriverar
```

(Requires the `ferchoriverar` marketplace — see the [repository README](../../README.md#installation).)

## Usage

```
/render                 # render the most recent mermaid block from the last answer
/render path/to.mmd     # render a file
/render -o              # also open it in your default browser
```

`/render` prints a `file://` URL and, by default, **does not open the browser** —
you decide when to look, so it never interrupts your reading. Pass `-o` to open.

### Direct script use

The renderer also works as a plain CLI (Linux, macOS, WSL, Windows/Git Bash):

```
scripts/render.sh diagram.mmd            # print the file:// URL
scripts/render.sh -o diagram.mmd         # print and open
pbpaste            | scripts/render.sh   # macOS: render the clipboard
xclip -sel clip -o | scripts/render.sh   # Linux/X11
wl-paste           | scripts/render.sh   # Linux/Wayland
```

```` ```mermaid ```` fences are stripped automatically, so you can pipe a whole
fenced block copied from an answer.

## How it works

1. Read the diagram source (file, stdin, or the last mermaid block).
2. Vendor `mermaid.js` once to `~/.local/share/mermaid-render/` (skipped on reruns).
3. Write a self-contained `index.html` to a temp dir with the library beside it.
4. Print `file://…/index.html`.

## Roadmap (deferred — not built yet)

- **Local HTTP server** for clickable `http://localhost` URLs — added only if
  `file://` links are not clickable in your terminal.
- **Broader kinds** (`svg`, `html`, `png`, charts) behind the same command.
- **MCP wrapper** so rendering can be invoked hands-free.

## Compatibility

Designed for Claude Code. Pure shell + a browser; no MCP server, no additional
runtime. Requires `curl` or `wget` for the one-time `mermaid.js` fetch.
