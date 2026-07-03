# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's
[private vulnerability reporting](https://github.com/ferchoriverar/claude-plugins/security/advisories/new).
Include what you found, how to reproduce it, and the affected plugin. Expect an
acknowledgement within a few days.

## Scope

These plugins run locally as part of your own Claude Code session. Worth flagging:

- **Command injection** or arbitrary code execution in a hook or script.
- **Data exfiltration** — anything that sends your prompts, code, or files
  off-machine. Both plugins are designed to stay local; a break in that is a bug.
- **Path traversal** or writes outside the documented locations.

## Supported versions

This is a personal, pre-1.0 project — only the latest `main` is supported.
Fixes ship there; there are no backports.
