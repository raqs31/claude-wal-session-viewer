# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phases 1 to 3 closed. Phase 1: 516b183 (scripts/target.ts, observer target format, append, tail reader, lock; 10 tests). Phase 2: bafbfc1 (scripts/observer.ts ev, call, ck, resume, stale; 15 tests). Phase 3: d8689e0 (T5 transcript pass, no-WAL call/turn rows, stats records, 37 tests; T6 scripts/session-view.ts with golden test; T7 review approved after fixes).
- Lock uses a hard link; release checks the pid.
- T5 files were widened to target.ts and session-view.ts(+test) by replan.
- Phase 4 is next: T8 in progress; T9 waits on it.

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: [auto] Open T4 follow-ups go to T8, which owns budgeted sync and those files: #2 (first sync ignores budgetMs) and the prototype-key lookup (wal-index.ts:169, shared/api.ts:27).
- 2026-10-26 orchestrator: [auto] Open T5 follow-ups (read-only no-WAL stale; transcript bytes in progress) go to T10.
- 2026-10-26 orchestrator: [auto] Nested agents list spawner first (plan order), not readdir order; T8 states it and 4.4 expects it.
- 2026-10-26 orchestrator: Session ends after T9 review: no more dispatch; commit all incl. .ai/changes; user pushes and resumes on VPS (findings, if any, stay open on T9).
- 2026-10-26 orchestrator: Resume session: scope phases 4-8 to the end; recorded decisions stay in force; T9 minor follow-ups fixed in phase 4.
- 2026-10-26 orchestrator: [auto] T9 follow-up wal-server.ts:209-213 (empty-pick stream sync) goes to T10: its background loop replaces that code. Other T9 follow-ups go to T8 rework.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T10 | todo | 5 |  |  | interface, security, risk-high | Server lock, background loop, /observer and /rebuild |
| T11 | todo | 5 |  | T10 |  | CLI wal rebuild |
| T12 (review) | todo | 5 |  | T10 |  | Security review: T10 /rebuild and lock |
| T13 (review) | todo | 5 |  | T10, T11, T12 |  | Phase 5 review |
| T14 | todo | 6 |  |  |  | Parser data for the token join |
| T15 | todo | 6 |  | T14, T10, T11 | risk-high | Token join in the observer |
| T16 | todo | 6 |  | T15 | interface | Index applies tok entries to rows |
| T17 (review) | todo | 6 |  | T14, T15, T16 |  | Phase 6 review |
| T18 | todo | 7 |  | T16 | risk-high | Token filter and Tokens order in the index |
| T19 | todo | 7 |  | T18 | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T18, T10 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T18, T19, T20 |  | Phase 7 review |
| T22 | todo | 8 |  | T18 |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  | T16 |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23, T10 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25, T11 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done
<!-- tickets:end -->

## Log

- 2026-10-26 16:32 orchestrator: T8 done (coordinator, T8.1-T8.10): readers on targets, budgeted sync, stale frames, call rows, purge deletes target; 4.4 on 5 copied sessions: diffs only planned.
- 2026-10-26 16:39 orchestrator: T9 changes: major wal-server.ts:365 stream stale set seeded from own sync (missed stale on reconnect), owner T8; 5 minor follow-ups. Left open for the VPS resume: reopen T8 with the finding, then re-run T9.
- 2026-10-26 17:01 planner: replan T8 stopped: see report (T8 closed, files set refused)
- 2026-10-26 17:15 planner: replan done: T8 files +scripts/session-view.ts, +web/src/components/EventRow.tsx
- 2026-10-26 17:15 orchestrator: T8 reopened for T9 rework (major + 4 follow-ups); old holder gone, fresh coordinator dispatched.
- 2026-10-26 17:25 orchestrator: T8 done (rework T8.11-T8.13): stream stale set starts empty + reconnect test; OF 'Tool call'; pipe required; EventRow tool label. Coordinator added web/src/lib/usage.test.ts to files.
- 2026-10-26 17:27 orchestrator: T9 done: Verdict approve after one fix round; verify 245 pass.
