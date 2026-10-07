# english-coach

Non-blocking English coaching on every prompt, for non-native-English-speaking engineers.

## Overview

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) reads the natural-language part of each prompt you type and asks Haiku to flag real English mistakes: articles, prepositions, false friends, verb tense, word-order calques from your native language, and typos. Code, file paths, commands, and ticket IDs are ignored.

The fixes appear under your own message in the transcript. Claude never reads them, they never start a turn, and they never interrupt what Claude is doing. Your prompt goes through unchanged and right away; the analysis runs in the background.

## What you'll see

Send a prompt with a few typical Spanish-speaker mistakes:

```
Can you explain me how the units are consumed when two authorizations overlaps?
```

Claude answers as usual. A few seconds later, your message gets a line of fixes:

```
❯ Can you explain me how the units are consumed when two authorizations overlaps?
  📝 English — explain me → explain to me · authorizations overlaps → authorizations overlap
```

The line is italic, each mistake struck through and each fix in bold, as in 0.x. Clean prose produces nothing.

Claude can't see the hints, so don't ask Claude whether the coach is running: check `/plugin`, where `english-coach` is listed among the active mods.

Run `/english` to open a pane with your recurring mistakes, most frequent first. It works even while Claude is busy, starts no turn, and closes with Esc.

## Installation

```sh
claude plugin install english-coach@ferchoriverar
```

(Requires the `ferchoriverar` marketplace — see the [repository README](../../README.md#installation).)

## Requirements

- Claude Code **2.1.292** or later (`claude --version`).
- Interactive terminal sessions, including messages sent through Remote Control. The coach stays silent in the Desktop app, the VS Code chat panel, `claude -p`, and the Agent SDK.
- Mods must be allowed to load. They don't load under the managed settings `allowManagedModsOnly` or `allowManagedHooksOnly`, under `disableAllHooks`, with `--bare` or `--safe-mode`, or in an untrusted workspace. Run `/plugin`: the dim line under the tabs lists the active mods, and `english-coach` should be one of them.

## Configuration

- `ENGLISH_COACH_NATIVE_LANG` — your native language, used to prioritize word-order-calque mistakes (e.g. `Portuguese`, `French`). Defaults to `Spanish`. Set it in your shell profile or the `env` block in `~/.claude/settings.json`.

To stop the coach, disable the plugin: `claude plugin disable english-coach@ferchoriverar`.

## Privacy

Up to 8,000 characters of each coached prompt, plus your last 20 recorded mistakes, are sent to Anthropic through your own Claude Code session, and count against your own plan or API key.

Your mistakes are kept in the plugin's local store, `~/.claude/plugins/store/english-coach*.json` (under `$CLAUDE_CONFIG_DIR` if set): the newest 200 hints, shared by all your sessions on this machine. Claude Code deletes the file after `cleanupPeriodDays` without use. To reset your history, delete the file and run `/reload-plugins`.

## Security

The Haiku call has no tools and no conversation, so whatever a prompt asks for, it can only return text. That text is parsed locally and trusted only after every check passes: at most 5 pairs of at most 120 characters each, with each mistake at most 6 words; control characters collapsed; each `wrong` fragment has to appear verbatim in what you typed; anything with code fences, links, or `Assistant:`/`<function_calls>` is dropped. The hint is drawn for you only and never enters Claude's context. Only prompts you typed are coached: notifications, other sessions, schedules, other plugins, and pasted harness text are skipped.

## How it works

`hooks/register.js` handles `prompt.submit` for prompts typed at the terminal or sent through Remote Control. It skips slash commands, prompts under 5 words, and harness text, schedules the analysis with `$.clock.after(0, …)`, and passes the prompt on untouched. The analysis calls `$.model.complete` with the coach instructions and your recent mistakes, runs the checks above, and appends the result to the ledger in `$.store`. A `ui.render` hook on `UserMessage` adds the fixes under the message whose text matches, keeping Claude Code's own drawing of it. Those annotations live in memory: messages from before a `/reload-plugins` or a restart lose theirs, though the ledger keeps every hint.

## Testing

```sh
claude plugin validate --strict plugins/english-coach
claude plugin test plugins/english-coach
claude --plugin-dir plugins/english-coach   # try it live; overrides the installed copy for that session
```

## Upgrading from 0.x

0.x was a settings hook that ran `claude -p` and woke Claude to post each hint as a reply. After updating, run `/reload-plugins` in each open session (or restart it). Your old history in `~/.claude/english-coach/log.md` is left untouched and no longer read; the new ledger starts empty.

## Author

Luis Fernando Rivera Ramirez
