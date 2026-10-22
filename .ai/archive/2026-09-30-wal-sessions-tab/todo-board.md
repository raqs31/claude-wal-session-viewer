# Todo board — implement the wal-sessions-tab plan (Sessions tab in /wal)

Scope: all 6 phases of `plan.md`; session-model review + one Conventional Commit per phase (change's files only, never the unrelated `agents/settings.json` / `hosts/NEULA014/agents/settings.json` edits); subagents may use WebFetch (pricing) and Playwright (UI checks). Done = `npm run check && npm test && npm run bench` pass + `/wal --project` check.

Plugin root: `agents/plugins/wal-observer/`. Plan step ids (1.1 …) refer to `plan.md` § Progress.

## Phase 1 — Fixture, parser, pricing (pure logic)
- [x] 1.A Fixture extractor + committed blanked fixture → verify: plan 1.1, 1.2, 1.5   (model: session)
- [x] 1.B `scripts/pricing.json` from official pricing page → verify: plan 1.6   (model: sonnet)
- [x] 1.C `transcripts.ts` parser/aggregator + unit tests → verify: plan 1.3, 1.4   (model: session)
- [x] 1.R Phase review → commit   (model: session)
- [x] 1.F Review fixes (turnStarts alignment, turn rule, nits)   (model: session)

## Phase 2 — Server: discovery, endpoints, live tail
- [x] 2.A `sessions.ts` + routes + SSE + server test → verify: plan 2.1–2.3   (model: session)
- [x] 2.B Manual API checks → verify: plan 2.4, 2.5   (model: sonnet)
- [x] 2.R Phase review → commit   (model: session)
- [x] 2.F Review fixes (updated items in delta, lazy spawnUid, recordedCostUsd in delta, per-client try, vite proxy, command titles, nits)   (model: session)

## Phase 3 — Page shell: tabs, list, stats, scope
- [x] 3.A Tabs, hooks, SessionList, SessionStats, ScopeSelect, formatters → verify: plan 3.1–3.3   (model: session)
- [x] 3.B Playwright UI checks → verify: plan 3.4–3.7   (model: sonnet)
- [x] 3.R Phase review → commit   (model: session)
- [x] 3.F Review fixes (open() resets, empty frames, since+prune, gen on pages, fmtDuration, css comment)   (model: session)

## Phase 4 — Conversation timeline
- [x] 4.A Timeline component, nesting, load earlier, live pill → verify: plan 4.1, 4.2   (model: session)
- [x] 4.B Playwright UI checks → verify: plan 4.3–4.7   (model: sonnet)
- [x] 4.R Phase review → commit   (model: session)
- [x] 4.F Review fixes + sticky side panel layout   (model: session)

## Phase 5 — Charts (uPlot)
- [x] 5.A uPlot charts + series tests → verify: plan 5.1–5.3   (model: session)
- [x] 5.B Playwright UI checks → verify: plan 5.4–5.7   (model: sonnet)
- [x] 5.R Phase review → commit   (model: session)
- [x] 5.F Review + UI fixes (width-0 build, stable share colours, compact panel tables, agent-scope turns, long tool labels, nits)   (model: session)

## Phase 6 — Verification, performance, docs
- [x] 6.A Bench + README + `/wal --project` → verify: plan 6.1–6.3   (model: sonnet)
- [x] 6.B Live/manual checks → verify: plan 6.4–6.6   (model: sonnet)
- [x] 6.F Final-review fixes (bench port from server log, temp-dir finally, best-of-3 list, README nits, unused exports, change.md status)   (model: session)
- [x] 6.G Fix wal-server port-retry double log (root cause of bench/test port flakiness); tests+benches read URL from log   (model: session)
- [x] 6.S Status line `<name> · <id8>` (session_name → last ai-title → none) + id prefix on list rows   (model: sonnet)
- [x] 6.R Final review → commit; paste `npm run check && npm test && npm run bench`   (model: session)

## Log
- 2026-09-30 User confirmed: all 6 phases, skip plan-review, review+commit per phase, WebFetch+Playwright allowed.
- 2026-09-30 1.B landed: pricing.json from platform.claude.com/docs/en/about-claude/pricing (30/09/2026), 6 models priced, all observed message.model covered. Page has NO long-context premium (contradicts plan §1.4) → 1.C drops the long-context tier; cache read explicit per model (not derived). Fast mode/batch/US-only/web search not priced (README note, Phase 6).
- 2026-09-30 1.A first cut used a work-project (IdeaProjects) session for compaction/API-error classes. User decided: cut only from this repo, synthesize missing classes (compaction pair, <synthetic> API error) in the extractor; include `.playwright-mcp` .gitignore line in Phase 1 commit. 1.A rework dispatched.
- 2026-09-30 1.A landed (rework): `scripts/make-fixture.ts` + `scripts/fixtures/projects/`, sources only from this repo (main d01c2dfc + subagent, 149b4f57 for /clear, worktree 301167f7, sibling c70f5199); compaction pair + <synthetic> API error synthesized, marked `_synthetic: true`. 16/16 edge classes, leak check 0 hits, deterministic. File order == parent chain in all 36 main transcripts. Notes for 1.C: import `isAllowedString`; ai-title all identical (fake one in test); turn-0 spawn has no subagent file.
- 2026-09-30 1.C landed: `scripts/transcripts.ts` (createParser/costOf/inScope/aggregate), `transcripts.test.ts` 13/13, npm test 26/26, check clean. Deviations: usage = LAST entry per message.id (subagent streaming snapshots); items carry byte spans for /item; system/api_error → no item. For Phase 2: recompute stats from records; cost-state keys have `[1m]` suffix → needs model-name mapping; estimated vs recorded 10–25% under on big sessions (partly explained: missing turn-0 subagent file, Haiku only in cost-state, advisor unpriced) — look at in 2.B.
- 2026-09-30 1.R review: no blockers; 1.5 PASS, 1.6 PASS (all 6 prices match official page); npm test 27/27. Should-fix: agent-scope turnStarts/perTurn misalignment. User decided turn rule: any human input the model answers (prompts, human slash commands, /goal) starts a turn. 1.F dispatched.
- 2026-09-30 User: start Phase 2 while 1.F runs async. 2.A dispatched (told not to touch transcripts.ts/tests/fixture; Phase 1 commit after 1.F, explicit pathspecs).
- 2026-09-30 1.F landed: turnStarts unfiltered (agent-scope count = worked.size); typed command = candidate turn confirmed by first assistant reply, cancelled by system/local_command (/goal counts 34×, /clear 0/139 on real data); orderReport enforces exit 1; 27/27 pass. Phase 1 committed.
- 2026-09-30 2.A landed: scripts/sessions.ts (createStore), routes in wal-server.ts (--project, --projects-root), sessions.test.ts; 28/28 pass. Open: vite.config.ts dev proxy not added; deltas carry only new items (later tool result/agentId/usage updates on sent items not streamed); change detection by size only; titles fall back to clipped command text. 2.B + 2.R dispatched in parallel.
- 2026-09-30 2.B: 2.4 PASS (36 sessions newest-first, 31 ai-title / 5 fallback incl. 1 empty); 2.5 PASS (finished sessions est. 3–5% under recorded; live d01c2dfc -21%, main+agents = all exactly; /session 4–35 ms); SSE initial frame OK.
- 2026-09-30 2.R: no blockers, path safety holds, 28/28. 4c (size-only detection) accepted: same-size rewrite breaks offsets either way. 2.F dispatched; 3.A dispatched in parallel (web/** only, codes against the new delta fields).
- 2026-09-30 Session restarted; 2.F and 3.A had been stopped mid-run (2.F partial, 3.A nothing in web/). Both resumed from their transcripts.
- 2026-09-30 2.F landed: parser tracks touched items → SessionDelta.updated; lazy spawnUid; recordedCostUsd in delta; per-client try in sessionTick; vite proxy; fallback title = /command args (parser titleOf); +LRU/stale-gen tests; 34/34 pass. Phase 2 committed.
- 2026-09-30 3.A landed: tabs (useStored wal.tab), EventsTab moved verbatim, SessionsTab/List/Stats/ScopeSelect, useSessions/useSession, lib/tokens.ts (+5 tests); check+build+test pass. Notes: page responses lack gen (≤250 ms mixing window); pending items unflushed until Phase 4; heading changes per tab. 3.B + 3.R dispatched in parallel.
- 2026-09-30 3.R: no blockers, 34/34. Should-fix: open() doesn't reset live/error; pending rebuilt on empty frames; touched never pruned + stream starts at version -1 (add version to SessionFirst); gen on SessionPage; 409→reopen for Phase 4. Heading-per-tab kept as deliberate deviation. Fixes wait for 3.B to batch.
- 2026-09-30 3.B: 3.4–3.7 PASS (tab persists, Events unchanged; 36 sessions newest-first, empty title → id prefix; scopes sum exactly 347 req/$15.89; unpriced → — via fixture; light+dark readable). 3.F dispatched with review should-fixes.
- 2026-09-30 3.F landed: SessionFirst.version → stream ?since=, touched pruned below min client version (+reset when behind pruned floor), gen on SessionPage, open() clears live/info; check+build+test pass. Phase 3 committed.
- 2026-09-30 4.A landed: Timeline.tsx + TimelineItem.tsx (Row/Items/AgentTimeline), Pane + FormatSeg exported, no server change; 35/35, smoke run on fixture OK. Limits: stats height change shifts view when scrolled up; nested load-earlier not anchored; tool row opened pre-result needs reopen; follow shared with Events. 4.B + 4.R dispatched.
- 2026-09-30 4.R: no blockers, 35/35. Should-fix: load-earlier sentinel fires when scrolling up to stats (loads whole history); late 409 reopen captures stale open(). Also: refetch open tool row on updated (c), cap Entry pane height, nits. Accept (b) nested load-earlier unanchored, (d) shared follow. User decided layout: stats + charts in a sticky side panel (timeline in main column) — deviation from plan 'three charts on top'. Fixes wait for 4.B (it's serving the built page).
- 2026-09-30 4.B: 4.3–4.7 PASS (215e1f03: 200→229 items, 0 px anchor shift; 123 KB item expands in 45 ms, Copy OK; 14 agent rows nested at spawn; compaction + /clear on fixture; live follow/pill on fixture copy — real live session idle during test). 4.F dispatched.
- 2026-09-30 4.F landed: 3-region layout (list | timeline | sticky stats panel ≥1200px; <1200px collapsible Stats in sticky bar), stable reopen, refetch on late result, pane cap; smoke: 1 page load at top, 0 px shift. Carry to Phase 5: By-agent table wraps names in panel; thinking summaries truncated by usage column. Phase 4 committed.
- 2026-09-30 5.A landed: uplot devDep; lib/series.ts (+6 tests); charts/UPlot wrapper (theme rebuild, ResizeObserver, setData live), TokensOverTime, TurnBars, ShareBars (HTML); By-agent name truncation, timeline summary min-width; 41/41. Deviation: share by tokens not cost. Seen: By-model table clipped at panel edge. 5.B + 5.R dispatched.
- 2026-09-30 5.R: no blocker, 41/41. Should-fix: build uPlot only at width>0; stable share colours (spawn order, --cat-* cycle, Other); panel tables too wide (merge CW 5m/1h, short headers). Nits: drag-zoom reset on setData, alpha suffix, stale css comment, unused exports. Fixes wait for 5.B.
- 2026-09-30 5.B: 5.4–5.7 PASS (chart ends = tiles in 6 scope combos, API exact; markers = turnStarts 0 ms; theme/resize OK; live session grew 568→572 req in 90 s). Findings: panel tables clipped (818–930 px in 416 px); agent scope shows all main turn markers/bars; long mcp tool labels overlap in timeline. Orchestrator decision: agent scope shows only worked turns. 5.F dispatched.
- 2026-09-30 5.F landed: build uPlot at width>0 only; stable share colours (--cat-* + Other); compact panel tables fit 340 px; agent scope shows only worked turns (+test); tool-label ellipsis; 42/42. Phase 5 committed.
- 2026-09-30 6.A landed: scripts/bench-sessions.ts (+bench script runs both): /sessions 300 files 330 ms, cold /session 145 ms, cached 10 ms, 1 MB tick 14 ms — all within budget, no perf fixes; commands/wal.md --project="$PWD"; README Sessions section; 42/42. User: 6.6 via real worktree + headless claude -p (remove with git worktree remove); 6.4 agent check enough.
- 2026-09-30 6.R review: bench blocker — random port hits another host service (8080/8088) → take URL from server log; temp dir leak on throw; /sessions budget flaky under load (754/436/330 ms). README nits, unused exports, change.md status. Fixture privacy grep 0 hits. 6.F dispatched.
- 2026-09-30 6.B: 6.4 PASS (live 674→682 req, subagent rows update; main idle during test). 6.5 plausible-not-tight: 215e1f03 -5%, 8352c886 -1%, d01c2dfc -21% (persists after finish), 087b1215 -29%; live session est 1.8× recorded (recorded cost-state snapshot doesn't track live). 6.6 PASS: worktree folder -home-mraczynski--config-unix-conf--ai-worktrees-wal-badge-check matched, badge shown; worktree+branch removed.
- 2026-09-30 User: accept 6.5 cost gap as plausible; document caveat in README (estimate may run below recorded; recorded is a lagging snapshot). Added to 6.F.
- 2026-09-30 6.F landed: benches read URL from server log, temp dir in finally, best-of-3 list (274–288 ms), README endpoint/LRU/cost caveat, unused exports dropped, change.md status: implemented; bench 3/3 exit 0. Found root cause: wal-server logs a stale URL when the port retry happens (stale listening callback); query.test.ts flaky 2/8. User asked how to tell sessions apart → decided: status line shows name · 8-char id (session_name → last ai-title → none), list rows show dim id prefix. 6.G + 6.S dispatched in parallel.
- 2026-09-30 6.S landed: status.sh shows '📛 <name> · <id8>' (session_name → last ai-title → id only; docs confirm session_id/transcript_path/session_name on stdin); committed separately. SessionList id prefix (web/) waits for Phase 6 commit. shellcheck: only pre-existing SC2034 (unchanged vs HEAD).
- 2026-09-30 6.G landed: wal-server single once('listening') logs the real port (repro: HEAD printed busy 9311 then 9312; now only 9312); scripts/test-server.ts starts servers on --port=0 for tests+benches; npm test 5/5. Known minor: bench leaves its temp WAL if the server fails to start. Final orchestrator run: npm run check && npm test && npm run bench → EXIT 0 (42/42; /sessions 273 ms, cold 115 ms, cached 11 ms, tick 18 ms). Phase 6 committed. All phases done.

## Follow-up — CLI launch without --project
- [x] 7.A Project default: --project → $CLAUDE_PROJECT_DIR → dir of <dir>/.ai/logs/wal.jsonl from --file → $INIT_CWD → cwd; empty list explains what was scanned; README; test   (model: session)
- 2026-09-30 User ran `npm --prefix … run wal-observer -- --file=~/IdeaProjects/.ai/logs/wal.jsonl` → Sessions empty (project resolved to plugin dir). User chose: derive project from --file, then INIT_CWD. 7.A dispatched.
- 2026-09-30 7.A landed: project default order implemented (wal-server.ts:33-37), empty list explains project/folder, header shows project, README, project-default.test.ts (3); user's command → IdeaProjects, 253 sessions; 45/45. Committed.
