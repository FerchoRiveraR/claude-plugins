# statusline

A status band above the prompt, built as a Claude Code mod (no shell script, no `statusLine` setting).

```
Sonnet 5 5 | high | default  ········  resets 2h 14m | 37% used | $1.42 | ctx 21% | 48m
Credits 2% | Left $48.91 | Used $1.09  ········  you@example.com
```

Line 1, left: model, effort and output style in bold (branch and changes live on the Git tab). On line 2 the email is dimmed; everything else is regular. A flexible gap pushes the right side to the edge: reset timer and usage of the 5-hour window, session cost, context window %, session time.

## Tabs

The band has a tab picker on its first row, `Tab: Status` / `Git`; only the selected tab's lines are drawn below. Status is the two lines above. Git has two lines, each showing only what applies. Line 1: branch, `+added/-removed` lines against HEAD, `dirty` (both left out when the tree has no changes), `↑ahead ↓behind` of the local branch against its own remote branch (only the sides that differ), a flexible gap, then the repo (owner/name from the origin remote, an underlined link to its page). Line 2: the branch's pull request (`PR #12`, with `#12` an underlined link, or `Draft PR #12` for a draft; only the branch's open PR, never a merged or closed one; needs the `gh` CLI, refreshed every minute), its merge status (left out for a draft; `✓ ready to merge`, `! bypass` when it is blocked but you may merge as an admin, `✗ unable to merge`), its checks (`✓ checks`, `… n running`, `✗ n failing`), the review state (`✓ approved`, `✗ changes requested`, `… review required`) and the assignees, or the author when there are none, each left out when there is nothing to show, a flexible gap, then when the last fetch ran (from `.git/FETCH_HEAD`; `never fetched` if it has not). Branch, changes, dirty, arrows and the PR are bold, the fetch time is dimmed, the rest is regular. Outside a repository it says `not a git repository`.

Switch tabs with the picker: focus the band with ctrl+x tab or a click, press Enter to open it, choose with the arrow keys.

Line 2 of the Status tab: usage credits (spent, monthly limit, balance), a flexible gap, then the account email.

## Install

```
/plugin install statusline --marketplace ferchoriverar/claude-plugins
```

## Notes

- Refreshes every 30 seconds and after each model step and turn.
- Model and effort appear after the first request of the session; until then the model comes from settings.
- The email is read once at session start from `claude auth status`, so it follows the account you are signed in to. There is nothing to configure.
- Extra usage comes from Anthropic's `/api/oauth/usage` endpoint, refreshed every 5 minutes; it shows `—` when your plan has no extra usage or the request fails.
- Reset timer and usage need a subscription; they are left out otherwise.
