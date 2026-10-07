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
  hooks/register.js                # a mod's hooks module, if the plugin is a mod
  tests/*.test.ts                  # a mod's tests, run by `claude plugin test`
```

## Develop locally

Point Claude Code at your checkout, then install the plugin you're working on:

```sh
claude plugin marketplace add /path/to/claude-plugins
claude plugin install <name>@ferchoriverar
```

Reinstall (or restart the session) to pick up changes.

A directory marketplace loads plugins in place from your checkout, so every
session runs whatever branch the checkout has. Develop in a git worktree and
load the copy you're working on for one session:

```sh
git worktree add ../claude-plugins-dev -b my-change
claude --plugin-dir ../claude-plugins-dev/plugins/<name>
```

`--plugin-dir` replaces the installed copy for that session only, and reloads a
mod's hooks module each time you save. For a mod, also run
`claude plugin validate --strict plugins/<name>` and `claude plugin test plugins/<name>`.

## Add a new plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (`name`, `description`, `version`, `author`).
2. Add its components under `hooks/`, `commands/`, or `scripts/`.
3. Register it in `.claude-plugin/marketplace.json`.
4. Write a `plugins/<name>/README.md`.

## CI/CD

All changes land via pull request — `main` is protected, no direct pushes.

- **CI** (`.github/workflows/ci.yml`, on every PR): validates JSON syntax, checks
  each `plugin.json` version matches its `marketplace.json` entry, runs
  every plugin's `selftest.sh`, and runs `claude plugin validate --strict` and
  `claude plugin test` on english-coach with a pinned Claude Code.
- **Release** (`.github/workflows/release.yml`, on push to `main`): for each
  plugin changed by the merge, bumps `plugin.json` + `marketplace.json`
  together (major/minor/patch from the subjects of Conventional Commits
  touching that plugin's directory — `!` in the subject bumps major, `feat`
  minor, anything else patch; a `BREAKING CHANGE:` footer alone doesn't count),
  or syncs `marketplace.json` if you already bumped `plugin.json` yourself.
  Opens a `chore(release)` PR — merge it to publish. The bot opens that PR with
  `GITHUB_TOKEN`, which starts no CI, so close and reopen it to run the
  required check.
- PRs land with **Rebase and merge** (the only method enabled), so every commit
  subject reaches `main` and drives the bump.

## Style

- Keep it small and dependency-light — prefer shell + stdlib, or a plain-JS mod
  with no `package.json` or build step, over a new runtime.
- Hooks must **fail open**: never block a turn on error. In a mod, never await
  slow work before `next(e)`: schedule it (`$.clock.after`) and pass the event on.
- Nothing should leave the machine unless the plugin's whole point is a network call, and the README says so.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`).

## Report a bug

Open an [issue](https://github.com/ferchoriverar/claude-plugins/issues) with repro
steps. For security issues see [SECURITY.md](SECURITY.md) instead.
