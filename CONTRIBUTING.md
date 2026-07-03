# Contributing

Thanks for your interest. This is a small, personal Claude Code plugin
marketplace. Bug reports, fixes, and new **small, org-neutral** DX plugins are
welcome. By contributing you agree your work is licensed under the repo's
[MIT license](LICENSE).

## Repo layout

```
.claude-plugin/marketplace.json    # marketplace manifest — lists every plugin
plugins/<name>/
  .claude-plugin/plugin.json       # plugin manifest
  README.md                        # per-plugin docs
  hooks/ | commands/ | scripts/    # the plugin's components
```

## Develop locally

Point Claude Code at your checkout, then install the plugin you're working on:

```sh
claude plugin marketplace add /path/to/claude-plugins
claude plugin install <name>@ferchoriverar
```

Reinstall (or restart the session) to pick up changes.

## Add a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (`name`, `description`, `version`, `author`).
2. Add its components under `hooks/`, `commands/`, or `scripts/`.
3. Register it in `.claude-plugin/marketplace.json`.
4. Write a `plugins/<name>/README.md`.

## Style

- Keep it small and dependency-light — prefer shell + stdlib over a new runtime.
- Hooks must **fail open**: never block a turn on error (see `english-coach`'s `exit 0` trap for the pattern).
- Nothing should leave the machine unless the plugin's whole point is a network call, and the README says so.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`).

## Report a bug

Open an [issue](https://github.com/ferchoriverar/claude-plugins/issues) with repro
steps. For security issues see [SECURITY.md](SECURITY.md) instead.
