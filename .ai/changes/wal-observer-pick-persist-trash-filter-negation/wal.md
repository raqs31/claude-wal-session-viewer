# WAL — wal-observer-pick-persist-trash-filter-negation

Append-only: board.py compact appends each board here before compacting it. Never edit or delete an entry.

## 2026-10-22 13:43 · board.md · 1306 tokens · by compactor

~~~~markdown
# Board — Persist pick, sidebar trash, All/None/Not filters

change: wal-observer-pick-persist-trash-filter-negation · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-6 as written (pick persistence, Events filter All/None/Not + server _not params, sidebar chip All/None/Not, server trash, Trash UI, README + 0.4.0 bump); out of scope per plan's What We're NOT Doing.

## Facts

- Parallel workers share the Playwright browser; stop test servers by own PID, never pkill -f pattern (T22 killed T6's server).

## Decisions

- 2026-10-22 orchestrator: Scope: all 6 phases of plan.md as written.
- 2026-10-22 orchestrator: Manual verification items are done by agents via Playwright MCP against a server on a temp HOME; user spot-checks at the end.
- 2026-10-22 orchestrator: Commit per phase on branch wal-observer-pick-persist-trash-filter-negation, by the orchestrator after the phase review approves; agents never touch git state.
- 2026-10-22 orchestrator: Agents tick plan.md Progress checkboxes as verified items land (no sha; orchestrator adds sha at commit).
- 2026-10-22 orchestrator: [auto] Orchestrator ticks suite/types/lint Progress items (x.2-x.4, 6.1-6.2) at commit time from the phase review's Check output.
- 2026-10-22 orchestrator: [auto] 4.6 checked on temp HOME by transcript absence in projects/<slug>/; user spot-checks real claude --resume at the end.
- 2026-10-22 orchestrator: [auto] Web test fixtures broken by SessionMeta.busy stay in T10; T15 worker picks unknown/failed summary labels and records them in its Result.
- 2026-10-22 orchestrator: User approved the 21-ticket split.
- 2026-10-22 orchestrator: Phase 1 follow-ups: fix in Phase 1 the dead effective(null)/settlePick branch (T1 owner) and toggle/drop stale-closure ref (T2 owner); defer README.md:111 rewrap.
- 2026-10-22 orchestrator: [auto] Accepted follow-ups stay in Phase 1 (T22) per user; T17 cite usePick.ts:9 to be re-pointed when T17 runs.
- 2026-10-22 orchestrator: Phase 1 follow-up (drop leaves unlisted ids in shown ref; toggle in same task writes them back) folds into T17.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T7 (review) | in_progress | 2 | a765154a1a520fc7a |  |  | Phase 2 review: All / None / Not on the Events filter panel |
| T8 | todo | 3 |  |  |  | Sidebar chips All / None / Not: filter rule, controls, README |
| T9 (review) | todo | 3 |  | T8 |  | Phase 3 review: All / None / Not on the sidebar chips |
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
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T22 done
<!-- tickets:end -->

## Log

- 2026-10-22 12:57 planner: plan done: T1-T21 (work T1 T2 T4 T5 T6 T8 T10 T11 T12 T15 T16 T17 T18 T20; review T3 T7 T9 T13 T14 T19 T21)
- 2026-10-22 13:01 orchestrator: T1 done: storedPick + effective in web/src/lib/pick.ts, 11 tests
- 2026-10-22 13:06 orchestrator: T2 done: usePick persists wal.pick, tab sync, drop(); 1.5-1.8 passed in Playwright; README
- 2026-10-22 13:08 orchestrator: T3 changes: major in T2 (newest not frozen when nothing stored); reopening T2
- 2026-10-22 13:10 orchestrator: T2 done again: newest frozen for wanted===null; 1.5-1.8 re-run pass
- 2026-10-22 13:11 orchestrator: T3 done: Phase 1 approved
- 2026-10-22 13:33 orchestrator: T5 done: Filters.not, <field>_not params, ≠ summary, agents selectAll; 24 tests
- 2026-10-22 13:34 planner: replan done: T22 (new, phase 1), T3 (reopened todo, depends_on +T22)
- 2026-10-22 13:34 orchestrator: T4 done: matcher handles cat/tool/event/agent _not; 7 integration checks
- 2026-10-22 13:37 orchestrator: T22 done: settlePick folded into effective, toggle/drop via refs; Playwright A/B pass
- 2026-10-22 13:42 orchestrator: T3 done: Phase 1 re-approved with T22; T6 done: All/None/Not rows in filter panel, README, 2.6-2.10 Playwright pass
- 2026-10-22 13:42 orchestrator: Phase 1 committed c6c3d4c; 1.4 to tick at Phase 2 commit (lint red only on T6 styles.css)
~~~~

## 2026-10-22 14:03 · board.md · 1363 tokens · by compactor

~~~~markdown
# Board — Persist pick, sidebar trash, All/None/Not filters

change: wal-observer-pick-persist-trash-filter-negation · board: main · cap: 2000 tokens · history: wal.md

## Goal

Implement plan.md phases 1-6 as written (pick persistence, Events filter All/None/Not + server _not params, sidebar chip All/None/Not, server trash, Trash UI, README + 0.4.0 bump); out of scope per plan's What We're NOT Doing.

## Facts

- Parallel workers share the Playwright browser; stop test servers by own PID, never pkill -f pattern (T22 killed T6's server).
- Phase 1 committed as c6c3d4c: pick persistence in web/src/lib/pick.ts (storedPick, effective; usePick persists wal.pick, tab sync, drop) with the T22 follow-ups folded in; Events filter Not and <field>_not params (T4, T5) landed.
- Phase 2 (T6: All/None/Not rows in the filter panel, README) is done; its review T7 is in flight.
- Lint is red only on T6's styles.css; plan.md Progress item 1.4 is to be ticked at the Phase 2 commit.

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
- 2026-10-22 orchestrator: [auto] T23 also clears Not when pruneFilters empties a section (same bug class as the accepted follow-up): params.ts + params.test.ts join T23.

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T8 | in_progress | 3 | ae7e18c9cf2f57ae9 |  |  | Sidebar chips All / None / Not: filter rule, controls, README |
| T9 (review) | todo | 3 |  | T8 |  | Phase 3 review: All / None / Not on the sidebar chips |
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
Closed: T1 done · T2 done · T3 done · T4 done · T5 done · T6 done · T7 done · T22 done · T23 done
<!-- tickets:end -->

## Log

- 2026-10-22 13:44 orchestrator: T7 changes: lint red on 3 Phase 2 lines (T4, T5, T6); reopening owners
- 2026-10-22 13:45 orchestrator: T5 done again: agents.test.ts formatted
- 2026-10-22 13:45 orchestrator: T4 done again: live-tail.test.ts formatted
- 2026-10-22 13:45 orchestrator: T6 done again: data-not rule moved below .atree .ls
- 2026-10-22 13:55 orchestrator: T7 done: Phase 2 approved (test/check/lint green)
- 2026-10-22 13:56 planner: replan done: T23 (new, Phase 2 cleanup), T7 (reopened, depends on T23), T8 (depends_on T6 -> T7)
- 2026-10-22 13:57 planner: replan done: T23 (pruneFilters path folded in, params.ts and params.test.ts added), T7 (files already cover them)
- 2026-10-22 14:02 orchestrator: T23 done: Not cleared when a section empties (untick + pruneFilters), no data-not=0, README rewrap; Playwright pass
- 2026-10-22 14:03 orchestrator: T7 done: Phase 2 re-approved with T23
- 2026-10-22 14:03 orchestrator: Phase 2 committed 4f1ac6b; T10 waits for Phase 3 commit (shares sidebar.test.ts with T8)
~~~~
