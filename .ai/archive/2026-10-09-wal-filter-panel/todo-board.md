# Todo board — WAL viewer: filters in a right SidePanel, shared panel component, sticky Events head

Scope: implement plan.md Phases 1–3 in tools/wal-observer (code + README); plan's "NOT doing" list stays out; no commits; manual UI check by user at the end.

Web root: `tools/wal-observer/web/src/` (abbrev. `W/`)

## Phase 1 — Shared SidePanel with arrow toggle
- [x] 1.1 SidePanel + Sidebar adoption — files: W/components/SidePanel.tsx (new), W/components/Sidebar.tsx, W/styles.css → verify: `npm run check && npm test` in tools/wal-observer   (coordinator → units/1.1.md)

## Phase 2 — Right filter panel
- [x] 2.1 FilterBar → FilterPanel, wal.fpin — files: W/components/FilterBar.tsx → FilterPanel.tsx, W/components/EventsTab.tsx, W/App.tsx, W/styles.css → verify: `npm run check && npm test`   (coordinator → units/2.1.md)

## Phase 3 — Sticky Events head
- [x] 3.1 Sticky head, merged line, usage tiles per tab, README — files: W/components/StatsHeader.tsx, W/components/EventsTab.tsx, W/App.tsx, W/styles.css, tools/wal-observer/README.md → verify: `npm run check && npm test`   (coordinator → units/3.1.md)
- [x] 3.2 Page header (with theme toggle) sticky on both tabs — files: W/App.tsx, W/styles.css, W/components/EventsTab.tsx (--bar-h), README → verify: `npm run check && npm test`   (coordinator 3.1, after 2.1 fixes)
- [x] 3.R review of all phases   (opus/high) — 0 blocker, 1 major, 7 minor; fixes routed 1.1 → 2.1 → 3.1 (sequential, shared styles.css)

## Log
- 2026-10-09 User decisions: no commits; automated checks only per phase, user does manual UI pass at end; one Opus review after Phase 3 only; leave unrelated agents/settings.json modification alone.
- 2026-10-09 1.1 done: SidePanel.tsx (new, untracked), Sidebar.tsx, styles.css (.panel shared rules, --fp-w). Arrow before tabs in tab order. check+test pass (136/136). Plan progress 1.1–1.3 ticked; 1.4–1.7 await manual pass.
- 2026-10-09 2.1 done: FilterBar→FilterPanel (git mv), EventsTab owns fopen/resets/--bar-h observer + FormatSeg, App wal.fpin + data-fpin, styles. check+test pass (136/136). Plan 2.1–2.3 ticked; 2.4–2.10 manual. Carry-over to 3.1: handle may overlap "Toggle theme"; stale filterSummary comment in lib/params.ts:44.
- 2026-10-09 3.1 done: StatsHeader merged run, EventsTab sticky head (usage tiles + line + shared Reset), App usage tiles off-Events only, styles (hero removed, 64px handle clearance when fpanel unpinned), params.ts comment, README. check+test pass (136/136). Plan 3.1–3.3 ticked; 3.4–3.10 manual.
- 2026-10-09 3.R review: checks pass. Major: SidePanel keyboard-opened panel never closes (1.1). Minor: handle a11y + overlaps focus-within panel (1.1); FilterPanel last in tab order, dead .fld/.pop/data-end/.panel-edge right (2.1); 64px clearance tight, .evl-sum no ellipsis (3.1).
- 2026-10-09 1.1 review fixes done (focus-out close, handle aria + handleLabel prop, handle z-index under panel, dead .panel-edge right). Pending: EventsTab must pass handleLabel (→ 2.1).
- 2026-10-09 User added scope: page header (theme toggle) sticky on both tabs → new item 3.2, owned by 3.1 coordinator.
- 2026-10-09 2.1 review fixes done (handleLabel, SidePanel before bar in DOM, dead .fld/search min-width/.pop absolute rules + AgentPicker data-end removed). check+test pass.
- 2026-10-09 3.1 review fixes + 3.2 done: header sticky both tabs (--head-h measured in App), Events head sticks under it, handle moved below header (64px header padding dropped), usage row 96px clearance, .evl-sum ellipsis+title. check+test pass. Est. sticky height ~170px Events / ~61px Sessions. Next: reviewer re-check.
- 2026-10-09 Re-review: all 8 findings resolved, no regressions. User chose to fix all 3 leftovers. 3.1: banner clears handle (96px), dead input[type=number] width removed — check+test pass.
- 2026-10-09 1.1: hidden handle tabIndex=-1 + aria-expanded true while visible. Final: npm run check exit 0, npm test exit 0 (136/136). Board done; awaiting user manual UI pass (plan Progress manual items) and commit.
