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

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T18 | todo | 7 |  |  | risk-high | Token filter and Tokens order in the index |
| T19 | todo | 7 |  | T18 | risk-high | Stream tokens frames and held rows |
| T20 | todo | 7 |  | T18, T19 | tests | Bench: pipeline build and token queries |
| T21 (review) | todo | 7 |  | T18, T19, T20 |  | Phase 7 review |
| T22 | todo | 8 |  | T18 |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  |  |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T19, T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T15 done · T16 done · T17 done · T28 done · T29 done
<!-- tickets:end -->

## Log

- 2026-10-26 18:07 orchestrator: T29 done: WAL_NO_BUILD hold, purge gated on hold(), failed append stays building; 36 tests pass
- 2026-10-26 18:20 orchestrator: T15 done: token join in observer.ts:699-766, tokens.test.ts 11 tests, manual check on a real session copy matched
- 2026-10-26 18:23 orchestrator: T16 done: wal-index applies tok (out/res, hidden entries), Row out?/res? in shared/api.ts:73-76, query tests
- 2026-10-26 18:29 orchestrator: T17 changes: 1 major (T14 prompted flag on isMeta lines drops Skill res); T14 reopened; 5 minors to follow-ups
- 2026-10-26 18:30 orchestrator: T14 re-closed: prompted skips isMeta/isCompactSummary (transcripts.ts:237-238), 2 tests
- 2026-10-26 18:31 orchestrator: T17 approve: 276 pass; join probe res 47467 confirmed
