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

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T13 (review) | todo | 5 |  |  |  | Phase 5 review |
| T14 | todo | 6 |  |  |  | Parser data for the token join |
| T15 | todo | 6 |  | T14 | risk-high | Token join in the observer |
| T16 | todo | 6 |  | T15 | interface | Index applies tok entries to rows |
| T17 (review) | todo | 6 |  | T14, T15, T16 |  | Phase 6 review |
| T18 | todo | 7 |  | T16 | risk-high | Token filter and Tokens order in the index |
| T19 | todo | 7 |  | T18 | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T18 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T18, T19, T20 |  | Phase 7 review |
| T22 | todo | 8 |  | T18 |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  | T16 |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T28 done
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
