# Board — WAL sort capabilities

change: wal-sort-capabilities · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-3 (input tokens server, generic sort keys server, sortable headers web) end to end, unattended.

## Facts

- Phase 1 closed: T1, T2, T3, T4, T13 done. Input tokens (inp) on TargetRecord, TokensFrame, Row and the index entry.
- Observer computes inp for calls and Stop rows; WAL-less Stop rows get inp from turnRow.
- Pre-existing ECONNRESET in observer-server.test.ts:215 is fixed in T13 (test post helper uses agent:false).
- Phase 1 verify green: 289/289 tests, lint, build, wal-hook.
- Manual Rebuild check is deferred to the operator at change end.

## Decisions

- 2026-10-28 orchestrator: [auto] Operator asked to run the whole change unattended: plan.md as written, all 3 phases, no questions; phase commits per memory rule.
- 2026-10-28 orchestrator: [auto] Unattended: skip the plan's manual-check pauses; reviewers note skipped checks; browser checks 3.6-3.9 stay operator follow-ups.
- 2026-10-28 orchestrator: [auto] Web sending sort=tokens between phase 1 and 2 commits (server falls back to time order) is acceptable.
- 2026-10-28 orchestrator: [auto] T13 ran after T2 and T3 because they share files.
- 2026-10-28 orchestrator: [auto] T5 follow-up (cursor rejects fractional values, e.g. duration_ms under sort=dur) is fixed now in T5, per the fix-all-follow-ups rule.
- 2026-10-28 orchestrator: [auto] T9 follow-up (single View type) goes to T10, which owns useEvents.ts.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T8 (review) | todo | 2 |  |  |  | Phase 2 review: generic sort keys |
| T10 | todo | 3 |  |  | risk-high | Sortable headers, Datetime/Input/Total+In columns, remove Order |
| T11 | todo | 3 |  | T10 | docs | README: header sorting, Input and Total+In |
| T12 (review) | todo | 3 |  | T10, T11 |  | Phase 3 review: sortable headers and columns |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T9 done · T13 done
<!-- tickets:end -->

## Log

- 2026-10-28 06:27 orchestrator: T6 done: /events-stream rejects any sort param with 400
- 2026-10-28 06:30 orchestrator: T5 done: byKey sort (6 keys, asc/desc, value cursor), sort=tokens branch removed
- 2026-10-28 06:31 orchestrator: T9 done: web/src/lib/sort.ts rules + 5 tests
- 2026-10-28 06:31 orchestrator: T5 done again: KEY_CURSOR accepts fractional/exponent values, sort=dur paging test
- 2026-10-28 06:32 orchestrator: T7 done: bench uses sort=tot, adds sort=dur asc; npm run check fails in web (T9's sort.ts/sort.test.ts)
- 2026-10-28 06:33 orchestrator: T9 done again: sort.ts declares View locally; npm run check green
- 2026-10-28 06:35 orchestrator: T8 approve with 3 minor follow-ups (T5 tests for unknown dir and q+asc; Infinity cursor; plan.md:173 cursor pattern)
- 2026-10-28 06:37 orchestrator: T5 done again: Infinity cursor round-trips; tests for unknown dir and q+asc; plan.md:173 cursor pattern updated by orchestrator
- 2026-10-28 06:39 orchestrator: T8 approve (confirm): fixes verified, bench run passes (sort=dur asc 99 ms, 474 MB peak); plan.md:173 now lists -?Infinity
