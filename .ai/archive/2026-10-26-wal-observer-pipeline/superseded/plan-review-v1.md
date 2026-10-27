<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Token columns, token filter and Tokens order in the Events view

- **Plan**: .ai/changes/wal-events-token-columns/plan.md
- **Mode**: Deep
- **Date**: 2026-10-26
- **Verdict**: RETHINK (data source only; filter, sort, stream and UI design are sound)
- **Findings**: 2 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | PASS |

## Grounding

17/17 paths ✓, symbols ✓ (`lastUsage`, `matcher`, `summary`, `CURSOR`, `nodur`, `colSpan`), brief↔plan ✓
(`change.md` notes still describe a transcript join; the brief records the switch to WAL-only),
Progress↔Phase ✓ (5/5 phases, 23/23 items).

Data check: the plan's grouping was run over the 36 recorded WALs with `context`, and each Post was joined
to its transcript line by `tool_use_id`. Scripts: `/tmp/prv-script/{sim,join,join2}.mjs` (temporary).

## Findings

### F1 — Post `context` is often the previous request, not the issuing message

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Current State Analysis, Key Discoveries, Phases 1–2
- **Detail**: 1354 of 5508 real Posts (25%) carry the request exactly one before the issuing message,
  spread across almost every file (0–50% per file). The issuing message is not yet in the transcript when
  the hook reads it. Under the plan's rules the stale Post joins the previous message's group (Phase 1
  `id` would be the previous id too), so its numbers and the next group's are silently wrong. Synthetic
  test fixtures would pass.
- **Fix A**: hook polls for the issuing line by `tool_use_id`; stale context marked and ignored.
- **Fix B**: join transcript `usage` by `tool_use_id` in the viewer.
- **Decision**: FIXED (fix differently — apply via `/mario:plan` re-plan). Decisions:
  - Source: the transcript, joined by `tool_use_id`. The hook is unchanged; Phase 1 is dropped. WAL
    `context` is not used for tokens.
  - The `scripts/wal` server runs the join as a background job and appends the results to the WAL as
    `Tokens` lines (O_APPEND, one write per line). The index applies them to rows and does not show them
    as rows.
  - New events are enriched automatically in the background. A "Sync tokens" button in the view
    enriches the picked sessions' older rows.
  - Rows that are not enriched show —; the header tells the user that a sync is available.
  - Open for the re-plan: `Tokens` line shape, anchor for Stop / SubagentStop rows (no `tool_use_id`),
    sync endpoint and progress, idempotence (skip tuids already enriched), counts/bench `total` that
    must exclude `Tokens` lines.

### F2 — Most Stop / SubagentStop records repeat the open group's `context`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Implementation Approach, step 3
- **Detail**: Stop has the same `context.tokens` as the open group in 180 of 267 cases, SubagentStop in
  119 of 154. Step 3 then gives `growth = −output`, read as compaction: the turn's last call gets Result —
  and the Stop row double-counts the tool message's output.
- **Fix**: hook waits for the final reply, or index treats a same-key Stop as stale.
- **Decision**: FIXED (superseded by F1 — the transcript is the source, so WAL `context` staleness no
  longer applies).

### F3 — Stream hold-back has no resume, order or latency story

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details (stream hold-back), Phase 4 §1
- **Detail**: `walTick` advances `pos` to `entries.length` unconditionally and the `id:` vector is the
  resume point (`wal-server.ts:175-181`, `:320`). A held row behind `pos` is lost on reconnect; stopping
  `pos` at it re-sends later rows. A late held row lands above newer rows in the table view
  (`useEvents.ts:211`). A row can stay pending for a whole subagent run.
- **Fix**: `id:` vector per index = min(first held seq, `entries.length`); page dedupes by `sess` + `seq`
  and inserts late rows in `cmp` order; README states the wait; reconnect-while-held live-tail test.
- **Decision**: FIXED (Critical Details, Phase 4 §1 and §3, Phase 5 §3 and §4 edited)

### F4 — Tokens order with `q` reads the disk for every matching row on every page

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Sort cursor, Phase 3 §2, Phase 4 bench
- **Detail**: `before` pages stop at `limit + 1` today (`wal-index.ts:592`); a sorted page runs `q` over
  the whole pick, so each scroll page with `q` costs up to ~3 s. No bench check for `sort=tokens` + `q`.
- **Fix**: later pages filter without `q`, sort below the cursor, then test `q` in order until
  `limit + 1` hits; add a `sort=tokens` + `q` bench check.
- **Decision**: FIXED (Critical Details "Sorted pages with `q`", Phase 4 §4 bench limits edited)
