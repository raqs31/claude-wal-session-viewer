# Todo board — WAL viewer: session names from rename + first-prompt hover bubble

Scope: session name = latest rename (`custom-title`) → latest auto title (`ai-title`) → first user message; a styled hover bubble shows the full raw first user message plus the auto title; same name everywhere (sidebar rows, × chips, Sessions tab headers). Out of scope: other title sources, filtering by name.

Decisions (user, 2026-10-09):
- Name priority: rename → auto title → first prompt.
- Hover: styled bubble, full first prompt (scrollable if long) + auto title as hint.
- Prompt text: raw whole initial user message, no cleaning (row truncates visually only).
- Applies everywhere titles appear.

## Phase 1 — Names and hover
- [x] 1.1 Session names + hover bubble — files: scripts/discovery.ts(+test), scripts/sessions.ts, shared/api.ts, web/src/components/{Sidebar,SessionsTab,SessionStats}.tsx, web/src/styles.css, README.md → verify: npm run check + npm test   (coordinator → units/1.1.md)
- [x] 1.2 Session stats panel layout: each label on its own line with its chart under it (inspect with Playwright before and after) — files: web/src/components/{SessionStats,StatsHeader,UsageTiles}.tsx, web/src/components/charts/*, web/src/styles.css → verify: Playwright screenshot + npm run check   (coordinator → units/1.2.md, after 1.1: shares styles.css and SessionStats.tsx)
- [x] 1.R review   (opus/high) — round 1 done (0 blockers, 1 major: keyboard bubble closed by focus-scroll); fixes routed to 1.1
- [x] 1.3 Subagent charts in the expanded agent row: numbers first, then cumulative tokens + tokens per API call (labels above charts), same chart components — files: TBD by coordinator (AgentRow, SessionsTab/SessionStats, charts/*, lib/series, server per-agent series?) → verify: npm run check + npm test + Playwright screenshot   (coordinator → units/1.3.md, after 1.R fixes: shares styles.css)

## Log
- 2026-10-09 all review fixes landed; prompt cleaning (cleanPrompt, ⚡ /cmd args) done. Final: npm run check exit 0, npm test 136/136. Not committed.
- 2026-10-09 user reversed raw-prompt decision: clean tags, ⚡ + "/cmd args" for command/skill sessions, drop noise blocks (1.1). Final review: 0 blockers, 1 major (1.3 agent charts refetch keyed on request count misses in-place usage updates) + minors routed to 1.3 and 1.1. AgentCharts.tsx untracked: git add before commit.
- 2026-10-09 1.3 done: per-agent series via existing /session?scope=agent:<id>, fetched on expand; per-call bars; no turn markers; main row skipped. 132/132. User changed bubble to prompt-only (1.1 applying).
- 2026-10-09 review round 2 clean (131/131); 2 last bubble minors fixed in Sidebar.tsx (sidebar stays open while bubble focused; keyboard bubble closes when row scrolls out). 1.3 running.
- 2026-10-09 review round 1: 0 blockers, 1 major, 8 minors, all routed to 1.1 (incl. the 1.2 CSS minmax line). User added 1.3: charts per subagent in the expanded row (cumulative + per API call, under the numbers). Queued after fixes.
- 2026-10-09 1.1 done: custom-title → ai-title → raw first prompt (cap 8192 chars, inline in /sessions ≈370 KB/poll); agent-name excluded (also auto-written on plan exit); hover bubble on hover/keyboard focus. npm test 127/127. 1.2 dispatched.
- 2026-10-09 user added: reorganise session stats panel (label | chart | label | chart in a row → label with chart beneath). Queued as 1.2 after 1.1 (file overlap).
- 2026-10-09 scope confirmed; 1.1 dispatched.
