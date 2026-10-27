# Board — T8 coordinator

change: wal-observer-pipeline · board: T8 · cap: 2000 tokens · history: wal.md

## Goal

See the Goal of T8 in tickets/T8.md.

## Facts

## Decisions

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T8.11 | todo | 4 |  |  | interface | Rework: OF Tool call and required pipe types |
| T8.12 | todo | 4 |  |  | tests | Rework: stale frame on stream reopen, stale comments |
| T8.13 | todo | 4 |  |  |  | Rework: label for non-MCP Tool call row |
Closed: T8.1 done · T8.2 done · T8.3 done · T8.4 done · T8.5 done · T8.6 done · T8.7 done · T8.8 done · T8.9 done · T8.10 done
<!-- tickets:end -->

## Log

- 2026-10-26 16:02 planner: split T8 done: T8.1, T8.2, T8.3, T8.4, T8.5, T8.6, T8.7, T8.8, T8.9; open question on observer.test.ts and session-view.test.ts outside T8 files, see report
- 2026-10-26 16:04 planner: replan T8 done: T8.10 added (observer.test.ts, session-view.test.ts; after T8.2, T8.3); T8.9 now depends on T8.10 and runs both tests; T8.4 unchanged
- 2026-10-26 16:07 coordinator T8: T8.1 done: Pipe/Targets/syncAll/budgeted first absorb in shared/api.ts, observer.ts
- 2026-10-26 16:08 coordinator T8: T8.2 done: wal-index tails targets; T8.3 done: store over session-view
- 2026-10-26 16:10 coordinator T8: T8.10 done: observer and session-view tests frozen
- 2026-10-26 16:23 coordinator T8: T8.4 done: server syncs, stale frames, call records, purge deletes target
- 2026-10-26 16:29 coordinator T8: T8.5-T8.8 done: tests and bench updated
- 2026-10-26 16:31 coordinator T8: T8.9 done: check 4.4 only planned differences
- 2026-10-26 17:19 planner: split T8 done: T8.11, T8.12, T8.13
- 2026-10-26 17:20 planner: split T8 done: T8.11 extended with web/src/lib/usage.test.ts (T8 files too)
- 2026-10-26 17:24 coordinator T8: T8.11 done: OF Tool call, pipe required; T8.12 done: stale set empty at stream open; T8.13 done: Tool call label
