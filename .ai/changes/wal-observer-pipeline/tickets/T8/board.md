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
| T8.1 | todo | 4 |  |  | interface, risk-high | Contract: Pipe types, target and budget helpers, budgeted first sync |
| T8.2 | todo | 4 |  | T8.1 | risk-high | Events index tails targets |
| T8.3 | todo | 4 |  | T8.1 | risk-high | Sessions store reads targets through session-view |
| T8.4 | todo | 4 |  | T8.2, T8.3 | risk-high | Server syncs before reads, stale frames, call records, purge deletes the target |
| T8.5 | todo | 4 |  | T8.4 | tests | Events tests: call rows, stale frames, budget, prototype keys |
| T8.6 | todo | 4 |  | T8.4 | tests | Sessions and usage tests: pipe, stale frame, spawner-first agents |
| T8.7 | todo | 4 |  | T8.4 | tests | Trash and discovery tests: target kept, resumed, purged |
| T8.8 | todo | 4 |  | T8.4 |  | bench-sessions builds the store over an observer |
| T8.9 | todo | 4 |  | T8.1, T8.2, T8.3, T8.4, T8.5, T8.6, T8.7, T8.8 |  | Manual check 4.4: main vs branch on copied real sessions, and the final verify |
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
