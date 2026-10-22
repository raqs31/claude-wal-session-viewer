# Board — Persist pick, sidebar trash, All/None/Not filters

change: wal-observer-pick-persist-trash-filter-negation · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-6 as written (pick persistence, Events filter All/None/Not + server _not params, sidebar chip All/None/Not, server trash, Trash UI, README + 0.4.0 bump); out of scope per plan's What We're NOT Doing.

## Facts

- Parallel workers share the Playwright browser; stop test servers by own PID, never pkill -f pattern (T22 killed T6's server).
- Phase 1 committed as c6c3d4c: pick persistence in web/src/lib/pick.ts (storedPick, effective; usePick persists wal.pick, tab sync, drop); Events filter Not and <field>_not params (T4, T5) landed.
- Phase 2 committed as 4f1ac6b: All/None/Not rows in the filter panel and README (T6); T23 landed in params.ts and params.test.ts (Not is cleared when a section empties).
- Phase 3 committed as dd1d03e: sidebar All/None/Not chips and ≠ summary (T8, T9); T16 ConfirmDialog on native <dialog> with typed-yes option; SessionMeta.busy, trash types, discovery find/drop, cache drop() (T10); splitBusy and summarizeResults with labels moved/live skipped/conflict/not found/failed (T15).
- Phase 4 committed as f9f5656: scripts/trash.ts with 3-step move and rollback, /trash routes and same-origin guard (T11); /trash dev proxy and README Trash section, 403 without Origin and move to wal-trash verified (T12); security review approved (T13); cleanup T24: streams notified on trash/restore, shared head reader, purge calls discovery.drop, README 405 and busy wording; 193 tests green (T14).
- Phase 5 is next: T17 is the next ready ticket. T16 and T15 are landed but were uncommitted at the Phase 4 commit.
- Manual 4.6 was checked on a temp HOME by transcript absence in projects/<slug>/; the user spot-checks a real claude --resume at the end.

## Decisions

- 2026-10-22 orchestrator: Scope: all 6 phases of plan.md as written.
- 2026-10-22 orchestrator: Manual verification items are done by agents via Playwright MCP against a server on a temp HOME; user spot-checks at the end.
- 2026-10-22 orchestrator: Commit per phase on branch wal-observer-pick-persist-trash-filter-negation, by the orchestrator after the phase review approves; agents never touch git state.
- 2026-10-22 orchestrator: Agents tick plan.md Progress checkboxes as verified items land (no sha; orchestrator adds sha at commit).
- 2026-10-22 orchestrator: [auto] Orchestrator ticks suite/types/lint Progress items (x.2-x.4, 6.1-6.2) at commit time from the phase review's Check output; 4.6 is checked by transcript absence (see Facts).
- 2026-10-22 orchestrator: [auto] T17 cite usePick.ts:9 to be re-pointed when T17 runs.
- 2026-10-22 orchestrator: User approved the 21-ticket split.
- 2026-10-22 orchestrator: User: Phase 1 follow-up (after drop the shown-pick ref keeps unlisted ids; a toggle in the same task writes them back, usePick.ts:38) folds into T17; README.md:111 rewrap deferred.
- 2026-10-22 orchestrator: User: fix all three T7 follow-ups in Phase 2 before commit (Not cleared when section empties, no data-not="0" in AgentPicker, README.md:130 rewrap).
- 2026-10-22 orchestrator: User: fix both T9 follow-ups (README.md:104 rewrap, sidebar.ts:5 comment) before the Phase 3 commit. [auto] Done by reopening T8 (both in its files) instead of a replan ticket.
- 2026-10-22 orchestrator: User: fix ALL review findings and follow-ups autonomously, scope-adding ones included; orchestrator routes each follow-up to its owner ticket (or a replan ticket) in the same phase and re-reviews before the commit. No triage questions.
- 2026-10-22 orchestrator: [auto] T24: restore fires the same stream notices; purge calls discovery.drop to clear the head cache (both planner-recommended; landed in Phase 4).
- 2026-10-22 orchestrator: [auto] T17 drop fix: shown ref = previously shown minus dropped ids (planner design) accepted.
- 2026-10-22 orchestrator: [auto] T17: when drop empties the stored pick, remove the wal.pick key (nothing stored -> newest, frozen) instead of saving []; matches plan's 'never all sessions' rule.
- 2026-10-22 orchestrator: [auto] T19 pick fix: use the reviewer's cross-tab design (stamp forget; un-gone an id once a /sessions list fetched after its forget lists it; drop adds moved ids to gone), widening files to useSessions.ts; also honour wal.pick key removal from other tabs.
- 2026-10-22 orchestrator: [auto] T27: empty result list reads '0 <label>' (e.g. 0 moved) instead of 'nothing to move'.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T19 (review) | todo | 5 | a977796b9fa487824 | T25, T26, T27 |  | Phase 5 review: trash UI |
| T20 | todo | 6 |  | T19 | docs, config | Release 0.4.0: version bump and README consistency pass |
| T21 (review) | todo | 6 |  | T20 |  | Phase 6 review: release 0.4.0 |
| T25 | todo | 5 |  |  | risk-high | Pick: revive restored ids, drop marks gone, honour wal.pick removal |
| T26 | todo | 5 |  |  |  | ConfirmDialog: key rows by index |
| T27 | todo | 5 |  | T25 | risk-high | Trash tab: empty only listed refs, refetch after sidebar moves, result labels |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T15 done · T16 done · T17 done · T18 done · T22 done · T23 done · T24 done
<!-- tickets:end -->

## Log

- 2026-10-22 14:40 planner: replan done: T17 (usePick.ts added to files, Goal and Context, cite re-pointed), T19 (files cover usePick.ts)
- 2026-10-22 14:48 orchestrator: T17 done: Delete picked / Delete N filtered + dialog; drop removes wal.pick when emptied; 5.1, 5.5, 5.6 pass
- 2026-10-22 14:56 orchestrator: T18 done: Trash tab (restore, delete forever, empty with typed yes), README; 5.7-5.9 pass light+dark; 3 follow-ups
- 2026-10-22 15:01 orchestrator: T19 changes: 3 major (gone never cleared after restore; Empty trash sends all:true; stale trash list) + 3 minor; replanning fixes
- 2026-10-22 15:03 planner: replan done: T25 (pick fix), T26 (dialog keys), T27 (trash tab fixes, after T25), T19 todo depends on them
- 2026-10-22 15:04 orchestrator: T26 done: ConfirmDialog rows keyed by index
- 2026-10-22 15:08 orchestrator: T25 done: gone ids revived by a later /sessions list (listedAt), drop marks gone, wal.pick removal adopted; 28 tests, 5.5/5.7/two-tab pass
- 2026-10-22 15:13 orchestrator: T27 done: Empty trash sends listed refs only, trash list refetches on sidebar move, restored/deleted labels; 5 browser checks pass
- 2026-10-22 15:14 orchestrator: T19 done: Phase 5 re-approved with T25-T27
