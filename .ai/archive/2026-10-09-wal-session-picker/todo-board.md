# Todo board — WAL viewer: session picker redesign + selection-scoped filters

Scope: fix the agent chips listing agents from sessions that aren't selected and make every filter scoped to the selected sessions, reloading when the selection changes (empty selection = all sessions); fix unpredictable checkbox selection; redesign the sidebar session picker (whole-row toggle, highlight + check on right, selected pinned on top, open with the most recent session instead of the saved pick, per-session × chips + Clear all). Out of scope: capture hook, unrelated tabs/views.

Decisions (user, 2026-10-09):
- Row selection: click anywhere on row; selected = highlighted bg + check mark on right edge; empty check slot on hover.
- Default on open: ignore saved pick, preselect most recent session; selected sessions sort to top.
- Clear chips: one chip per selected session with × plus a "Clear all" chip.
- Agent chips / all filters: only values from selected sessions; no selection → all sessions; reload on selection change.
- Orchestrator default (not asked): Clear all leaves an empty selection (Events shows all sessions; Sessions tab shows its "pick a session" prompt).

## Phase 1 — Picker redesign + selection-scoped filters
- [x] 1.1 Session picker — files: web/src/components/Sidebar.tsx, web/src/usePick.ts, web/src/lib/pick.ts(+test), web/src/lib/sidebar.ts(+test), web/src/App.tsx, web/src/components/SessionsTab.tsx, web/src/styles.css → verify: node --test web/src/lib/{pick,sidebar}.test.ts + tsc web   (coordinator → units/1.1.md)
- [x] 1.2 Selection-scoped filters — files: web/src/useEvents.ts, web/src/useUsage.ts, web/src/lib/agents.ts(+test), web/src/lib/params.ts(+test), web/src/components/{FilterBar,AgentPicker,EventsTab}.tsx, scripts/wal-server.ts, scripts/wal-index.ts, scripts/query.test.ts → verify: node --test on owned tests + tsc   (coordinator → units/1.2.md)
- [x] 1.R review   (opus/high)

## Log
- 2026-10-09 review: 0 blockers, 1 major (startup all-sessions query) + minors routed and fixed; re-review clean. Final: npm run check exit 0, npm test 124/124 pass. Not browser-verified. Known cosmetic: live-arriving category chips append at end until requery.
- 2026-10-09 1.2 done: server already scoped agents by ids; leak path was hidden/persisted pick (fixed by 1.1). Real leak fixed: tool/event chips only grew, categories unscoped; all filters now pruned per selection; empty ids = all sessions on /events. User decided: usage tiles show nothing on empty selection. 1.1 follow-ups landed (App ids null while loading, README, comment). Review dispatched.
- 2026-10-09 1.1 done: root causes = poll re-sort under pointer, unpick-last refused, reconcile re-picking newest, cross-tab storage sync. Pick now in-memory, order frozen on hover, × chips + Clear all. Follow-ups: README.md:50 stale, pick.ts:3 stale comment.
- 2026-10-09 scope confirmed; scout mapped files; units 1.1 and 1.2 dispatched in parallel.
