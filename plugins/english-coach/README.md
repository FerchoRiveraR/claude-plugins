# english-coach

Non-blocking English coaching on every prompt, for non-native-English-speaking engineers.

## Overview

A `UserPromptSubmit` hook reads the natural-language part of your message, asks a fast model to flag real English mistakes (articles, prepositions, false friends, verb tense, word-order calques from your native language, typos), and posts a short hint as its own reply. Code, file paths, commands, and ticket IDs are ignored — only prose is analyzed.

The hook is registered with `"asyncRewake": true` (`hooks.json`): Claude Code runs the whole script in the background, and if it exits with code `2`, wakes Claude to post the hint immediately — even if you're idle and haven't sent another message yet. If it exits `0`, nothing happens: no wake, no message, no trace.

The hint is **hits-only**: a single line of `wrong → fix` pairs. The coach reports the specific fixes, never a full rewrite of your message — so it stays compact no matter how long the prompt is.

**Hard guarantee: it never blocks a turn.** The hook runs in the background from the moment it fires (`asyncRewake` implies `async`), so your turn is never held up by it. It can only later *wake* Claude to post a hint; it cannot stop your turn or ask for confirmation. See [Technical Details](#technical-details) for why earlier designs couldn't deliver this at all.

## What it does, per message

1. Skip fast: subagent turns, harness-injected turns (system reminders, background notifications), slash commands, and anything under 5 real words exit immediately — no model call.
2. Otherwise, call `claude -p --model claude-haiku-4-5-20251001 --tools ""` with the message plus your last ~40 lines of ledger history, forcing a schema-validated JSON reply (`{ok, mistakes[]}`, up to 5 mistakes) — never freeform text.
3. Each flagged mistake is checked against your actual message: if the model's `wrong` fragment isn't a verbatim substring of what you typed, that mistake is dropped. Whatever survives is appended to your local ledger (`~/.claude/english-coach/log.md`).
4. If anything survives (and it passes a defense-in-depth content check — no code fences, links, or meta-instruction-shaped text), it's printed to stderr with instructions to reproduce it verbatim, and the hook exits `2` — waking Claude to post it as a short standalone reply. Otherwise the hook exits `0` and nothing happens.

Recurring mistakes in your ledger are prioritized in future analyses — the hints should get more targeted to *your* patterns the more you use it.

## Example

Say you send this prompt (three mistakes typical of a Spanish speaker):

```
Can you explain me how the units are consumed when two authorizations overlaps?
I have a doubt about the exhaustion logic.
```

Your question gets answered immediately, no wait. A few seconds later — once
the analysis finishes, whether or not you've sent anything else — a short new
reply appears on its own:

> 📝 *English* — ~~explain me~~ → **explain to me** · ~~authorizations overlaps~~ → **authorizations overlap** · ~~I have a doubt~~ → **I have a question**

Clean prose produces nothing at all — the model returns `{"ok":true}`, the
hook exits `0`, and no extra reply ever appears.

## Installation

```sh
claude plugin install english-coach@ferchoriverar
```

(Requires the `ferchoriverar` marketplace — see the [repository README](../../README.md#installation).)

## Requirements

- `bash hooks/selftest.sh` is the plugin's one runnable check — it stubs `claude` and asserts the contract (exit `2` + stderr hint on a real mistake, silent exit `0` otherwise, verbatim gate, injection rejection).
- The `claude` CLI on `PATH` (the hook shells out to it for the Haiku analysis) and `jq`. Either missing → the hook silently no-ops.
- Claude Code with support for the `asyncRewake` hook field (this plugin was built and tested against 2.1.246+; check `claude --version` if hints never appear).
- Your own Claude Code usage/auth — the `claude -p` call runs under your session, so it counts against your own usage, not a shared budget. Capped at `--max-budget-usd 0.10` per call; a real call typically costs $0.02–0.04.

## Configuration

- `ENGLISH_COACH_NATIVE_LANG` — your native language, used to prioritize word-order-calque mistakes (e.g. `Portuguese`, `French`). Defaults to `Spanish`.

Set it in your shell profile or the `env` block in `~/.claude/settings.json` — it's a personal preference that should apply the same across every project, so it's a plain env var rather than a per-project `.claude/*.local.md` settings file.

No other configuration. To stop getting hints, disable the plugin (`claude plugin uninstall english-coach@ferchoriverar` or toggle it off in `enabledPlugins`).

## Privacy

The ledger (`log.md`) under `~/.claude/english-coach/` (or `$CLAUDE_CONFIG_DIR/english-coach/` if set) is local to your machine, per-user, and not part of this plugin's package or any git repo — nobody else's install reads or writes it, and it isn't synced anywhere. Delete it any time to reset your history.

## Technical Details

### Why `asyncRewake`, and not the two earlier designs

This plugin went through two designs that couldn't actually deliver a hint before landing on this one:

1. **Plain `async: true` + `systemMessage`.** Per the [hooks docs](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background): *"An async hook's `systemMessage` and `additionalContext` fields are discarded. Async hooks can't influence the current turn's model input or the user-facing transcript."* The analysis ran and the ledger filled up, but the hint was silently thrown away, every time. Worse, a turn shorter than the ~11s analysis cancelled the hook's process outright, so some messages produced nothing at all.
2. **A synchronous hook that drained a hint queue into `additionalContext` on your *next* prompt, spawning the actual analysis as a self-detached (`setsid`) background worker.** This worked — the hint was real and did display — but only once you happened to send another message, and if you replied faster than the ~5–11s analysis, the hook could check the queue before the previous worker had written to it, pushing the hint out to the message after that. Nothing was ever lost, but delivery timing was unpredictable.

`asyncRewake: true` (implies `async`) is a hooks field built for exactly this: from the docs' Limitations section — *"Hook output is delivered on the next conversation turn. If the session is idle, the response waits until the next user interaction. **Exception: an `asyncRewake` hook that exits with code 2 wakes Claude immediately even when the session is idle.**"* Exit `2` is what triggers the wake; the hook's stderr becomes the system reminder Claude wakes up to. That's the only documented way for a background hook to cause a *new, unprompted* assistant turn — no queue, no polling for the next prompt, no subagent/`Agent`-tool machinery (a plugin hook is a plain shell script; it has no access to spawn agents even if that were the right tool for this, which it isn't — `asyncRewake` is the lighter, native mechanism).

### Other notes

- Runs as a `command` hook (not a `prompt` hook) specifically so blocking is structurally impossible — and being backgrounded from the start (`asyncRewake` implies `async`) means the initiating turn is never blocked regardless of what the hook eventually does. An earlier prompt-based version occasionally emitted prose instead of a clean verdict, which the harness treated as a block; that failure mode doesn't exist here. It's also a hard requirement, not just a preference: per the hooks docs, `async`/`asyncRewake` are only supported on `command` handlers, and a `prompt` hook's response schema (`{ok, reason, impossible}`) has no field to carry a hint's content anyway — it can only gate, not generate.
- A recursion guard (`ENGLISH_COACH_RUNNING=1` on the inner `claude -p` call) prevents the nested session from re-triggering this same hook.
- Latency/cost stays low via the skip heuristics above, the Haiku model, and `--strict-mcp-config` (no MCP servers loaded for the analysis call).

### Security

The analysis call reads your raw, unvalidated prompt text — including anything a pasted message, quoted email, or copied ticket might contain. An earlier version passed that Haiku call's freeform text straight into the model's context, trusting it implicitly. In testing, a message that merely mentioned "GitHub" and "organization" caused the coach to abandon grammar coaching and fabricate a full unrelated answer (complete with a suggested shell command and its own embedded rendering instructions), which then got injected into the main session as if it were legitimate hint content — a textbook prompt-injection failure mode, not a one-off fluke.

Four independent controls close that hole:

1. **No tool access for the analysis call** (`--tools ""`). Whatever the message asks the coach to do, it cannot actually read, write, or execute anything — confirmed by testing that the model can only *hallucinate* fake tool output in text, never really invoke a tool.
2. **Schema-forced structured output** (`--json-schema`, read from `.structured_output`) instead of freeform prose. The model can only return `{ok, mistakes: [{wrong, fix}]}` — there is no field for a fabricated answer (or a full rewrite) to live in.
3. **Server-side validation before anything is trusted.** Each `mistakes[].wrong` must occur verbatim in your actual message (case-insensitive substring match) or it's dropped; the assembled note is rejected outright if it contains code fences, URLs, or meta-instruction-shaped text (`Assistant:`, `<function_calls>`). Nothing is written to the ledger, and the hook exits `0` (no wake), until a hint survives all of the above.
4. **The stderr payload explicitly marks the hint as display text**, telling Claude to reproduce it verbatim and never treat it as an instruction.

The hook also only ever analyzes text the human actually typed: it skips subagent turns (`agent_id` present in the hook input) and turns carrying harness markers (`<system-reminder>`, `<task-notification>`, background-wake notices, local-command output). Without this, a subagent's own report prose or an injected system notification could get "corrected" and written into the ledger as if it were your English — and then bias future analyses toward fixing mistakes you never made.

## Author

Luis Fernando Rivera Ramirez

## Version

0.6.0
