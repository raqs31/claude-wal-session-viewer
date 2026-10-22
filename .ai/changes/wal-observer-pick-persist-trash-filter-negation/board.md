# Board — Persist pick, sidebar trash, All/None/Not filters

change: wal-observer-pick-persist-trash-filter-negation · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-6 as written (pick persistence, Events filter All/None/Not + server _not params, sidebar chip All/None/Not, server trash, Trash UI, README + 0.4.0 bump); out of scope per plan's What We're NOT Doing.

## Facts

- Parallel workers share the Playwright browser; stop test servers by own PID, never pkill -f pattern (T22 killed T6's server).
- Phase 1 committed as c6c3d4c: pick persistence in web/src/lib/pick.ts (storedPick, effective; usePick persists wal.pick, tab sync, drop) with the T22 follow-ups folded in; Events filter Not and <field>_not params (T4, T5) landed.
- Phase 2 committed as 4f1ac6b: All/None/Not rows in the filter panel and README (T6), plus the T7 follow-ups and the empty-section Not clearing and pruneFilters fix (T23); T7 approved after T23 (test/check/lint green).
- T23 landed in params.ts and params.test.ts: Not is cleared when a section empties.
- Phase 3 is next: T8 in progress, review T9 waits on it. T10 waits for the Phase 3 commit (shares sidebar.test.ts with T8).

## Decisions

- 2026-10-22 orchestrator: Scope: all 6 phases of plan.md as written.
- 2026-10-22 orchestrator: Manual verification items are done by agents via Playwright MCP against a server on a temp HOME; user spot-checks at the end.
- 2026-10-22 orchestrator: Commit per phase on branch wal-observer-pick-persist-trash-filter-negation, by the orchestrator after the phase review approves; agents never touch git state.
- 2026-10-22 orchestrator: Agents tick plan.md Progress checkboxes as verified items land (no sha; orchestrator adds sha at commit).
- 2026-10-22 orchestrator: [auto] Orchestrator ticks suite/types/lint Progress items (x.2-x.4, 6.1-6.2) at commit time from the phase review's Check output.
- 2026-10-22 orchestrator: [auto] 4.6 checked on temp HOME by transcript absence in projects/<slug>/; user spot-checks real claude --resume at the end.
- 2026-10-22 orchestrator: [auto] Web test fixtures broken by SessionMeta.busy stay in T10; T15 worker picks unknown/failed summary labels and records them in its Result.
- 2026-10-22 orchestrator: [auto] T17 cite usePick.ts:9 to be re-pointed when T17 runs.
- 2026-10-22 orchestrator: User approved the 21-ticket split.
- 2026-10-22 orchestrator: User: Phase 1 follow-up (after drop the shown-pick ref keeps unlisted ids; a toggle in the same task writes them back, usePick.ts:38) folds into T17; README.md:111 rewrap deferred.
- 2026-10-22 orchestrator: User: fix all three T7 follow-ups in Phase 2 before commit (Not cleared when section empties, no data-not="0" in AgentPicker, README.md:130 rewrap).
- 2026-10-22 orchestrator: User: fix both T9 follow-ups (README.md:104 rewrap, sidebar.ts:5 comment) before the Phase 3 commit. [auto] Done by reopening T8 (both in its files) instead of a replan ticket.
- 2026-10-22 orchestrator: User: fix review follow-ups autonomously from now on; no triage questions. Orchestrator routes each minor follow-up to its owner ticket (or a replan ticket) in the same phase and re-reviews before the commit.
- 2026-10-22 orchestrator: User: fix ALL review findings and follow-ups autonomously, scope-adding ones included (supersedes the narrower line above).

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T9 (review) | todo | 3 |  |  |  | Phase 3 review: All / None / Not on the sidebar chips |
| T10 | todo | 4 |  |  | interface, risk-high | Trash groundwork: shared types, SessionMeta.busy, cache drops, discovery Found accessor |
| T11 | todo | 4 |  | T10 | security, risk-high | Trash module, trash/restore/purge routes and same-origin guard |
| T12 | todo | 4 |  | T11 | config, docs | Dev proxy for /trash and README trash docs; manual curl checks |
| T13 (review) | todo | 4 |  | T11 |  | Security review: trash routes and same-origin guard |
| T14 (review) | todo | 4 |  | T10, T11, T12, T13 |  | Phase 4 review: trash on the server |
| T15 | todo | 5 |  | T10 | interface | Trash client helpers: busy split and result summary |
| T16 | todo | 5 |  |  | interface | ConfirmDialog component on native dialog |
| T17 | todo | 5 |  | T11, T15, T16 | risk-high | Sidebar Delete picked / Delete N filtered actions |
| T18 | todo | 5 |  | T17 | risk-high | Trash tab: list, restore, delete forever, empty trash; README |
| T19 (review) | todo | 5 |  | T15, T16, T17, T18 |  | Phase 5 review: trash UI |
| T20 | todo | 6 |  | T19 | docs, config | Release 0.4.0: version bump and README consistency pass |
| T21 (review) | todo | 6 |  | T20 |  | Phase 6 review: release 0.4.0 |
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T8 done · T22 done · T23 done
<!-- tickets:end -->

## Log

- 2026-10-22 14:05 orchestrator: T8 done: sidebar chips All/None/Not, ≠ summary, README; 3.5-3.6 Playwright pass
- 2026-10-22 14:07 orchestrator: T9 done: Phase 3 approved
- 2026-10-22 14:08 orchestrator: T8 done again: README:104 rewrap, sidebar.ts comment
- 2026-10-22 14:09 orchestrator: T9 done: Phase 3 re-approved
