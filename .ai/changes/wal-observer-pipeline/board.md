# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phases 1 to 6 closed. Phase 1: 516b183 (target format, append, tail reader, lock). Phase 2: bafbfc1 (observer ev, call, ck, resume, stale). Phase 3: d8689e0 (transcript pass, session view, golden test). Phase 4: 90f90bd (readers on targets, budgeted sync, stale frames). Phase 5: 5e1900b (observer lock, background loop, /observer, /rebuild, wal rebuild CLI). Phase 6: 083ea1e (token join in observer, parser reply data, index tok entries; T14, T15, T16, T29, T17 approve).
- Phase 5 detail: T10 cache lock or read-only, 1s/50ms loop, transcript bytes in progress. T11 wal rebuild CLI, exit 1 on held lock. T12 and T13 approved after fix rounds.
- T14: createParser returns replyInfo and toolInfo (transcripts.ts); prompted skips isMeta and isCompactSummary lines (transcripts.ts:237-238).
- T15: token join in observer.ts:699-766, tokens.test.ts 11 tests, manual check on a real session copy matched.
- T16: wal-index applies tok entries (out/res, hidden entries); Row out?/res? in shared/api.ts:73-76.
- T17 approved: 276 pass; join probe res 47467 confirmed.
- T18 done: min_tok/max_tok/notok filter, sort=tokens with 4-part cursor, tok res reset (wal-index.ts).
- T29 done: WAL_NO_BUILD hold, purge gated on hold(), failed append stays building; 36 tests pass.
- T30 done: unjoinable calls and Stops drop at SessionEnd, transcripts re-read after SessionEnd, Stop text cut to LAST_TEXT; 55 tests.
- T28 done: lineage best-of-3 at 5s bound; test-server kills its server on exit; live-tail open rejects on error.
- Lock uses a hard link; release checks the pid.
- T5 files were widened to target.ts and session-view.ts(+test) by replan.
- T8 closed after rework T8.11-T8.13. T9 approved after one fix round.
- T8 owned the T4 follow-ups #2 (first sync ignores budgetMs) and the prototype-key lookup (wal-index.ts:169, shared/api.ts:27). The log does not say they were fixed.
- Nested agents list the spawner first (plan order), not readdir order.
- Open follow-up: T9 wal-server.ts:209-213 (empty-pick stream sync), replaced by the background loop from T10.
- Open follow-up: T20 owns the empty-pick tick budget and the transcript read budget (50 ms slice) with the bench limits.
- Phase 7 open: T19 in progress; T20, T21, T31 todo. Phase 8 (T22 to T27) todo.

## Decisions

- 2026-10-26 orchestrator: Scope: all 8 phases of plan.md; out of scope as plan.md lists (discovery, trash, wal legacy, hook, version bump).
- 2026-10-26 orchestrator: Commits: branch wal-observer-pipeline from main; orchestrator commits each phase after its review approves.
- 2026-10-26 orchestrator: Manual checks (4.4, 6.4, 8.4-8.8): agents try on real data (scripts or Playwright); user confirms what remains at the end.
- 2026-10-26 orchestrator: Review findings and follow-ups: fix all without asking (memory orchestrate.md).
- 2026-10-26 orchestrator: Tickets T1-T27 accepted as cut; T28 added by replan.
- 2026-10-26 orchestrator: Manual checks run on copies of real sessions in a temp HOME only; real ~/.claude and live-session checks are user items.
- 2026-10-26 orchestrator: T8 stays coupled. Purge deletes the target, detected in wal-server.ts; ask before any trash.ts edit.
- 2026-10-26 orchestrator: Resume session: scope phases 4-8 to the end; recorded decisions stay in force; T9 minor follow-ups fixed in phase 4.
- 2026-10-26 orchestrator: T31: delete every orphan target (no discovered session, not in trash), hand-deleted sessions included.
- 2026-10-26 orchestrator: [auto] Transcript bytes stay in done/total, expected values updated at observer.test.ts:627, sessions.test.ts:168-169, query.test.ts:634; T17: isMeta and isCompactSummary user lines do not count as a user prompt for the interrupted-turn rule; unjoinable calls/Stops drop at session end (T30), with SessionEnd re-read as the fallback if a second transcript read per pass is unsafe.
- 2026-10-27 orchestrator: RSS: raise the bench server RSS limit from 300 MB to 600 MB; no memory work

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T22 | todo | 8 |  |  |  | Web: Tokens filter params and panel |
| T23 | todo | 8 |  |  |  | Web: Output, Result, Total columns and call row detail |
| T24 | todo | 8 |  | T22, T23 | risk-high | Web: Order Time/Tokens, tokens frames, late rows |
| T25 | todo | 8 |  | T24, T23 |  | Web: pipeline chip, building note, stale badge and Rebuild |
| T26 | todo | 8 |  | T25 | docs | README: Pipeline section and token features |
| T27 (review) | todo | 8 |  | T22, T23, T24, T25, T26 |  | Phase 8 review |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T15 done · T16 done · T17 done · T18 done · T19 done · T20 done · T21 done · T28 done · T29 done · T30 done · T31 done
<!-- tickets:end -->

## Log

- 2026-10-26 19:29 orchestrator: T19 blocked: tok entry has no link to its row; needs IndexEntry.target in wal-index.ts (outside files); replan
- 2026-10-26 19:30 planner: replan done: T19 (wal-index.ts added to files, query.test.ts in verify, status todo)
- 2026-10-26 19:37 orchestrator: T19 done: IndexEntry.target, event: tokens frames, held rows sent once matched, sort=tokens stream 400
- 2026-10-26 19:42 orchestrator: T31 done: /record 404 on hidden, sweep of orphan targets in held dirs (wal-server.ts:309-334), root skip guard; 37 tests
- 2026-10-27 12:08 orchestrator: T20 blocked on RSS 503 MB vs 300 MB; user: raise limit to 600 MB; T20 resumed
- 2026-10-27 12:09 orchestrator: T20 done: one sync deadline over transcripts+WAL, tick uses min(budget, SLICE_MS), bench build/token checks, RSS limit 600 MB (467 MB)
- 2026-10-27 12:16 orchestrator: T21 changes: major T31 sweep fails open on short discovery/trash lists; T31 reopened with 2 minors
- 2026-10-27 12:19 orchestrator: T31 re-closed: sweep skips dirs with failed readdir, locate() check before rm, 30 s trash recheck, held-row dedupe; 38 tests
- 2026-10-27 12:21 orchestrator: T21 approve: 282 pass, bench pass (RSS 494 MB)
