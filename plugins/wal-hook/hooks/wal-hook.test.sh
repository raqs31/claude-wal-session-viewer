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

# context: the firing agent's last API call, read from the tail of its own transcript.
# Each case gets its own transcript <name>.jsonl, so its WAL <name>.wal.jsonl holds only its lines.
ctx="$workdir/ctx"
mkdir -p "$ctx"
reply() { printf '{"type":"assistant","message":{"id":"%s","model":"%s","usage":{"input_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s,"output_tokens":%s}}}\n' "$@"; }
user() { printf '{"type":"user","message":{"role":"user","content":"%s"}}\n' "$1"; }
blob() { python3 -c 'import json,sys; print(json.dumps({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"x","content":"A"*int(sys.argv[1])}]}}))' "$1"; }
fire() { printf '{"hook_event_name":"%s","session_id":"S","transcript_path":"%s"}' "$1" "$ctx/$2.jsonl" | emit_session; }
context_of() { tail -1 "$ctx/$1.wal.jsonl" | jq -c '.context'; }

{ reply m1 claude-a 1 2 3 4; reply m2 claude-b 10 20 30 40; user hi; } > "$ctx/two.jsonl"
fire Stop two
check "context: last reply before a user line" '{"tokens":60,"output":40,"model":"claude-b"}' "$(context_of two)"

{ reply m1 claude-a 5 100 0 1; reply m1 claude-a 5 100 0 7; reply m1 claude-a 5 100 0 30; } > "$ctx/dup.jsonl"
fire Stop dup
check "context: one message.id on 3 lines -> last output, tokens not summed" '{"tokens":105,"output":30,"model":"claude-a"}' "$(context_of dup)"

rc=0
fire Stop missing || rc=$?
check "context: missing transcript -> exit 0, written, no context" "0 1 null" "$rc $(wc -l < "$ctx/missing.wal.jsonl") $(context_of missing)"

{ user hi; printf '{"type":"system","subtype":"init"}\n'; } > "$ctx/fresh.jsonl"
fire Stop fresh
check "context: no assistant usage yet -> no context" "null" "$(context_of fresh)"

{ reply m1 claude-a 1 1 1 2; reply m2 '<synthetic>' 0 0 0 0; } > "$ctx/synth.jsonl"
fire Stop synth
check "context: <synthetic> last -> previous real reply" '{"tokens":3,"output":2,"model":"claude-a"}' "$(context_of synth)"

{ reply m1 claude-a 7 0 0 1; blob 300000; } > "$ctx/wide.jsonl"
fire PostToolUse wide
check "context: 300KB last line -> found by widening" '{"tokens":7,"output":1,"model":"claude-a"}' "$(context_of wide)"

{ reply m1 claude-a 7 0 0 1; blob 5000000; } > "$ctx/huge.jsonl"
fire Stop huge
check "context: 5MB last line -> written, no context" "1 null" "$(wc -l < "$ctx/huge.wal.jsonl") $(context_of huge)"

mkdir -p "$ctx/main/subagents"
reply m1 claude-main 1000 0 0 1 > "$ctx/main.jsonl"
reply s1 claude-sub 50 0 0 5 > "$ctx/own-agent.jsonl"
printf '{"hook_event_name":"SubagentStop","agent_id":"zz","transcript_path":"%s","agent_transcript_path":"%s"}' "$ctx/main.jsonl" "$ctx/own-agent.jsonl" | emit_session
check "context: SubagentStop reads agent_transcript_path" '{"tokens":50,"output":5,"model":"claude-sub"}' "$(context_of main)"

reply s2 claude-sub 60 0 0 6 > "$ctx/main/subagents/agent-abc.jsonl"
printf '{"hook_event_name":"PostToolUse","agent_id":"abc","transcript_path":"%s"}' "$ctx/main.jsonl" | emit_session
check "context: agent_id -> derived subagents/agent-<id>.jsonl" '{"tokens":60,"output":6,"model":"claude-sub"}' "$(context_of main)"

reply m1 claude-a 1 0 0 1 > "$ctx/events.jsonl"
fire PostToolUseFailure events
has_failure=$(tail -1 "$ctx/events.wal.jsonl" | jq 'has("context")')
fire PreToolUse events
check "context: PostToolUseFailure carries it, PreToolUse does not" "true false" "$has_failure $(tail -1 "$ctx/events.wal.jsonl" | jq 'has("context")')"

mkdir -p "$ctx/dir.jsonl"
fire Stop dir
check "context: transcript_path is a directory -> written, no context" "1 null" "$(wc -l < "$ctx/dir.wal.jsonl") $(context_of dir)"

reply m1 claude-a 1 0 0 1 > "$ctx/quiet.jsonl"
quiet_bytes=$(fire Stop quiet | wc -c)
check "context: context-bearing event writes nothing to stdout" "0 true" "$quiet_bytes $(tail -1 "$ctx/quiet.wal.jsonl" | jq 'has("context")')"

if (( fail )); then
	printf '\nFAILED\n'
	exit 1
fi
printf '\nall checks passed\n'
