# WAL — wal-observer-pipeline

Append-only: board.py compact appends each board here before compacting it. Never edit or delete an entry.

## 2026-10-26 15:07 · board.md · 1010 tokens · by compactor

~~~~markdown
# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: [auto] T2 follow-ups: fix all four in T1 before the phase 1 commit.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T3 | in_progress | 2 | a4c44ce06a68915f5 |  | risk-high | Observer: WAL to target |
| T4 (review) | todo | 2 |  | T3 |  | Phase 2 review |
| T5 | todo | 3 |  | T3 | risk-high | Observer: transcript pass and no-WAL rows |
| T6 | todo | 3 |  | T5 | risk-high | Target-based session views and golden test |
| T7 (review) | todo | 3 |  | T5, T6 |  | Phase 3 review |
| T8 | todo | 4 |  | T5, T6 | coupled, risk-high | Readers switch to targets |
| T9 (review) | todo | 4 |  | T8 |  | Phase 4 review |
| T10 | todo | 5 |  | T8 | interface, security, risk-high | Server lock, background loop, /observer and /rebuild |
| T11 | todo | 5 |  | T10 |  | CLI wal rebuild |
| T12 (review) | todo | 5 |  | T10 |  | Security review: T10 /rebuild and lock |
| T13 (review) | todo | 5 |  | T10, T11, T12 |  | Phase 5 review |
| T14 | todo | 6 |  | T5 |  | Parser data for the token join |
| T15 | todo | 6 |  | T14, T10, T11 | risk-high | Token join in the observer |
| T16 | todo | 6 |  | T15 | interface | Index applies tok entries to rows |
| T17 (review) | todo | 6 |  | T14, T15, T16 |  | Phase 6 review |
| T18 | todo | 7 |  | T16 | risk-high | Token filter and Tokens order in the index |
| T19 | todo | 7 |  | T18 | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T18, T10 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T18, T19, T20 |  | Phase 7 review |
| T22 | todo | 8 |  | T18 |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  | T16, T8 |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23, T10 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25, T11 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done
<!-- tickets:end -->

## Log

- 2026-10-26 14:52 planner: plan done: T1-T27 (8 phases, 19 work, 8 phase reviews, 1 security review T12; T8 coupled)
- 2026-10-26 15:00 orchestrator: T1 done: scripts/target.ts + 9 tests; check, lint green.
- 2026-10-26 15:04 orchestrator: T2 approve: 4 minor follow-ups on T1 (lock race, releaseLock pid, ev rec/raw type, reader buffer); fixing per memory rule.
- 2026-10-26 15:05 orchestrator: T1 done again: T2 follow-ups fixed (hard-link lock, pid-checked release, ev union, carry copy); 10 tests.
- 2026-10-26 15:06 orchestrator: Phase 1 closed: T2 approve after fixes; committed 516b183.
~~~~

## 2026-10-26 15:25 · board.md · 1112 tokens · by compactor

~~~~markdown
# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phase 1 closed and committed as 516b183 on wal-observer-pipeline: scripts/target.ts, observer target format, append, tail reader, lock; 10 tests.
- Lock uses a hard link; release checks the pid.
- Phase 2 is next: T3 in progress, T4 review waits on it.

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: [auto] T4 follow-ups 1,3,4,5,6 fixed in T3 now; #2 (first sync ignores budgetMs) and T3's prototype-key lookup follow-up (wal-index.ts:169, shared/api.ts:27) go to T8, which owns budgeted sync and those files.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T5 | in_progress | 3 | a968b893f03ef5d71 |  | risk-high | Observer: transcript pass and no-WAL rows |
| T6 | todo | 3 |  | T5 | risk-high | Target-based session views and golden test |
| T7 (review) | todo | 3 |  | T5, T6 |  | Phase 3 review |
| T8 | todo | 4 |  | T5, T6 | coupled, risk-high | Readers switch to targets |
| T9 (review) | todo | 4 |  | T8 |  | Phase 4 review |
| T10 | todo | 5 |  | T8 | interface, security, risk-high | Server lock, background loop, /observer and /rebuild |
| T11 | todo | 5 |  | T10 |  | CLI wal rebuild |
| T12 (review) | todo | 5 |  | T10 |  | Security review: T10 /rebuild and lock |
| T13 (review) | todo | 5 |  | T10, T11, T12 |  | Phase 5 review |
| T14 | todo | 6 |  | T5 |  | Parser data for the token join |
| T15 | todo | 6 |  | T14, T10, T11 | risk-high | Token join in the observer |
| T16 | todo | 6 |  | T15 | interface | Index applies tok entries to rows |
| T17 (review) | todo | 6 |  | T14, T15, T16 |  | Phase 6 review |
| T18 | todo | 7 |  | T16 | risk-high | Token filter and Tokens order in the index |
| T19 | todo | 7 |  | T18 | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T18, T10 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T18, T19, T20 |  | Phase 7 review |
| T22 | todo | 8 |  | T18 |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  | T16, T8 |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23, T10 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25, T11 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done · T3 done · T4 done
<!-- tickets:end -->

## Log

- 2026-10-26 15:14 orchestrator: T3 done: scripts/observer.ts (ev, call, ck, resume, stale) + 10 tests; 1 follow-up (prototype-key lookup in wal-index/api).
- 2026-10-26 15:18 orchestrator: T4 approve: 6 minor follow-ups on T3; fixing now.
- 2026-10-26 15:20 orchestrator: T3 done again: T4 follow-ups 1,3,4,5,6 fixed; 14 tests.
- 2026-10-26 15:22 orchestrator: T4 changes: cap on called set re-writes call rows on restart (observer.ts:181-184); T3 reopened, last fix round.
- 2026-10-26 15:24 orchestrator: T3 done again: replay returns before touching called; regression test fails on old code, 15 tests.
- 2026-10-26 15:25 orchestrator: Phase 2 closed: T4 approve after 2 fix rounds; committed bafbfc1.
~~~~

## 2026-10-26 15:49 · board.md · 1174 tokens · by compactor

~~~~markdown
# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phases 1 and 2 closed. Phase 1: 516b183 (scripts/target.ts, observer target format, append, tail reader, lock; 10 tests). Phase 2: bafbfc1 (scripts/observer.ts ev, call, ck, resume, stale; 15 tests).
- Lock uses a hard link; release checks the pid.
- Phase 3 is next: T5 in progress; T6 and T7 wait on it.

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: [auto] Open T4 follow-ups go to T8, which owns budgeted sync and those files: #2 (first sync ignores budgetMs) and the prototype-key lookup (wal-index.ts:169, shared/api.ts:27).
- 2026-10-26 orchestrator: [auto] T5 follow-ups (read-only no-WAL stale; transcript bytes in progress) go to T10.
- 2026-10-26 orchestrator: [auto] Nested agents list spawner first (plan order), not readdir order; T8 states it and 4.4 expects it.
- 2026-10-26 orchestrator: [auto] T5 replan accepted: files widened to target.ts, session-view.ts(+test); resume same worker.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T8 | in_progress | 4 | a2837158b40d9eb61 |  | coupled, risk-high | Readers switch to targets |
| T9 (review) | todo | 4 |  | T8 |  | Phase 4 review |
| T10 | todo | 5 |  | T8 | interface, security, risk-high | Server lock, background loop, /observer and /rebuild |
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
| T23 | todo | 8 |  | T16, T8 |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23, T10 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25, T11 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done
<!-- tickets:end -->

## Log

- 2026-10-26 15:36 orchestrator: T5 done: transcript pass, no-WAL call/turn rows, stats records; 18 tests.
- 2026-10-26 15:39 orchestrator: T6 done: scripts/session-view.ts + golden test (6 pass); 1 follow-up (nested agent order).
- 2026-10-26 15:44 orchestrator: T7 approve: 2 minor on T5 (parser.touched never cleared; null cost not written), 1 on T6 (agent order).
- 2026-10-26 15:45 orchestrator: T5 blocked: touched.clear fixed; null cost needs target.ts:70 and session-view.ts:45 (outside files). Replan.
- 2026-10-26 15:46 planner: replan done: T5
- 2026-10-26 15:48 orchestrator: T5 done again: touched.clear + null cost (target.ts, session-view.ts); 37 tests.
- 2026-10-26 15:49 orchestrator: Phase 3 closed: T7 approve after fixes; committed d8689e0.
~~~~

## 2026-10-26 17:29 · board.md · 1462 tokens · by compactor

~~~~markdown
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
- 2026-10-26 orchestrator: [auto] Phase 4 follow-ups: T8.4 lineage bound + orphan test server go to new T28 (phase 5); purge-target test already in trash.test.ts:287,298.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T10 | todo | 5 |  |  | interface, security, risk-high | Server lock, background loop, /observer and /rebuild |
| T11 | todo | 5 |  | T10 |  | CLI wal rebuild |
| T12 (review) | todo | 5 |  | T10 |  | Security review: T10 /rebuild and lock |
| T13 (review) | todo | 5 |  | T10, T11, T12, T28 |  | Phase 5 review |
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
| T28 | todo | 5 |  |  | tests | Test robustness: load-proof lineage bound, no orphaned test servers |
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
- 2026-10-26 17:29 planner: replan done: T28 (new, T8.4 follow-ups), T13 extended
~~~~

## 2026-10-26 18:03 · board.md · 1594 tokens · by compactor

~~~~markdown
# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phases 1 to 4 closed. Phase 1: 516b183 (target format, append, tail reader, lock). Phase 2: bafbfc1 (observer ev, call, ck, resume, stale). Phase 3: d8689e0 (transcript pass, session view, golden test). Phase 4: 90f90bd (readers on targets, budgeted sync, stale frames).
- Lock uses a hard link; release checks the pid.
- T5 files were widened to target.ts and session-view.ts(+test) by replan.
- T8 closed after rework T8.11-T8.13: stream stale set starts empty, reconnect test, OF 'Tool call', pipe required, EventRow tool label. T9 approved after one fix round; verify 245 pass.
- T8 owned the T4 follow-ups #2 (first sync ignores budgetMs) and the prototype-key lookup (wal-index.ts:169, shared/api.ts:27). The log does not say they were fixed.
- Nested agents list the spawner first (plan order), not readdir order. T8 states it; 4.4 expects it.
- Open, owner T10: T5 follow-ups (read-only no-WAL stale; transcript bytes in progress) and T9 follow-up wal-server.ts:209-213 (empty-pick stream sync), replaced by its background loop.
- Open, owner T28: T8.4 lineage bound and orphan test server. Purge-target test already in trash.test.ts:287,298.
- Phase 5 is next: T10 and T28 are ready.

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut; T28 added by replan.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: Resume session: scope phases 4-8 to the end; recorded decisions stay in force; T9 minor follow-ups fixed in phase 4.
- 2026-10-26 orchestrator: [auto] T10: keep transcript bytes in done/total (T5 follow-up routed to T10); update expected values in observer.test.ts:627, sessions.test.ts:168-169, query.test.ts:634.
- 2026-10-26 orchestrator: [auto] T13: transcript read budget (50 ms slice Decision) deferred to Phase 7 T20 with the bench limits, as the reviewer recommends.
- 2026-10-26 orchestrator: [auto] Phase 5 follow-ups: test loop hold, purge lock, failed append -> new T29 (phase 6); empty-pick tick budget -> T20.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T15 | todo | 6 |  | T29 | risk-high | Token join in the observer |
| T16 | todo | 6 |  | T15 | interface | Index applies tok entries to rows |
| T17 (review) | todo | 6 |  | T15, T16, T29 |  | Phase 6 review |
| T18 | todo | 7 |  | T16 | risk-high | Token filter and Tokens order in the index |
| T19 | todo | 7 |  | T18 | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T18, T19 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T18, T19, T20 |  | Phase 7 review |
| T22 | todo | 8 |  | T18 |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  | T16 |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
| T29 | in_progress | 6 | add8f23da3b4e6cc7 |  | tests | Phase 5 follow-ups: test hold for the build loop, purge lock, failed append |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T28 done
<!-- tickets:end -->

## Log

- 2026-10-26 17:30 orchestrator: T28 done: lineage best-of-3 at 5s bound; test-server kills its server on exit; live-tail open rejects on error.
- 2026-10-26 17:40 planner: replan done: T10 files and verify extended (observer, sessions, query tests), T13 files extended
- 2026-10-26 17:41 orchestrator: T10 done: cache lock or read-only, 1s/50ms background loop, /observer, /rebuild (validId, 403 cross-site, 409 read-only); transcript bytes in progress; 27 tests.
- 2026-10-26 17:43 orchestrator: T11 done: wal rebuild CLI (runRebuild in observer.ts, cli.ts case, README usage); exit 1 on held lock; 7 tests.
- 2026-10-26 17:44 orchestrator: T12 changes: major lock bypass for later-discovered sources (owner T10); minor rebuild drops target with missing WAL. T10 reopened.
- 2026-10-26 17:48 orchestrator: T10 done (T12 fix round): per-dir lock before first write, skip unlockable dirs, owner only with a lock; rebuild keeps target if WAL missing; 32 tests.
- 2026-10-26 17:49 orchestrator: T12 done: approve after one fix round; purge-without-lock classed minor (safe, sources gone).
- 2026-10-26 17:53 orchestrator: T13 changes: major torn-tail never built (T10) + 2 T10 minors, 1 T11 minor; T10 and T11 reopened.
- 2026-10-26 17:57 orchestrator: T10 done (T13 round): built(id) treats torn tails as caught up; ObserverStatus.elsewhere; lock errors logged once per dir; 33 tests.
- 2026-10-26 17:58 orchestrator: T11 done (T13 round): unknown options exit 2 with usage; 12 tests.
- 2026-10-26 17:59 orchestrator: T13 done: Phase 5 approve after one fix round; 257 pass.
- 2026-10-26 18:01 planner: replan done: T29 new (phase 6), T15, T17, T20, T21 changed
- 2026-10-26 18:03 orchestrator: T14 done: createParser returns replyInfo and toolInfo (transcripts.ts:47-60,140-295), 4 tests
~~~~

## 2026-10-26 19:28 · board.md · 1524 tokens · by compactor

~~~~markdown
# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phases 1 to 5 closed. Phase 1: 516b183 (target format, append, tail reader, lock). Phase 2: bafbfc1 (observer ev, call, ck, resume, stale). Phase 3: d8689e0 (transcript pass, session view, golden test). Phase 4: 90f90bd (readers on targets, budgeted sync, stale frames). Phase 5: 5e1900b (observer lock, background loop, /observer, /rebuild, wal rebuild CLI).
- Phase 5 detail: T10 cache lock or read-only, 1s/50ms loop, transcript bytes in progress (T5 follow-up). T11 wal rebuild CLI, exit 1 on held lock. T12 and T13 approved after fix rounds; 257 pass.
- T14 done: createParser returns replyInfo and toolInfo (transcripts.ts), 4 tests.
- Lock uses a hard link; release checks the pid.
- T5 files were widened to target.ts and session-view.ts(+test) by replan.
- T8 closed after rework T8.11-T8.13. T9 approved after one fix round.
- T8 owned the T4 follow-ups #2 (first sync ignores budgetMs) and the prototype-key lookup (wal-index.ts:169, shared/api.ts:27). The log does not say they were fixed.
- Nested agents list the spawner first (plan order), not readdir order. T8 states it; 4.4 expects it.
- Open follow-up: T9 wal-server.ts:209-213 (empty-pick stream sync), replaced by the background loop from T10.
- Open, owner T28 done: lineage best-of-3 at 5s bound; test-server kills its server on exit; live-tail open rejects on error.
- Open, owner T29: phase 5 follow-ups (test hold for the build loop, purge lock, failed append). T20 owns the empty-pick tick budget.
- Phase 6 is in progress: T29 in flight; T15, T16, T17 wait on it.

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut; T28 added by replan.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: Resume session: scope phases 4-8 to the end; recorded decisions stay in force; T9 minor follow-ups fixed in phase 4.
- 2026-10-26 orchestrator: [auto] Transcript bytes stay in done/total; expected values update at observer.test.ts:627, sessions.test.ts:168-169, query.test.ts:634 (T10, done). Transcript read budget (50 ms slice) deferred to T20 with the bench limits. Phase 5 follow-ups: test hold, purge lock, failed append to T29; empty-pick tick budget to T20.
- 2026-10-26 orchestrator: [auto] T17: isMeta and isCompactSummary user lines do not count as a user prompt for the interrupted-turn rule
- 2026-10-26 orchestrator: [auto] Phase 6 follow-ups: unjoinable calls/Stops drop at session end (T30); if a second transcript read per pass is unsafe, SessionEnd waits for the next join
- 2026-10-26 orchestrator: T31: delete every orphan target (no discovered session, not in trash), hand-deleted sessions included

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T19 | in_progress | 7 |  |  | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T19, T31 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T19, T20, T31 |  | Phase 7 review |
| T22 | todo | 8 |  |  |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  |  |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
| T31 | todo | 7 |  | T19 | tests | Phase 6 follow-ups: /record hidden entries, orphan targets, root test guard |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T15 done · T16 done · T17 done · T18 done · T28 done · T29 done · T30 done
<!-- tickets:end -->

## Log

- 2026-10-26 18:07 orchestrator: T29 done: WAL_NO_BUILD hold, purge gated on hold(), failed append stays building; 36 tests pass
- 2026-10-26 18:20 orchestrator: T15 done: token join in observer.ts:699-766, tokens.test.ts 11 tests, manual check on a real session copy matched
- 2026-10-26 18:23 orchestrator: T16 done: wal-index applies tok (out/res, hidden entries), Row out?/res? in shared/api.ts:73-76, query tests
- 2026-10-26 18:29 orchestrator: T17 changes: 1 major (T14 prompted flag on isMeta lines drops Skill res); T14 reopened; 5 minors to follow-ups
- 2026-10-26 18:30 orchestrator: T14 re-closed: prompted skips isMeta/isCompactSummary (transcripts.ts:237-238), 2 tests
- 2026-10-26 18:31 orchestrator: T17 approve: 276 pass; join probe res 47467 confirmed
- 2026-10-26 18:35 planner: replan done: T18, T20, T21, T30, T31
- 2026-10-26 19:27 orchestrator: T30 done: drop unjoinable at SessionEnd, re-read transcripts after SessionEnd, Stop text cut to LAST_TEXT; 55 tests
- 2026-10-26 19:27 orchestrator: T18 done: min_tok/max_tok/notok filter, sort=tokens with 4-part cursor, tok res reset (wal-index.ts)
~~~~
