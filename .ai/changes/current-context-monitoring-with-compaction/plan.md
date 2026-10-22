# wal-hook Context-Window Monitoring Implementation Plan

> Target repo: the wal observer project (`raqs31/claude-wal-session-viewer`), base branch `main`. All paths
> below are relative to that repo's root. This folder was planned from agentic-toys and moves into that
> repo's `.ai/changes/` before implementation.

## Overview

Each WAL record written on PostToolUse, PostToolUseFailure, Stop and SubagentStop gets a top-level
`context: { tokens, output, model }` field: the size of the last API call made by the agent that fired the
event (main agent or subagent). It is read from the tail of that agent's own transcript. The viewer gets a
context-over-time chart in each agent's details, including Main, whose row starts expanded. Reason: during
long neula-evals runs the operator needs to see how full each agent's context window is; today the WAL has
events but no usage numbers.

## Current State Analysis

- `plugins/wal-hook/hooks/wal-hook.mjs` builds one record from the stdin payload (promoted fields + `payload`
  remainder), clamps it, and does one `appendFileSync` to `<transcript>.wal.jsonl`. The whole body is wrapped
  in a try/catch and always exits 0. It never reads the transcript.
- `plugins/wal-hook/hooks/wal-hook.test.sh` (bash + jq, scratch `CLAUDE_PROJECT_DIR`) is the hook's test
  suite. It runs at the end of `npm test`. CI (`.github/workflows/ci.yml`) runs `npm run lint`,
  `npm run check`, `npm test` on Node 24 and 26.
- Version `0.2.0` is in `package.json:3`, `package-lock.json:3` and `:9`, and
  `plugins/wal-hook/.claude-plugin/plugin.json:4`. `release.yml` requires the tag to equal `v` + the
  package.json version. There is no CHANGELOG.
- Viewer on `main`: the per-agent details panel (`AgentRow` → `AgentCharts`) fetches that agent's own
  per-call `SessionSeries` from its transcript and refetches live on a `stamp` change. The Main row gets no
  charts (`SessionStats.tsx`, `ByAgent`: `id !== 'main' && …`). `useAgentSeries` always requests scope
  `agent:<id>`. `main` has no compaction markers (`compacts`, `compactMarks`, `drawCompacts` exist only on
  `feat/subagent-prompts`).
- The viewer already shows "Context at end" per agent (`scripts/sessions.ts`, `agentStat`); nothing plots
  context over time.

## Desired End State

- A PostToolUse / PostToolUseFailure / Stop / SubagentStop record carries
  `context: { tokens, output, model }` when the agent's transcript has a real assistant reply with usage.
  Otherwise the field is absent and the rest of the record is unchanged.
- Subagent events report the subagent's context, not the main agent's.
- Hook overhead on a >50 MB transcript is measured and stays within a few ms (guard added if not).
- In the viewer's session view, every agent row (Main included) shows a "Context per call" chart in its
  details, and the Main row is expanded on load.
- Version 0.3.0; README documents the field and the subagent payload fields. One PR to `main`.

### Key Discoveries:

- Real payloads, checked against recorded WALs (session `97a62841…`, 2026-10-22):
  - SubagentStop: `payload.agent_transcript_path` = `<dir>/<session>/subagents/agent-<agent_id>.jsonl`
    (the file exists); `payload.transcript_path` is the main transcript; `agent_id`, `agent_type` top level.
  - PostToolUse inside a subagent: only `payload.transcript_path` (the MAIN transcript) plus top-level
    `agent_id` / `agent_type`. The agent's path must be derived.
  - Stop: `transcript_path` only, no `agent_id`.
- Transcript assistant lines: `message.id`, `message.model`, `message.usage.{input_tokens,
  cache_read_input_tokens, cache_creation_input_tokens, output_tokens, …}`. One reply spans up to 3 lines
  with the same `message.id`. In subagent files the early lines are streaming snapshots and only the last
  is final (`scripts/transcripts.ts:170`).
- `message.model === "<synthetic>"` lines (API errors etc., found in 19 local transcripts) carry all-zero
  usage. Taking them would report context 0. The viewer already skips them (`scripts/transcripts.ts:166`).
- Compaction is a `system` line with `subtype: "compact_boundary"` and `compactMetadata.postTokens`. After
  it, the next assistant reply's usage reflects the compacted size, so "last reply" handles compaction with
  no extra logic.
- No local transcript exceeds 50 MB (only WAL files do), so the benchmark uses a generated transcript.

## What We're NOT Doing

- No `context` on PreToolUse, PostCompact, SubagentStart or other events.
- No running max, no window-size percentage (no transcript records the model's window size).
- No WAL-index / `Row` / API changes. The chart uses the existing transcript series, not the new WAL field.
- No compaction markers in the new chart (they are not on `main`; the drop in the line shows a compaction).
- No CHANGELOG file; the README field docs are the record.
- No committed benchmark script.
- No change to neula-evals; the operator re-vendors the hook.

## Implementation Approach

The hook gains one isolated step: before serialising, compute `context` for the four events, inside its
own try/catch that yields "no field" on any error, so the existing record and its single append are never
affected. The tail reader reads a bounded window from the end of the file and widens geometrically up to a
cap. The viewer derives per-call context from the series `AgentCharts` already fetches, so the chart is a
pure client-side addition.

## Critical Implementation Details

- **Failure isolation:** the context step must have its own try/catch inside `main()`. If it threw into the
  outer catch, the record would never be appended, which breaks requirement 4.
- **Tail window:** read the last 64 KB; if no qualifying line is found and the window does not cover the
  whole file, widen ×4 (256 KB, 1 MB, 4 MB) and stop at 4 MB, then omit `context`. When the window starts
  mid-file, drop the first (partial) line before parsing. Scan lines from the end and take the first that
  is `type === "assistant"`, has `message.usage`, and `message.model !== "<synthetic>"`. That is the last
  line of its `message.id` group, so duplicates are never summed and the final streaming snapshot wins.
- **Size cap interaction:** `context` is a top-level field, so the existing `MAX_LINE` fallback (which drops
  only `payload` / `raw`) keeps it.

## Phase 1: Hook — context extraction and tests

### Overview

Create the branch, add the context step to the hook, and cover it in the shell test suite.

### Changes Required:

#### 1. Branch

**Intent**: Isolate the work from `main` for a single PR.

**Contract**: Branch `feat/context-monitoring` created from an up-to-date `main` in the wal observer repo.

#### 2. Context step

**File**: `plugins/wal-hook/hooks/wal-hook.mjs`

**Intent**: For the four events, pick the agent's transcript, tail-read it, and set `record.context`. Update
the header comment to say which events carry `context`, that it is read from the transcript tail, and that
its failure only omits the field (the three existing constraints stay as written).

**Contract**:
- Events: `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStop`. Any other event: no read.
- Transcript choice, first match wins:
  1. `payload.agent_transcript_path` (string ending in `.jsonl`), as sent on SubagentStop.
  2. If `agent_id` is present: `<transcript_path minus ".jsonl">/subagents/agent-<agent_id>.jsonl`.
     `agent_id` must match `/^[A-Za-z0-9_-]+$/` before it is used in a path.
  3. Otherwise `payload.transcript_path`.
- Field: `context: { tokens: input_tokens + cache_read_input_tokens + cache_creation_input_tokens,
  output: output_tokens, model: message.model }`. Missing usage numbers count as 0.
- Omitted when: no qualifying path, file missing or unreadable, no qualifying assistant line within 4 MB,
  or any exception.
- Constraints kept: exit 0, nothing on stdout, exactly one `appendFileSync` per event. Synchronous fs only
  (`openSync` / `fstatSync` / `readSync` / `closeSync`), fd closed in a `finally`.

#### 3. Tests

**File**: `plugins/wal-hook/hooks/wal-hook.test.sh`

**Intent**: Add cases using transcript fixtures written into the scratch dir (WAL lands beside them).

**Contract**: New `check` cases:
- Tail parsing: two replies followed by a user line → `context.tokens` = the second reply's sum,
  `context.output` and `context.model` from it.
- Same `message.id` on 3 lines with growing `output_tokens` → output from the last line, tokens not summed.
- Missing transcript file → record written, no `context`, exit 0.
- Transcript with no assistant usage yet → no `context`.
- Last assistant line is `<synthetic>` → `context` from the previous real reply.
- Last line is a 300 KB user tool_result → `context` found by widening.
- Last line is a 5 MB blob → no `context`, record still written.
- SubagentStop with `agent_transcript_path` → the agent file's context, not the main one.
- PostToolUse with `agent_id` only → context from the derived `subagents/agent-<id>.jsonl`.
- PostToolUseFailure carries `context`; PreToolUse does not.
- `transcript_path` pointing at a directory → record written, no `context`.
- Context-bearing event writes nothing to stdout.

### Success Criteria:

#### Automated Verification:

- Hook tests pass: `bash plugins/wal-hook/hooks/wal-hook.test.sh`
- Full suite passes: `npm test`
- Lint and types pass: `npm run lint && npm run check`

#### Manual Verification:

- In a real session with the hook linked, a subagent's PostToolUse and SubagentStop records show its own
  `context`, and the main agent's Stop shows the main context (`jq '.context' <session>.wal.jsonl`), without
  printing payloads.

**Implementation Note**: After automated verification passes, pause for the operator to confirm the manual
check before Phase 2.

---

## Phase 2: Tail-read benchmark (one-off)

### Overview

Measure the hook's overhead on a >50 MB transcript and add a guard only if it exceeds a few ms.

### Changes Required:

#### 1. Measurement

**Intent**: Generate a ~60 MB transcript in a temp dir (alternating realistic user / assistant lines), plus
a variant whose last 4 MB has no assistant line (worst-case widening). Run the hook 30× each with a
PostToolUse payload (reads the tail) and a PreToolUse payload (no read) against the same transcript;
compare medians. The difference is the overhead.

**Contract**: Results recorded in this plan's `## Review` section: file size, median and p95 for each case.
Nothing committed except, if needed, the guard below.

#### 2. Guard (only if overhead > 5 ms median)

**File**: `plugins/wal-hook/hooks/wal-hook.mjs`

**Intent**: Cut the parse cost cheaply. Example: skip `JSON.parse` for lines that do not contain
`"assistant"`, or lower the cap. Choose by what the measurement shows.

**Contract**: Phase 1 tests still pass unchanged.

### Success Criteria:

#### Automated Verification:

- Benchmark numbers recorded in `## Review` for the normal and worst-case tail
- Hook tests still pass: `bash plugins/wal-hook/hooks/wal-hook.test.sh`

---

## Phase 3: Viewer — per-agent context chart

### Overview

Show context per call over time in each agent's details, enable charts for Main, and open Main by default.

### Changes Required:

#### 1. Series helper

**File**: `web/src/lib/series.ts` (+ `web/src/lib/series.test.ts`)

**Intent**: Derive each call's context from the cumulative columns the series already carries.

**Contract**: `contextPerCall(s: SessionSeries): [number[], number[]]` → `[s.t, per-call input + cacheRead
+ cacheWrite5m + cacheWrite1h]`, using the existing `step` over `s.cumulative`. Test: a three-call series
with a smaller third call (compaction) gives the expected per-call values.

#### 2. Chart

**File**: `web/src/components/charts/ContextOverTime.tsx` (new)

**Intent**: A single-line uPlot chart titled "Context per call", following `TokensOverTime.tsx` (same
`UPlot`, `xAxis`, `yAxis`, no drag zoom).

**Contract**: `ContextOverTime({ series }: { series: SessionSeries })`.

#### 3. Mount and Main

**Files**: `web/src/components/charts/AgentCharts.tsx`, `web/src/components/SessionStats.tsx`,
`web/src/useSession.ts`

**Intent**: Render `ContextOverTime` first in `AgentCharts`. In `ByAgent`, drop the `id !== 'main'` gate so
Main gets charts, and start the open set with `'main'`. In `useAgentSeries`, request scope `main` when the
agent is `main` (today it would ask for `agent:main`).

**Contract**: `ByAgent` initial state `new Set(['main'])`; `useAgentSeries` scope = `agent === 'main' ?
'main' : \`agent:${agent}\``.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint and types pass: `npm run lint && npm run check`

#### Manual Verification:

- `npm run dev`, open a session with subagents: the Main row is expanded on load and shows "Context per
  call"; expanding a subagent shows its own chart.
- In a session with a compaction, the Main line drops at the compaction.
- In a live session, the chart grows as new calls land.

**Implementation Note**: After automated verification passes, pause for the operator to confirm the manual
checks before Phase 4.

---

## Phase 4: Version and README

### Overview

Bump to 0.3.0 and document the field.

### Changes Required:

#### 1. Version

**Files**: `package.json`, `package-lock.json` (root `version` and `packages[""].version`),
`plugins/wal-hook/.claude-plugin/plugin.json`

**Intent**: Keep all three in lockstep; the release workflow ties the tag to `package.json`.

**Contract**: `"version": "0.3.0"` in each place.

#### 2. README

**File**: `README.md`, section "What the hook captures" (and one line in "The page")

**Intent**: Document `context`: which events carry it, the formula, "last reply, not summed, not a max;
drops after compaction", when it is omitted, and how the transcript is chosen, naming the exact payload
fields (`agent_transcript_path` on SubagentStop; derived `subagents/agent-<agent_id>.jsonl` for other
subagent events). "The page": the per-agent "Context per call" chart and Main open by default.

**Contract**: Prose only.

### Success Criteria:

#### Automated Verification:

- Versions agree: `grep -n '"version"' package.json plugins/wal-hook/.claude-plugin/plugin.json && head -10 package-lock.json`
- Lint passes: `npm run lint`
- Pack check passes: `npm pack --dry-run`

---

## Phase 5: Ship

### Overview

Run the full checks and open one PR against `main`.

### Changes Required:

#### 1. PR

**Intent**: Push `feat/context-monitoring` and open a PR to `main` with a summary, the benchmark numbers,
and the subagent payload-field note for re-vendoring into neula-evals.

**Contract**: `gh pr create --base main`. The final report to the operator pastes the test output and the
payload-field note.

### Success Criteria:

#### Automated Verification:

- Full check on the branch: `npm run lint && npm run check && npm test`
- PR open against `main`: `gh pr view --json baseRefName,url`

#### Manual Verification:

- CI green on the PR

---

## Testing Strategy

### Unit Tests:

- Hook: the twelve shell cases in Phase 1.
- Viewer: `contextPerCall` in `series.test.ts`.

### Integration Tests:

- `npm test` runs the vite build, `node --test`, and `wal-hook.test.sh` together.

### Manual Testing Steps:

1. Link the hook from the branch, run a session that spawns a subagent, and check `jq '.context'` on the
   WAL for main and subagent events.
2. Open that session in the viewer; Main is expanded with its context chart; a subagent row shows its own.
3. Do not read or print credentials or OAuth tokens from any profile used for testing; inspect only
   `context` and key names.

## Performance Considerations

The tail read is bounded at 4 MB and normally reads 64 KB, so cost is independent of transcript size except
in the widening worst case. Phase 2 measures both and decides on a guard. Hook timeout is 10 s.

## Migration Notes

Additive field; older readers ignore it. Sessions recorded before 0.3.0 have no `context`; the viewer chart
does not depend on it.

## References

- Hook: `plugins/wal-hook/hooks/wal-hook.mjs`, tests `plugins/wal-hook/hooks/wal-hook.test.sh`
- Usage dedupe and synthetic skip precedent: `scripts/transcripts.ts:162-185`
- Context-at-end precedent: `scripts/sessions.ts:162-177`
- Chart pattern: `web/src/components/charts/TokensOverTime.tsx`
- Prior transcript research: `.ai/changes/wal-sessions-tab/change.md` (wal observer repo)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hook — context extraction and tests

#### Automated

- [ ] 1.1 Hook tests pass: `bash plugins/wal-hook/hooks/wal-hook.test.sh`
- [ ] 1.2 Full suite passes: `npm test`
- [ ] 1.3 Lint and types pass: `npm run lint && npm run check`

#### Manual

- [ ] 1.4 Real session shows per-agent `context` on subagent and main events

### Phase 2: Tail-read benchmark (one-off)

#### Automated

- [ ] 2.1 Benchmark numbers recorded in `## Review` for the normal and worst-case tail
- [ ] 2.2 Hook tests still pass: `bash plugins/wal-hook/hooks/wal-hook.test.sh`

### Phase 3: Viewer — per-agent context chart

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Lint and types pass: `npm run lint && npm run check`

#### Manual

- [ ] 3.3 Main row expanded on load with "Context per call"; subagent rows show their own chart
- [ ] 3.4 Main line drops at a compaction
- [ ] 3.5 Live session chart grows as calls land

### Phase 4: Version and README

#### Automated

- [ ] 4.1 Versions agree at 0.3.0
- [ ] 4.2 Lint passes: `npm run lint`
- [ ] 4.3 Pack check passes: `npm pack --dry-run`

### Phase 5: Ship

#### Automated

- [ ] 5.1 Full check on the branch: `npm run lint && npm run check && npm test`
- [ ] 5.2 PR open against `main`

#### Manual

- [ ] 5.3 CI green on the PR

## Review

### Phase 2: tail-read benchmark

Transcript: largest real one under `~/.claude/projects`, 42,409,553 bytes (below the planned 50 MB), measured on a copy in a temp dir. Worst case: a second copy plus one appended 4 MB user line, 46,604,937 bytes. 30 hook runs per cell, node spawn wall-clock, ms. Median is the mean of the 15th and 16th sorted runs.

Before the guard:

| Run | Median | p95 |
| --- | --- | --- |
| normal, PreToolUse (no read) | 29.42 | 47.75 |
| normal, PostToolUse (tail read) | 28.35 | 37.33 |
| worst, PreToolUse | 27.26 | 38.74 |
| worst, PostToolUse | 35.01 | 43.62 |

Overhead (PostToolUse minus PreToolUse medians): normal -1.07 ms (below noise), worst +7.75 ms. The worst case exceeds 5 ms.

Guard: `readContext` cuts the partial first line on the buffer bytes (`buffer.indexOf(10)`) and decodes only the rest, and allocates with `allocUnsafe`. A skip-parse guard would not help here: the cost was reading and decoding the widening windows, not `JSON.parse`. Cap and window sizes unchanged.

After the guard:

| Run | Median | p95 |
| --- | --- | --- |
| normal, PreToolUse | 30.71 | 41.81 |
| normal, PostToolUse | 29.31 | 33.38 |
| worst, PreToolUse | 32.00 | 54.16 |
| worst, PostToolUse | 34.30 | 49.04 |

Overhead: normal -1.40 ms (below noise), worst +2.30 ms. Both are under 5 ms. `bash plugins/wal-hook/hooks/wal-hook.test.sh` passes unchanged.
