# Board — WAL sort capabilities

change: wal-sort-capabilities · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-3 (input tokens server, generic sort keys server, sortable headers web) end to end, unattended.

## Facts

- Phase 1 closed: T1, T2, T3, T4, T13 done. Input tokens (inp) on TargetRecord, TokensFrame, Row and the index entry.
- Observer computes inp for calls and Stop rows; WAL-less Stop rows get inp from turnRow.
- Pre-existing ECONNRESET in observer-server.test.ts:215 is fixed in T13 (test post helper uses agent:false).
- Phase 1 verify green: 289/289 tests, lint, build, wal-hook.
- Phase 2 closed: T5, T6, T7, T8, T9 done.
- Server sort: 6 keys, asc/desc, value cursor (T5). The sort=tokens branch is removed.
- /events-stream rejects any sort param with 400 (T6).
- web/src/lib/sort.ts holds the sort rules, with 5 tests (T9).
- Bench uses sort=tot and adds sort=dur asc (T7).
- T8 review approved. Its follow-ups are fixed in T5 (Infinity cursor, fractional cursor values, unknown-dir and q+asc tests, plan.md:173 lists -?Infinity).
- Log reports npm run check green after T9.
- Phase 3 open: T10 in progress, then T11 (docs) and T12 (review).
- Manual Rebuild check and plan.md browser checks 3.6-3.9 stay operator follow-ups.

## Decisions

- 2026-10-28 orchestrator: [auto] Operator asked for an unattended run of all 3 phases of plan.md. Skip the plan's manual-check pauses; reviewers note skipped checks; phase commits per memory rule.
- 2026-10-28 orchestrator: [auto] Web sending sort=tokens between phase 1 and 2 commits (server falls back to time order) is acceptable.
- 2026-10-28 orchestrator: [auto] T9 follow-up (single View type) goes to T10, which owns useEvents.ts.
- 2026-10-28 orchestrator: [auto] T10: T9 exports View from sort.ts; T10 then imports it in useEvents.ts.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done
<!-- tickets:end -->

## Log

- 2026-10-28 06:42 orchestrator: T10 blocked: all work landed (127/127, lint); single View type needs sort.ts (T9's file)
- 2026-10-28 06:42 orchestrator: T9 done again: sort.ts exports View
- 2026-10-28 06:43 orchestrator: T10 done: sortable headers, Datetime/Input/Total+In columns, Order removed, single View type
- 2026-10-28 06:44 orchestrator: T11 done: README documents header sorting, Input and Total+In
- 2026-10-28 06:46 orchestrator: T12 approve; 1 minor follow-up for T10 (below() cursor split ignores sorted v. prefix)
- 2026-10-28 06:47 orchestrator: T10 done again: below() is time-cursor only by contract; loadOlder skips deferred rows when sorted
- 2026-10-28 06:49 orchestrator: T12 approve (confirm): all phases closed
