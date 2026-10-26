<!-- PLAN-REVIEW-REPORT -->
# Plan Review: WAL observer pipeline with token columns

- **Plan**: .ai/changes/wal-observer-pipeline/plan.md
- **Mode**: Deep
- **Date**: 2026-10-26
- **Verdict**: REVISE → SOUND after triage (all 8 findings fixed in the plan)
- **Findings**: 2 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | WARNING |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

22/22 paths ✓, 10/10 symbols ✓ (`appendLines` is at `legacy.ts:25`, not `:24`), brief↔plan ✓ except F8,
Progress↔Phase ✓ (8/8 phases, 34/34 items). No `docs/reference/contract-surfaces.md`.

Real data: 48 main transcripts, all with a WAL; 96 WALs, 48 of them with no transcript. Stop rule data:
subagent transcripts have 306 `"stop_reason":null` lines (streamed snapshots), 230 `end_turn` and 6493 `tool_use`.

## Findings

### F1 — Sessions without a WAL are left out of the ingest

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: What We're NOT Doing #1, Desired End State, Phase 4 §2, Phase 5 §1, Phase 8 §4, Migration Notes, brief
- **Detail**: Reported by the user. The plan built targets only for sessions with a WAL and showed "not
  ingested" for the rest. Today the Sessions store parses transcripts for every discovered session
  (`discovery.ts:189` lists transcripts). This change covers both Events and Sessions, so both must cover
  these sessions. On this machine no transcript lacks a WAL, so the real-data checks would not catch it.
- **Fix A ⭐ Recommended**: Ingest every discovered session; for a session with no WAL, write call rows
  from transcript tool_use / tool_result pairs with the same token join.
  - Strength: Both views cover every session; the "not ingested" API, UI and tests go away.
  - Tradeoff: Transcript-only rows need their own definition.
  - Confidence: MED — `createParser` already collects tool items and results.
  - Blind spot: A WAL that appears later.
- **Fix B**: Sessions stats only; Events empty for sessions with no WAL.
- **Decision**: FIXED (Fix A). Choices: call rows plus turn rows (`UserPromptSubmit`, `Stop` /
  `SubagentStop` on `end_turn` lines); row fields as WAL call rows, no source flag; a WAL that appears
  later marks the target stale (`wal appeared`); `done` / `total` count WAL plus transcript bytes. New
  Critical Detail "Sessions without a WAL", `head.wal`, Phase 3 §1 and §4, Phase 4 §2–§4, Phase 5 §1,
  Phase 6 §4, Phase 8 §4 and §5, 8.9, Migration Notes and the brief edited.

### F2 — Stream sync comes in Phase 5, but Phase 4 already switches the readers

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §3, Phase 5 §1
- **Detail**: Streams get new data only through the 250 ms `walTick` / `sessionTick`
  (`wal-server.ts:101-110`, `:137-193`). With per-request sync only, the `live-tail` stream checks,
  `sessions.test.ts:283-303` and `usage.test.ts:196-199` fail, so 4.1 cannot pass.
- **Fix**: Move the tick sync of streamed sessions into Phase 4 §3.
- **Decision**: FIXED

### F3 — Stale and skip rules break the reset tests, and Phase 4 does not list them

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1, Phase 4 §4
- **Detail**: Today a truncated, deleted or renamed WAL sends `reset` (`live-tail.test.ts:247-297`), and
  a truncated transcript bumps `gen` (`sessions.test.ts:343-351`). The plan freezes the target as stale
  or skips a missing WAL, but it listed no such test change and no stream signal for stale.
- **Fix**: List the checks as expected changes; add `event: stale` `{sess, reason}` on `/events-stream`
  and `pipe.stale` in session-stream frames.
- **Decision**: FIXED (Phase 4 §3 and §4, Phase 8 §4)

### F4 — `q` matches the derived keys of the target line

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Critical Implementation Details "Search text", Phase 4 §1
- **Detail**: `matcher` runs `includes(q)` on the whole line (`wal-index.ts:507`). Every `ev` line holds
  `"mcp":null`, `"err":false` and a numeric `t`, so `q=mcp` or `q=err` matches every row. `JSON.parse`
  also moves integer-like keys to the front.
- **Fix**: `rec` / `raw` last and `q` tests from there; call rows test from `"input":`.
- **Decision**: FIXED

### F5 — `bench-sessions.ts` calls `createStore` directly

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §4
- **Detail**: `bench-sessions.ts:213` builds the store with `{locate}`; `tsconfig.json` includes
  `scripts`, so `npm run check` fails at Phase 4.
- **Fix**: Add `bench-sessions.ts` to the Phase 4 §4 files.
- **Decision**: FIXED

### F6 — Store `version` = target byte size resends views on every hook line

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 4 §2
- **Detail**: WAL rows grow the target, so `/session-stream` and `/usage-stream` would resend views on
  every WAL event.
- **Fix**: `version` = target offset of the last transcript record read; it also changes with `pipe.stale`.
- **Decision**: FIXED

### F7 — `tok.off` and `IndexEntry.off` use the same name for different files

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach 1, Phase 6 §2–§3
- **Detail**: `tok {off}` was a WAL offset; after Phase 4 `IndexEntry.off` is a target offset.
- **Fix**: Rename the WAL offset to `woff` in `ev` and `tok`.
- **Decision**: FIXED

### F8 — The brief says WALs with no transcript "get rows"

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: plan-brief Open Risks #2
- **Detail**: Discovery lists only transcripts (`discovery.ts:189`), so these WALs get no target.
- **Fix**: Correct the line.
- **Decision**: FIXED
