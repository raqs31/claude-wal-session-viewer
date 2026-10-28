# WAL — wal-sort-capabilities

Append-only: board.py compact appends each board here before compacting it. Never edit or delete an entry.

## 2026-10-28 06:26 · board.md · 828 tokens · by compactor

~~~~markdown
# Board — WAL sort capabilities

change: wal-sort-capabilities · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-3 (input tokens server, generic sort keys server, sortable headers web) end to end, unattended.

## Facts

## Decisions

- 2026-10-28 orchestrator: [auto] Operator asked to run the whole change unattended: scope is plan.md as written, all 3 phases, no questions; phase commits per memory rule.
- 2026-10-28 orchestrator: [auto] Unattended: skip the plan's manual-check pauses; reviewers note skipped checks; browser checks 3.6-3.9 stay operator follow-ups.
- 2026-10-28 orchestrator: [auto] Web sending sort=tokens between phase 1 and 2 commits (server falls back to time order) is acceptable.
- 2026-10-28 orchestrator: [auto] T13 keeps its order after T2 and T3 (shared files); T4 re-review once T1-T3 and T13 close.
- 2026-10-28 orchestrator: [auto] Phase 1 follow-ups: ECONNRESET fixed in T13; manual Rebuild check deferred to operator at change end.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T5 | in_progress | 2 |  |  | interface, risk-high, tests | Generic byKey sort with direction and value cursor |
| T6 | todo | 2 |  |  | tests | Stream rejects any sort param |
| T7 | todo | 2 |  | T5 |  | Bench uses sort=tot and adds sort=dur asc |
| T8 (review) | todo | 2 |  | T5, T6, T7 |  | Phase 2 review: generic sort keys |
| T9 | todo | 3 |  | T5 | interface, tests | Web sort state rules: sort.ts |
| T10 | todo | 3 |  | T6, T9 | risk-high | Sortable headers, Datetime/Input/Total+In columns, remove Order |
| T11 | todo | 3 |  | T10 | docs | README: header sorting, Input and Total+In |
| T12 (review) | todo | 3 |  | T9, T10, T11 |  | Phase 3 review: sortable headers and columns |
Closed: T1 done · T2 done · T3 done · T4 done · T13 done
<!-- tickets:end -->

## Log

- 2026-10-28 06:02 planner: plan done: T1, T2, T3, T4 (review), T5, T6, T7, T8 (review), T9, T10, T11, T12 (review)
- 2026-10-28 06:03 orchestrator: T1 done: inp on TargetRecord, TokensFrame, Row
- 2026-10-28 06:05 orchestrator: T2 done: observer computes inp for calls and Stops (freshInput), 17/17 tests
- 2026-10-28 06:06 orchestrator: T3 done: index entry, Row and tokens frames carry inp
- 2026-10-28 06:13 orchestrator: T4 changes: WAL-less Stop rows lack inp (owners T1,T2,T3); pre-existing observer-server.test.ts:215 ECONNRESET
- 2026-10-28 06:13 orchestrator: T1 done again: EvBase.inp
- 2026-10-28 06:14 planner: replan done: T13 (new, phase 1, fixes observer-server.test.ts:215 ECONNRESET), T4 (depends_on and files extended)
- 2026-10-28 06:15 orchestrator: T2 done again: turnRow writes inp on WAL-less Stop rows
- 2026-10-28 06:15 orchestrator: T3 done again: ev entry reads rec.inp
- 2026-10-28 06:21 orchestrator: T13 done: test post helper uses agent:false (stale keep-alive socket after spawnSync), 18/18
- 2026-10-28 06:23 orchestrator: T4 round 2 changes: lint format scripts/query.test.ts:805 (T3); data fix and T13 confirmed
- 2026-10-28 06:24 orchestrator: T3 done again: query.test.ts formatted, lint clean
- 2026-10-28 06:26 orchestrator: T4 approve: phase 1 closed; full verify green (289/289, lint, build, wal-hook)
~~~~
