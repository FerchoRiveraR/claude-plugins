# english-coach

Non-blocking English coaching on every prompt, for non-native-English-speaking engineers.

## Overview

A `UserPromptSubmit` hook reads the natural-language part of your message, asks a fast model to flag real English mistakes (articles, prepositions, false friends, verb tense, word-order calques from your native language, typos), and injects a short hint as context for that turn. Code, file paths, commands, and ticket IDs are ignored — only prose is analyzed.

The hint is **hits-only**: a single line of `wrong → fix` pairs. The coach reports the specific fixes, never a full rewrite of your message — so it stays compact no matter how long the prompt is.

**Hard guarantee: it never blocks.** The script forces `exit 0` on every path (skip, error, or success) via an `EXIT` trap. It can only add a hint; it cannot stop your turn or ask for confirmation. This was a deliberate reaction to an earlier prompt-based version that used an LLM `ask` verdict and occasionally refused to proceed — see [Technical Details](#technical-details).

## What it does, per message

1. Skip fast: slash commands and anything under 5 real words pass straight through (no LLM call).
2. Otherwise, call `claude -p --model claude-haiku-4-5-20251001 --tools ""` with the message plus your last ~40 lines of ledger history, forcing a schema-validated JSON reply (`{ok, mistakes[]}`, up to 5 mistakes) — never freeform text.
3. Each flagged mistake is checked against your actual message: if the model's `wrong` fragment isn't a verbatim substring of what you typed, that mistake is dropped. If anything survives and passes a defense-in-depth content check (no code fences, links, or meta-instruction-shaped text), it's appended to your local ledger (`~/.claude/english-coach/log.md`) and injected as `additionalContext`, with a rendering instruction so Claude Code shows it as one compact, muted blockquote line at the top of the reply before answering your actual request normally.

Recurring mistakes in your ledger are prioritized in future analyses — the hints should get more targeted to *your* patterns the more you use it.

## Example

Say you send this prompt (three mistakes typical of a Spanish speaker):

```
Can you explain me how the units are consumed when two authorizations overlaps?
I have a doubt about the exhaustion logic.
```

Claude's reply opens with one muted blockquote line, then answers your actual
question as normal. Every style is a single line of `wrong → fix` hits — no
full corrected sentence, regardless of prompt length. In the default `classic`
style it renders like this:

> 📝 *English* — ~~explain me~~ → **explain to me** · ~~authorizations overlaps~~ → **authorizations overlap** · ~~I have a doubt~~ → **I have a question**

The `minimal` style is the same line with a bold label:

> 📝 **English** — ~~explain me~~ → **explain to me** · ~~authorizations overlaps~~ → **authorizations overlap** · ~~I have a doubt~~ → **I have a question**

The `code-bold-italic` style shows each wrong fragment as inline code:

> 📝 **English** — `explain me` → **explain to me** · `authorizations overlaps` → **authorizations overlap** · `I have a doubt` → **I have a question**

Clean prose gets no blockquote at all — the model returns `{"ok":true}` and
your turn proceeds untouched.

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

  All three are one hits-only line (no corrected sentence); they differ only in how the label and the wrong fragment are marked.

  | Style | Renders as |
  |---|---|
  | `classic` (default) | `> 📝 *English* — ~~wrong~~ → **fix** · ~~wrong~~ → **fix**` |
  | `code-bold-italic` | ``> 📝 **English** — `wrong` → **fix** · `wrong` → **fix**`` |
  | `minimal` | `> 📝 **English** — ~~wrong~~ → **fix** · ~~wrong~~ → **fix**` |

No other configuration. To stop getting hints, disable the plugin (`claude plugin uninstall english-coach@ferchoriverar` or toggle it off in `enabledPlugins`).

## Privacy

The ledger (`~/.claude/english-coach/log.md`) is local to your machine, per-user, and not part of this plugin's package or any git repo — nobody else's install reads or writes it, and it isn't synced anywhere. Delete the file any time to reset your history.

## Technical Details

- Runs as a `command` hook (not a `prompt` hook) specifically so blocking is structurally impossible — command hooks only block on `exit 2`, and this script never exits non-zero. An earlier prompt-based version occasionally emitted prose instead of a clean verdict, which the harness treated as a block; that failure mode doesn't exist here.
- A recursion guard (`ENGLISH_COACH_RUNNING=1` on the inner `claude -p` call) prevents the nested session from re-triggering this same hook.
- Latency/cost stays low via the skip heuristics above, the Haiku model, and `--strict-mcp-config` (no MCP servers loaded for the analysis call). `--max-budget-usd 0.02` caps runaway spend per call.

### Security

The analysis call reads your raw, unvalidated prompt text — including anything a pasted message, quoted email, or copied ticket might contain. An earlier version passed that Haiku call's freeform text straight into `additionalContext`, trusting it implicitly. In testing, a message that merely mentioned "GitHub" and "organization" caused the coach to abandon grammar coaching and fabricate a full unrelated answer (complete with a suggested shell command and its own embedded rendering instructions), which then got injected into the main session as if it were legitimate hint content — a textbook prompt-injection failure mode, not a one-off fluke.

Three independent controls close that hole:

1. **No tool access for the analysis call** (`--tools ""`). Whatever the message asks the coach to do, it cannot actually read, write, or execute anything — confirmed by testing that the model can only *hallucinate* fake tool output in text, never really invoke a tool.
2. **Schema-forced structured output** (`--json-schema`, read from `.structured_output`) instead of freeform prose. The model can only return `{ok, mistakes: [{wrong, fix}]}` — there is no field for a fabricated answer (or a full rewrite) to live in.
3. **Server-side validation before anything is trusted.** Each `mistakes[].wrong` must occur verbatim in your actual message (case-insensitive substring match) or it's dropped; the assembled note is rejected outright if it contains code fences, URLs, or meta-instruction-shaped text (`Assistant:`, `<function_calls>`). Nothing is written to the ledger or injected as context until it survives all of the above.

## Author

Luis Fernando Rivera Ramirez

## Version

0.2.0
