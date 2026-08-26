# claude-plugins

Personal [Claude Code](https://claude.ai/code) plugin marketplace — small,
org-neutral developer-experience tools.

Marketplace name: **`ferchoriverar`**. Install strings look like
`render@ferchoriverar`.

## Installation

Add the marketplace once, then install the plugins you want:

```sh
claude plugin marketplace add ferchoriverar/claude-plugins
claude plugin install english-coach@ferchoriverar
claude plugin install render@ferchoriverar
```

## Plugins

| Plugin | What it does |
|---|---|
| [`english-coach`](plugins/english-coach) | Non-blocking English coaching on every prompt — flags natural-language mistakes and posts a short, muted hint as soon as it's ready, even mid-idle. Never blocks or slows a turn. |
| [`render`](plugins/render) | `/render` turns a Mermaid block into a self-contained, fully-offline HTML file and prints a `file://` URL. Nothing leaves the machine. |

## Contributing

Bug reports, fixes, and small new plugins are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). For security issues, follow
[SECURITY.md](SECURITY.md) rather than opening a public issue.

## License

[MIT](LICENSE) © 2026 Luis Fernando Rivera Ramirez

## Author

Luis Fernando Rivera Ramirez · [@ferchoriverar](https://github.com/ferchoriverar)
