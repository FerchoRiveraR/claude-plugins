#!/usr/bin/env bash
# English coach hook (UserPromptSubmit). Gives gentle, NON-BLOCKING hints on the
# user's English and remembers recurring mistakes in a ledger it feeds back.
# Hard guarantee: this hook never blocks a turn — the EXIT trap forces exit 0
# on every path (skip, error, or success). Only `exit 2` blocks; we never do that.
trap 'exit 0' EXIT

LOG="$HOME/.claude/english-coach/log.md"   # ponytail: append-only ledger, rotate by hand if it ever gets huge
NATIVE_LANG="${ENGLISH_COACH_NATIVE_LANG:-Spanish}"
STYLE="${ENGLISH_COACH_STYLE:-classic}"   # classic | code-bold-italic | minimal

# Recursion guard: the claude -p call below spawns another session that would
# re-fire this same hook. The env var short-circuits that inner run.
[ -n "${ENGLISH_COACH_RUNNING:-}" ] && exit 0
command -v claude >/dev/null 2>&1 || exit 0
command -v jq     >/dev/null 2>&1 || exit 0

input=$(cat)
prompt=$(printf '%s' "$input" | jq -r '.prompt // .user_prompt // ""')

# Skip non-prose: slash commands and anything with fewer than 5 real words
# (terse dev commands, acks, pasted code). Keeps latency/cost off normal work.
trimmed=$(printf '%s' "$prompt" | sed 's/^[[:space:]]*//')
case "$trimmed" in /*) exit 0 ;; esac
words=$(printf '%s' "$prompt" | grep -oE '[A-Za-z]{2,}' | wc -l)
[ "$words" -lt 5 ] && exit 0

ledger=$(tail -n 40 "$LOG" 2>/dev/null || true)

instr=$(cat <<EOF
You are an English coach for a native ${NATIVE_LANG} speaker (a software engineer).
Analyze ONLY the natural-language English in the MESSAGE for real mistakes:
articles, prepositions, false friends, verb tense/aspect, gerund vs infinitive,
subject-verb agreement, ${NATIVE_LANG} word-order calques, and typos. IGNORE code,
file paths, shell/slash commands, ticket IDs, and technical identifiers.
If there are no notable mistakes, output exactly: OK
Otherwise output ONLY a short note, no preamble:
- up to 5 lines, each: "quoted fragment" -> fix (≤8-word why)
- then one line: Corrected: <full corrected rewrite>
Prioritize the user's recurring past mistakes when present.
EOF
)

full=$(printf 'RECURRING PAST MISTAKES (focus here):\n%s\n\nMESSAGE:\n%s\n' \
  "${ledger:-none yet}" "$prompt")

# ponytail: --system-prompt replaces the default (skips CLAUDE.md/memory/git-status
# injection) and --disable-slash-commands skips skill loading — cuts subprocess
# startup latency without --bare, which would break OAuth/keychain auth.
note=$(printf '%s' "$full" | ENGLISH_COACH_RUNNING=1 \
  claude -p --model claude-haiku-4-5-20251001 --effort low \
  --strict-mcp-config --disable-slash-commands --system-prompt "$instr" \
  2>/dev/null || true)

# Normalize; bail if empty or a clean "OK".
clean=$(printf '%s' "$note" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
[ -z "$clean" ] && exit 0
printf '%s' "$clean" | grep -qiE '^ok[[:punct:]]*$' && exit 0

# Remember it, then inject as non-blocking context for this turn.
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
{ printf -- '- %s\n%s\n' "$(date '+%Y-%m-%d %H:%M')" "$clean"; } >> "$LOG" 2>/dev/null || true

# Render style is user-configurable via ENGLISH_COACH_STYLE (see README).
case "$STYLE" in
  code-bold-italic)
    render='render these at the very TOP of your reply as ONE compact blockquote — a leading line "> 📝 **English** —" listing each mistake as `wrong` (inline code) → **fix** (bold) joined by " · ", then the corrected sentence in italics on the next blockquote line. Keep it to 1-2 lines, understated.'
    ;;
  minimal)
    render='render these at the very TOP of your reply as ONE compact blockquote line — "> 📝 **English** —" listing each mistake as ~~wrong~~ → **fix** joined by " · ". Do NOT add a full corrected sentence line. One line only, understated.'
    ;;
  *)
    render='render these at the very TOP of your reply as ONE compact, muted blockquote — a leading line "> 📝 *English* —" listing each mistake as ~~wrong~~ → **fix** joined by " · ", then the corrected sentence in italics on the next blockquote line. Keep it to 1-2 lines, tip-style, understated.'
    ;;
esac
ctx=$(printf 'ENGLISH COACH (hints only — never block):\n%s\n\n(Assistant: %s Then answer the request normally.)' "$clean" "$render")
jq -n --arg c "$ctx" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}'
exit 0
