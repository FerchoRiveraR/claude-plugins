# english-coach

Non-blocking English coaching on every prompt, for non-native-English-speaking engineers.

## Overview

A `UserPromptSubmit` hook reads the natural-language part of your message, asks a fast model to flag real English mistakes (articles, prepositions, false friends, verb tense, word-order calques from your native language, typos), and injects a short hint as context for that turn. Code, file paths, commands, and ticket IDs are ignored — only prose is analyzed.

**Hard guarantee: it never blocks.** The script forces `exit 0` on every path (skip, error, or success) via an `EXIT` trap. It can only add a hint; it cannot stop your turn or ask for confirmation. This was a deliberate reaction to an earlier prompt-based version that used an LLM `ask` verdict and occasionally refused to proceed — see [Technical Details](#technical-details).

## What it does, per message

1. Skip fast: slash commands and anything under 5 real words pass straight through (no LLM call).
2. Otherwise, call `claude -p --model claude-haiku-4-5-20251001` with the message plus your last ~40 lines of ledger history, asking for up to 5 short corrections or a clean `OK`.
3. If there's a note, append it to your local ledger (`~/.claude/english-coach/log.md`) and inject it as `additionalContext`, with a rendering instruction so Claude Code shows it as one compact, muted blockquote at the top of the reply before answering your actual request normally.

Recurring mistakes in your ledger are prioritized in future analyses — the hints should get more targeted to *your* patterns the more you use it.

## Example

Say you send this prompt (three mistakes typical of a Spanish speaker):

```
Can you explain me how the units are consumed when two authorizations overlaps?
I have a doubt about the exhaustion logic.
```

Claude's reply opens with one muted blockquote, then answers your actual
question as normal. In the default `classic` style it renders like this:

> 📝 *English* — ~~explain me~~ → **explain to me** · ~~authorizations overlaps~~ → **authorizations overlap** · ~~I have a doubt~~ → **I have a question**
>
> *Can you explain to me how the units are consumed when two authorizations overlap? I have a question about the exhaustion logic.*

The `minimal` style drops the corrected sentence:

> 📝 **English** — ~~explain me~~ → **explain to me** · ~~authorizations overlaps~~ → **authorizations overlap** · ~~I have a doubt~~ → **I have a question**

The `code-bold-italic` style shows each wrong fragment as inline code:

> 📝 **English** — `explain me` → **explain to me** · `authorizations overlaps` → **authorizations overlap** · `I have a doubt` → **I have a question**
>
> *Can you explain to me how the units are consumed when two authorizations overlap? I have a question about the exhaustion logic.*

Clean prose gets no blockquote at all — the model returns `OK` and your turn
proceeds untouched.

## Installation

```sh
claude plugin install english-coach@ferchoriverar
```

(Requires the `ferchoriverar` marketplace — see the [repository README](../../README.md#installation).)

## Requirements

- The `claude` CLI on `PATH` (the hook shells out to it for the Haiku analysis) and `jq`. Either missing → the hook silently no-ops.
- Your own Claude Code usage/auth — the `claude -p` call runs under your session, so it counts against your own usage, not a shared budget.

## Configuration

Set these once (shell profile, or the `env` block in your `~/.claude/settings.json`) — they're personal preferences that should apply the same across every project, so they're plain env vars rather than a per-project `.claude/*.local.md` settings file.

- `ENGLISH_COACH_NATIVE_LANG` — your native language, used to prioritize word-order-calque mistakes (e.g. `Portuguese`, `French`). Defaults to `Spanish`.
- `ENGLISH_COACH_STYLE` — how the hint renders. Defaults to `classic`.

  | Style | Renders as |
  |---|---|
  | `classic` (default) | `> 📝 *English* — ~~wrong~~ → **fix** · ~~wrong~~ → **fix**`<br>`> *full corrected sentence, italic* ` |
  | `code-bold-italic` | ``> 📝 **English** — `wrong` → **fix** · `wrong` → **fix**``<br>`> *full corrected sentence, italic*` |
  | `minimal` | `> 📝 **English** — ~~wrong~~ → **fix** · ~~wrong~~ → **fix**` (no second line) |

No other configuration. To stop getting hints, disable the plugin (`claude plugin uninstall english-coach@ferchoriverar` or toggle it off in `enabledPlugins`).

## Privacy

The ledger (`~/.claude/english-coach/log.md`) is local to your machine, per-user, and not part of this plugin's package or any git repo — nobody else's install reads or writes it, and it isn't synced anywhere. Delete the file any time to reset your history.

## Technical Details

- Runs as a `command` hook (not a `prompt` hook) specifically so blocking is structurally impossible — command hooks only block on `exit 2`, and this script never exits non-zero. An earlier prompt-based version occasionally emitted prose instead of a clean verdict, which the harness treated as a block; that failure mode doesn't exist here.
- A recursion guard (`ENGLISH_COACH_RUNNING=1` on the inner `claude -p` call) prevents the nested session from re-triggering this same hook.
- Latency/cost stays low via the skip heuristics above, the Haiku model, and `--strict-mcp-config` (no MCP servers loaded for the analysis call).

## Author

Luis Fernando Rivera Ramirez

## Version

0.1.0
