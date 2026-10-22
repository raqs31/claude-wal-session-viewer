# Board — Persist pick, sidebar trash, All/None/Not filters

change: wal-observer-pick-persist-trash-filter-negation · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-6 as written (pick persistence, Events filter All/None/Not + server _not params, sidebar chip All/None/Not, server trash, Trash UI, README + 0.4.0 bump); out of scope per plan's What We're NOT Doing.

## Facts

- Parallel workers share the Playwright browser; stop test servers by own PID, never pkill -f pattern (T22 killed T6's server).
- Phase 1 committed as c6c3d4c: pick persistence in web/src/lib/pick.ts (storedPick, effective; usePick persists wal.pick, tab sync, drop); Events filter Not and <field>_not params (T4, T5); T23 params tests.
- Phase 2 committed as 4f1ac6b: All/None/Not rows in the filter panel and README (T6); T7 follow-ups fixed: Not cleared when a section empties, no data-not="0" in AgentPicker, README rewrap at README.md:130.
- Phase 3 committed as dd1d03e: sidebar All/None/Not chips and ≠ summary (T8, T9); T9 follow-ups fixed by reopening T8 (README.md:104 rewrap, sidebar.ts:5 comment); T16 ConfirmDialog on native <dialog> with typed-yes option; SessionMeta.busy, trash types, discovery find/drop, cache drop() (T10); splitBusy and summarizeResults with labels moved/live skipped/conflict/not found/failed (T15).
- Phase 4 committed as f9f5656: scripts/trash.ts with 3-step move and rollback, /trash routes and same-origin guard (T11); /trash dev proxy and README Trash section, 403 without Origin, move to wal-trash verified (T12); security review approved (T13); T24 cleanup: restore fires the same stream notices, shared head reader, purge calls discovery.drop, README 405 and busy wording; 193 tests green (T14).
- Phase 5 committed as 76edf69: sidebar Delete picked / Delete N filtered with dialog (T17); Trash tab with restore, delete forever, empty with typed yes, README (T18); cross-tab pick fix (T25); ConfirmDialog rows keyed by index (T26); trash tab fixes (T27); T19 review approved.
- Landed behaviour: a drop that empties the stored pick removes wal.pick (nothing stored means newest, frozen), never saves []; the shown ref is the previously shown minus dropped ids; a gone id is revived by a later /sessions list (listedAt); restore fires the same stream notices; purge calls discovery.drop; Empty trash sends listed refs only; the trash list refetches on sidebar move; an empty result list reads '0 <label>' (e.g. 0 moved).
- Phase 6 is the only open work: T20 (release 0.4.0 version bump and README consistency, in progress) and T21 (phase review, todo).
- Manual 4.6 was checked on a temp HOME by transcript absence in projects/<slug>/; the user spot-checks a real claude --resume at the end.

## Decisions

- 2026-10-22 orchestrator: Scope: all 6 phases of plan.md as written.
- 2026-10-22 orchestrator: Manual verification items are done by agents via Playwright MCP against a server on a temp HOME; user spot-checks at the end.
- 2026-10-22 orchestrator: Commit per phase on branch wal-observer-pick-persist-trash-filter-negation, by the orchestrator after the phase review approves; agents never touch git state.
- 2026-10-22 orchestrator: Agents tick plan.md Progress checkboxes as verified items land (no sha; orchestrator adds sha at commit).
- 2026-10-22 orchestrator: [auto] Orchestrator ticks suite/types/lint Progress items (x.2-x.4, 6.1-6.2) at commit time from the phase review's Check output; 4.6 is checked by transcript absence (see Facts).
- 2026-10-22 orchestrator: User approved the 21-ticket split.
- 2026-10-22 orchestrator: User: README.md:111 rewrap deferred.
- 2026-10-22 orchestrator: User: fix ALL review findings and follow-ups autonomously, scope-adding ones included; orchestrator routes each follow-up to its owner ticket (or a replan ticket) in the same phase and re-reviews before the commit. No triage questions.
- 2026-10-22 orchestrator: [auto] T21 README wrap follow-up fixed in T20; the earlier deferred README.md:111 rewrap is folded in under the later fix-all decision.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T9 done · T10 done · T11 done · T12 done · T13 done · T14 done · T15 done · T16 done · T17 done · T18 done · T19 done · T20 done · T21 done · T22 done · T23 done · T24 done · T25 done · T26 done · T27 done
<!-- tickets:end -->

## Log

- 2026-10-22 15:15 orchestrator: T20 done: version 0.4.0, README pass (2 fixes), build:dist ok
- 2026-10-22 15:18 orchestrator: T21 done: approve; 1 minor (README lines over 100 cols) -> reopening T20
- 2026-10-22 15:18 orchestrator: T20 done again: README rewrapped to <=100 cols, wording unchanged
- 2026-10-22 15:19 orchestrator: T21 done: Phase 6 approved; final npm test/check/lint/build:dist all exit 0
