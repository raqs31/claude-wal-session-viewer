# Board — WAL observer pipeline with token columns

change: wal-observer-pipeline · board: main · cap: 2000 tokens · history: wal.md

## Goal

Build plan.md phases 1-8: observer targets, readers on targets, token join, filter/order, web UI, README; test/check/lint/build/bench green.

## Facts

- Phases 1 to 7 closed. Phase 1: 516b183 (target format, append, tail reader, lock). Phase 2: bafbfc1 (observer ev, call, ck, resume, stale). Phase 3: d8689e0 (transcript pass, session view, golden test). Phase 4: 90f90bd (readers on targets, budgeted sync, stale frames). Phase 5: 5e1900b (observer lock, background loop, /observer, /rebuild, wal rebuild CLI). Phase 6: 083ea1e (token join in observer, parser reply data, index tok entries). Phase 7: d56004e, pushed (T18, T19, T20, T30, T31, T21 approve).
- Phase 5 detail: T10 cache lock or read-only, 1s/50ms loop, transcript bytes in progress. T11 wal rebuild CLI, exit 1 on held lock. T12 and T13 approved after fix rounds.
- T14: createParser returns replyInfo and toolInfo (transcripts.ts); prompted skips isMeta and isCompactSummary lines (transcripts.ts:237-238).
- T15: token join in observer.ts:699-766, tokens.test.ts 11 tests, manual check on a real session copy matched.
- T16: wal-index applies tok entries (out/res, hidden entries); Row out?/res? in shared/api.ts:73-76.
- T17 approved: 276 pass; join probe res 47467 confirmed.
- T18 done: min_tok/max_tok/notok filter, sort=tokens with 4-part cursor, tok res reset (wal-index.ts).
- T19 done: IndexEntry.target, event: tokens frames, held rows sent once matched, sort=tokens stream 400.
- T20 done: one sync deadline over transcripts and WAL, tick uses min(budget, SLICE_MS), bench build/token checks, RSS limit 600 MB (bench RSS 467 MB at T20, 494 MB at T21).
- T21 approved: 282 pass, bench pass (RSS 494 MB).
- T28 done: lineage best-of-3 at 5s bound; test-server kills its server on exit; live-tail open rejects on error.
- T29 done: WAL_NO_BUILD hold, purge gated on hold(), failed append stays building; 36 tests pass.
- T30 done: unjoinable calls and Stops drop at SessionEnd, transcripts re-read after SessionEnd, Stop text cut to LAST_TEXT; 55 tests.
- T31 done: /record 404 on hidden, sweep of orphan targets in held dirs (wal-server.ts), sweep skips dirs with failed readdir, locate() check before rm, 30 s trash recheck, held-row dedupe; 38 tests.
- Lock uses a hard link; release checks the pid.
- T5 files were widened to target.ts and session-view.ts(+test) by replan.
- T8 closed after rework T8.11-T8.13. T9 approved after one fix round.
- T8 owned the T4 follow-ups #2 (first sync ignores budgetMs) and the prototype-key lookup (wal-index.ts:169, shared/api.ts:27). The log does not say they were fixed.
- Nested agents list the spawner first (plan order), not readdir order.
- Open follow-up: T9 wal-server.ts:209-213 (empty-pick stream sync), replaced by the background loop from T10.
- Phase 8: T22, T23, T24, T26, T32 done. T32 holds the TokensFrame type, held-row dedupe via tok prior numbers, sweep tests; 'wal-trash' copied with a comment (no trash.ts edit). T24 browser checks 8.5-8.8 still open.
- Phase 8: T25 reworked after T27's first review (changes: major building % stuck at EventsTab.tsx:94); re-closed with buildingNote, read-only chip only with elsewhere>0, deferred late rows, ConfirmDialog countLabel.
- Phase 8: T27 review changed; its other browser checks 8.4-8.9 passed with 286 tests. T27 is blocked by T33 and must be re-run after T33.
- Phase 8: T33 (events head recorded count counts visible rows, not tok entries) is in flight. It fixes T25 minor 4.

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
- 2026-10-27 orchestrator: RSS: raise the bench server RSS limit from 300 MB to 600 MB; no memory work
- 2026-10-26 orchestrator: [auto] Transcript bytes stay in done/total (expected values at observer.test.ts:627, sessions.test.ts:168-169, query.test.ts:634); T17: isMeta and isCompactSummary user lines do not count as a user prompt for the interrupted-turn rule; unjoinable calls/Stops drop at session end (T30), with SessionEnd re-read as the fallback if a second transcript read per pass is unsafe; phase 7 follow-ups: T32 owns TokensFrame type, held-row dedupe via tok prior numbers, sweep tests; 'wal-trash' stays copied with a comment (no trash.ts edit).

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T15 done · T16 done · T17 done · T18 done · T19 done · T20 done · T21 done · T22 done · T23 done · T24 done · T25 done · T26 done · T27 done · T28 done · T29 done · T30 done · T31 done · T32 done · T33 done
<!-- tickets:end -->

## Log

- 2026-10-27 13:03 orchestrator: T33 done: FirstPage.recorded and event: recorded frame; useEvents recorded() sums visible rows
- 2026-10-27 13:08 orchestrator: T27 approve: 286 pass, badge fix confirmed in browser; 2 new T25 minors
- 2026-10-27 13:08 orchestrator: Phase 8 committed and pushed (6183b4d); T25 reopened for 2 T27 round-2 minors
- 2026-10-27 13:09 orchestrator: T25 round 2 done: pipeAt picks newest pipe, tokens patches apply to deferred rows
- 2026-10-27 13:10 orchestrator: T27 approve (round 2): 122 web tests pass; all phases closed
