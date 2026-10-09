#!/usr/bin/env bash
# wal-hook.test.sh — feeds wal-hook.mjs one synthetic payload per representative event shape
# and asserts the WAL line it produces. Runs against a scratch CLAUDE_PROJECT_DIR, so it never
# touches the real log.

set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
hook="$here/wal-hook.mjs"

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
wal="$workdir/.ai/logs/wal.jsonl"

fail=0
check() {
	local label="$1" expected="$2" actual="$3"
	if [[ "$expected" == "$actual" ]]; then
		printf '  ok   %s\n' "$label"
	else
		printf '  FAIL %s — expected %q, got %q\n' "$label" "$expected" "$actual"
		fail=1
	fi
}

emit() { CLAUDE_PROJECT_DIR="$workdir" node "$hook"; }

printf 'wal-hook.test.sh\n'

# Every hook must exit 0: a non-zero PreToolUse exit would block the tool it is only observing.
printf '{"hook_event_name":"PreToolUse","session_id":"s1","tool_name":"Bash","tool_use_id":"t1","tool_input":{"command":"ls"}}' | emit
check "PreToolUse exit code" "0" "$?"
check "PreToolUse event" "PreToolUse" "$(tail -1 "$wal" | jq -r '.event')"
check "PreToolUse tool_use_id promoted" "t1" "$(tail -1 "$wal" | jq -r '.tool_use_id')"

printf '{"hook_event_name":"PostToolUse","session_id":"s1","tool_name":"Bash","duration_ms":12,"tool_response":{"stdout":"hi"}}' | emit
check "PostToolUse captures tool_response" "hi" "$(tail -1 "$wal" | jq -r '.payload.tool_response.stdout')"
check "PostToolUse duration promoted" "12" "$(tail -1 "$wal" | jq -r '.duration_ms')"

printf '{"hook_event_name":"SessionEnd","session_id":"s1","reason":"clear"}' | emit
check "SessionEnd reason kept" "clear" "$(tail -1 "$wal" | jq -r '.payload.reason')"

# Malformed stdin must still produce a parseable line rather than a crash.
printf 'not json at all' | emit
check "unparseable exit code" "0" "$?"
check "unparseable recorded" "Unparseable" "$(tail -1 "$wal" | jq -r '.event')"

# A multi-megabyte tool result must be clamped, or the WAL grows unboundedly.
python3 -c 'import json,sys; sys.stdout.write(json.dumps({"hook_event_name":"PostToolUse","tool_name":"Read","tool_response":{"content":"A"*5000000}}))' | emit
big_bytes=$(tail -1 "$wal" | wc -c)
if (( big_bytes < 10000 )); then
	printf '  ok   5MB payload clamped to %s bytes\n' "$big_bytes"
else
	printf '  FAIL 5MB payload not clamped (%s bytes)\n' "$big_bytes"
	fail=1
fi

# A hook that writes to stdout would leak into the transcript, and on some events into context.
stdout_bytes=$(printf '{"hook_event_name":"Stop","session_id":"s1"}' | CLAUDE_PROJECT_DIR="$workdir" node "$hook" | wc -c)
check "writes nothing to stdout" "0" "$stdout_bytes"

check "every event landed" "6" "$(wc -l < "$wal")"

# Per-session target: the line lands beside transcript_path, and the fallback stays untouched.
# HOME is a scratch dir so workspace detection never sees the real ~/.claude.
home="$workdir/home"
mkdir -p "$home/.claude" "$workdir/projects/-x"
tpath="$workdir/projects/-x/S.jsonl"
session_wal="$workdir/projects/-x/S.wal.jsonl"
fallback_lines=$(wc -l < "$wal")

emit_session() { HOME="$home" CLAUDE_PROJECT_DIR="$workdir" node "$hook"; }
payload="{\"hook_event_name\":\"Stop\",\"session_id\":\"S\",\"transcript_path\":\"$tpath\"}"

printf '%s' "$payload" | env -u CLAUDE_CONFIG_DIR HOME="$home" CLAUDE_PROJECT_DIR="$workdir" node "$hook"
check "transcript_path: written beside transcript" "1" "$(wc -l < "$session_wal")"
check "transcript_path: fallback untouched" "$fallback_lines" "$(wc -l < "$wal")"
check "workspace unset -> default" "default" "$(tail -1 "$session_wal" | jq -r '.workspace')"

printf '{"hook_event_name":"PreToolUse","agent_id":"a1","transcript_path":"%s"}' "$tpath" | emit_session
check "subagent shares the session file" "2" "$(wc -l < "$session_wal")"
check "subagent agent_id promoted" "a1" "$(tail -1 "$session_wal" | jq -r '.agent_id')"

printf '%s' "$payload" | CLAUDE_CONFIG_DIR="$home/.claude" emit_session
check "workspace ~/.claude -> default" "default" "$(tail -1 "$session_wal" | jq -r '.workspace')"

mkdir -p "$home/.claude/workspaces/priv"
printf '%s' "$payload" | CLAUDE_CONFIG_DIR="$home/.claude/workspaces/priv" emit_session
check "workspace named dir -> basename" "priv" "$(tail -1 "$session_wal" | jq -r '.workspace')"

ln -s "$home/.claude" "$workdir/alias"
printf '%s' "$payload" | CLAUDE_CONFIG_DIR="$workdir/alias" emit_session
check "workspace symlink to ~/.claude -> default" "default" "$(tail -1 "$session_wal" | jq -r '.workspace')"

printf '%s' "$payload" | CLAUDE_CONFIG_DIR="$workdir/missing-dir" emit_session
check "workspace missing dir -> basename" "missing-dir" "$(tail -1 "$session_wal" | jq -r '.workspace')"

printf 'not json' | CLAUDE_CONFIG_DIR="$home/.claude/workspaces/priv" emit_session
check "unparseable record carries workspace" "priv" "$(tail -1 "$wal" | jq -r '.workspace')"
check "unparseable goes to fallback" "$((fallback_lines + 1))" "$(wc -l < "$wal")"

printf '{"hook_event_name":"Stop","transcript_path":"%s/odd.txt"}' "$workdir" | emit_session
check "non-.jsonl transcript_path uses fallback" "$((fallback_lines + 2))" "$(wc -l < "$wal")"

if (( fail )); then
	printf '\nFAILED\n'
	exit 1
fi
printf '\nall checks passed\n'
