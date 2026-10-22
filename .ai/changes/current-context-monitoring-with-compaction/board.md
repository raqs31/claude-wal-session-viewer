# Board — wal-hook context-window monitoring + per-agent context chart

change: current-context-monitoring-with-compaction · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md e2e: hook context field + shell tests, benchmark, Context per call chart in session view with compaction markers, 0.3.0 + README; on feat/subagent-prompts, local commits only.

## Facts

- git fetch origin fails (no access); origin/main may be stale. Change folder already lives in this repo.
- Phase 1 closed and committed as e388985: hook context step in wal-hook.mjs (lines 88-193), 12 shell cases, 35/35 pass, biome clean.
- TS2345 guard added at wal-hook.mjs:112-113; lint, check and test pass.
- Phase 2 open: T3 benchmark in progress; T4 review waits on T3.

## Decisions

- 2026-10-22 orchestrator: Base is feat/subagent-prompts, not a branch off main; adapt phase 3 to the Main charts/prompt and compaction detection already on this branch.
- 2026-10-22 orchestrator: Context per call chart marks compactions, reusing this branch's compaction data (overrides plan's 'no markers').
- 2026-10-22 orchestrator: Shipping: local commits per phase on this branch; no push, no PR.
- 2026-10-22 orchestrator: Benchmark uses the largest real transcript under ~/.claude/projects, read-only; numbers go in plan.md Review, no committed bench code.
- 2026-10-22 orchestrator: Tickets approved as planned. Bench on the 42.4 MB transcript is enough. No security tag on T1. Operator runs the manual checks (jq on a live WAL, viewer under npm run dev) at phase end.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T4 (review) | todo | 2 |  |  |  | Phase 2 review |
| T5 | todo | 3 |  |  |  | Context per call chart with compaction markers, Main open on load |
| T6 (review) | todo | 3 |  | T5 |  | Phase 3 review |
| T7 | todo | 4 |  | T5 | docs | Version 0.3.0 and README docs |
| T8 (review) | todo | 4 |  | T7 |  | Phase 4 review |
| T9 (review) | todo | 5 |  | T4, T6, T8 |  | Phase 5 final checks |
Closed: T1 done · T2 done · T3 done
<!-- tickets:end -->

## Log

- 2026-10-22 10:39 orchestrator: T3 done: worst case +7.75ms -> guard (byte-level partial-line cut, allocUnsafe) -> +2.30ms; numbers in plan.md Review
- 2026-10-22 10:41 orchestrator: T4 approve: phase 2 closed; 1 minor follow-up (short readSync)
