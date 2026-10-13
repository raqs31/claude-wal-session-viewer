# Todo board — wal-observer: session-aware, standalone viewer

Scope: implement the design spec (removed from the repo 2026-10-08; plan.md carries it) per plan.md; on main, one commit per phase, review after every phase.

## Phase 0 — Plan
- [x] 0.1 plan.md from spec → verify: 5 phases, chunks with verify commands   (model: session)
- [x] 0.2 fold user decisions into plan.md → verify: no open questions left   (model: sonnet)

## Phase 1 — Packaging + hook
- [x] 1a moves (wal-hook plugin, tools/wal-observer), marketplace/settings/.gitignore/install.sh refs → verify: `cd tools/wal-observer && npm test`   (model: sonnet)
- [x] 1b hook writes `<transcript>.wal.jsonl`, `workspace` stamp, fallback → verify: `bash agents/plugins/wal-hook/hooks/wal-hook.test.sh`   (model: sonnet)  [par 1c]
- [x] 1c `scripts/wal` launcher → verify: `bash -n scripts/wal && shellcheck scripts/wal`   (model: sonnet)  [par 1b]
- [x] 1r review phase 1   (model: session)
- [x] 1x commit (only wal hunks of marketplace.json; leave user's blast-radius/subagent-pane entries unstaged)

## Phase 2 — Server
- [x] 2a discovery.ts + `/sessions` → verify: `npm test`   (model: session)
- [x] 2b wal-index.ts, merged `/events?ids=`, `/record`, `/events-stream` → verify: `npm test`   (model: session)
- [x] 2c slimmed `/session`, `/usage`, `/usage-stream`, shared `/session-stream?ids=` → verify: `npm test`   (model: session)
- [x] 2d benches to §4 budgets → verify: `npm run bench`   (model: sonnet)
- [x] 2r review phase 2   (model: session)
- [x] 2x commit

## Phase 3 — `wal legacy`   [par Phase 4]
- [x] 3a legacy.ts + test + `wal legacy` dispatch → verify: `npm test`, `shellcheck scripts/wal`   (model: sonnet)
- [x] 3r review   (model: session)
- [x] 3x commit

## Phase 4 — Web UI
- [x] 4a pick/unseen/sidebar logic modules + data hooks → verify: `npm test`, `npm run check`   (model: session)
- [x] 4b sidebar, header tabs + live usage tiles, legacy banner → verify: `npm run check && npm test`   (model: session)
- [x] 4c Events scoped to pick → verify: `npm run check && npm test`   (model: sonnet)  [par 4d]
- [x] 4d Sessions blocks, expandable agent rows (stats only), timeline removed → verify: `npm run check && npm test`   (model: sonnet)  [par 4c]
- [x] 4r review   (model: session)
- [x] 4x commit

## Phase 5 — Docs + final verification
- [x] 5a README for tools/wal-observer, CLAUDE.md pointer → verify: no stale `agents/plugins/wal-observer` refs (`git grep`)   (model: sonnet)
- [x] 5b success-criteria walk-through + `npm test`, `npm run bench`, `bash -n`/`shellcheck scripts/wal` → verify: pasted output   (model: sonnet)
- [x] 5x commit; tell Mario to run `claude plugin uninstall wal-observer@unix-conf`

## Log
- 2026-10-08 Scope confirmed: new change folder, plan + implement, on main, commit per phase, review per phase.
- 2026-10-08 plan.md written (13 chunks / 5 phases, 10 open questions).
- 2026-10-08 Decisions: Q1–6, Q8, Q9 defaults accepted; Q7 → no "Show in Events"/focus chip, existing Events agent chips suffice; Q10 → proceed without /resume check. No session/agent tree in sidebar.
- 2026-10-08 Events has no agent chips today → user: add them (2b agent index+filter, 4c chips).
- 2026-10-08 1a dispatched.
- 2026-10-08 1a landed (70 renames, npm test 45/0 + hook ok, check clean); 1b+1c dispatched in parallel.
- 2026-10-08 1b landed (hook test 23 ok, npm test + check pass).
- 2026-10-08 1c landed (scripts/wal, bash -n + shellcheck clean, live run 200). Phase 1 review dispatched.
- 2026-10-08 1r review: ship; 3 low findings (install.sh:78 stale comment, wal npm-install fallback/staleness, wal trailing output) → fix chunk dispatched.
- 2026-10-08 Phase 1 findings fixed (install.sh comment, wal staleness/npm-install warning, filter wait); live launcher test: curl 200, xdg-open once, SIGTERM → 143, no leftover server.
- 2026-10-08 Phase 1 committed 0a37adb (only wal hunks of marketplace.json + agents/settings.json staged; user's blast-radius/subagent-pane/typescript-lsp edits left unstaged). 2a dispatched.
- 2026-10-08 2a landed (discovery.ts, /sessions; 52/52 tests; /sessions 300 files 271 ms). --file kept for 2b to remove. 2b dispatched. Phase-1 viewer for Mario served from /tmp/walview on :7878.
- 2026-10-08 Session restart: first 2b worker was cut off with no durable output; tree verified green at 2a state (52/52, check clean); 2b re-dispatched. /tmp/walview viewer (:7878) stopped with the old session.
- 2026-10-08 2b landed (wal-index.ts LRU 8, merged /events?ids= + agent filter/facet, /events-stream vector ids, /record?id&seq&gen; 52/52, bench first page 10 ms, q 270 ms, RSS 212 MB). Events page empty until Phase 4 sends ids. 2c dispatched.
- 2026-10-08 Phase 3 (legacy.ts + wal legacy) dispatched in parallel with 2c (disjoint files; commit separately).
- 2026-10-08 3a landed (legacy.ts migrate/runLegacy, 6 tests, wal legacy dispatch; shellcheck + check clean). Phase 3 review dispatched.
- 2026-10-08 2c landed (sessions.ts OPEN_MAX 8 no timelines, /session agentStats, /usage {totals,recorded,missing}, /usage-stream, multiplexed /session-stream; Timeline.tsx/TimelineItem.tsx git rm'd; 60/60 incl legacy). 2d dispatched.
- 2026-10-08 3r review: fix first — HIGH lines appended during migrate lost; HIGH partial last line in target glued; MED big append interleave; MED legacy dedupe by raw cwd → ENOENT. Fix chunk dispatched (snapshot-rename approach).
- 2026-10-08 Phase 3 findings fixed (snapshot-rename migrate + leftover snapshot recovery, newline guard, 64 KB batches, realpath dedupe, true count; legacy+discovery 22/22). Commit after Phase 2 (legacy imports discovery.ts).
- 2026-10-08 2d landed (bench 5×20 MB: first page 16–20 ms, q ≤300 ms, /sessions 300 files 352 ms, /session cold 156 ms; RSS flaky 219–302 MB vs 300). Phase 2 review dispatched incl. RSS diagnosis.
- 2026-10-08 2r review: conformance/cursor/SSE OK; MUST fix RSS (buffer reuse in tail()/reader(), 1 MB window → ~175 MB); MED unknown id nulls whole pick + locate rescan per tick; LOW dup ids, >8 MB line stall, inode truncation, /sessions vanish 500, params.ts stale. Fix chunk dispatched (session model).
- 2026-10-08 Phase 2 findings fixed (buffer reuse + 1 MB reader window → RSS 173–176 MB ×3; unknown ids skipped + reported, locate misses memoized; dedupe ids; >8 MB line skip; inode truncation; /sessions vanish-safe; params.ts). 69/69, check clean. Committed c894cdd.
- 2026-10-08 Phase 3 committed (legacy 12/12, shellcheck clean). Next: Phase 4 UI — API additions: Page.unknown, UsageTotals.unknown, `event: unknown` SSE frame.
- 2026-10-08 4a landed (lib pick/unseen/sidebar + hooks useSessions/usePick/useUnseen/useUsage/useSessionViews, useEvents ids+agent; 89/89). Decided: empty agent set = no filter (matches cat/tool chips). 4b dispatched.
- 2026-10-08 4b landed (Sidebar/UsageTiles/LegacyBanner, pin fixed-sidebar + edge slide-out, SessionList removed; 94/94; headless smoke OK). 4c (sonnet) + 4d (session) dispatched in parallel with disjoint files.
- 2026-10-08 4c landed (agent chips in FilterBar, lib/agents.ts label+prune, session column always shown; check + tests pass).
- 2026-10-08 4d landed (Block per pick, ByAgent expandable AgentRow, lib/agentStats, lazy charts near viewport, ScopeSelect/old useSession/timeline CSS removed; 99/99; Playwright smoke OK). Phase 4 review dispatched.
- 2026-10-08 4r review: ship; smoke OK (2 SSE + poll regardless of pick size). MED: pick change reloads all blocks; agent row not keyboard-operable. LOW: unpinned sidebar tab order, main model —, stale ids before first list, block re-render per poll, cross-tab storage, extra /events on prune. Fix chunk dispatched; 5a docs dispatched in parallel.
- 2026-10-08 5a landed (tools/wal-observer/README.md rewritten, AGENTS.md pointer row; CLAUDE.md symlink verified intact; no stale plugin refs). UI wording in README to be checked in 5b.
- 2026-10-08 Phase 4 findings fixed (incremental session views, agent row button, sidebar visibility, main model, no stale ids pre-list, memoized blocks, cross-tab storage, no extra /events on prune). npm test exit 0, 100/100, check clean. Phase 4 committed.
- 2026-10-08 5b: criteria 1–4 PASS (fake-HOME /sessions shows default+iso badges; real 9dbdaba4 WAL beside transcript with workspace=priv); npm test + bash -n/shellcheck PASS; bench /sessions 812 ms FAIL (same code was 247 ms earlier; whole machine ~3× slower). README wording fixed. Mario chose: optimize discovery head() for margin → dispatched.
- 2026-10-08 discovery head() optimized (lastTitle via indexOf, parser only until first prompt): /sessions cold 817 → 229 ms on the throttled machine. Final: bash -n + shellcheck OK; npm test exit 0 (101/101); check exit 0; bench exit 0 (first page 49 ms, q 532 ms, RSS 174 MB, /sessions 229 ms, /session cold 360 ms). Phase 5 committed. Remaining for Mario: ./install.sh, `claude plugin uninstall wal-observer@unix-conf`, optionally `wal legacy`.

## Phase 6 — UI follow-ups (Mario's notes after first real use)
- [x] 6a agent filter as one chip + multi-select dropdown; untyped progress-summary agents grouped server-side as `summaries`; Events|Sessions switch at top of sidebar; Events filter bar + sidebar filters collapsible (remembered) → verify: npm test, check, real-data curl on 9dbdaba4 facet   (model: session)
- [x] 6r review   (model: session)
- [x] 6x commit + restart viewer on :7878
- 2026-10-08 Real-data finding: agents facet had 154 entries — 134 untyped single-SubagentStop progress-summary agents. Mario: one chip w/ dropdown when >1 agent; summaries as one grouped entry; tabs at sidebar top (inside sidebar only); both filter areas collapsible. 6a dispatched.
- 2026-10-08 6a landed (+ sidebar: only session list scrolls). Real data: facet 22 entries (main + 20 typed + summaries 141); agent=summaries → only SubagentStop rows. 106 unit + 229 script checks pass; Playwright smoke OK. 6r dispatched. Pending from Mario: rest of 'also move …' note.
- 2026-10-08 Mario: 'also move' was a typo — nothing pending.
- 2026-10-08 6r review: ship; 4 low polish fixes applied (popover overflow, aria-haspopup dialog + focus, .sb-top scroll cap, pin-only pressed style). npm test exit 0 (106/106), check exit 0. Phase 6 committed; viewer restarted on :7878.

## Phase 7 — Agent filter tree
- [x] 7a session › main › spawned-agent tree in the agent dropdown; cascade ticking with partial state; summaries attached under the agent they describe; session-scoped agent filter tokens → verify: npm test, check, real-data tree on 9dbdaba4 + 2-session pick   (model: session)
- [x] 7r review   (model: session)
- [x] 7x commit + restart viewer on :7878
- 2026-10-08 Mario asked where the MCP filter went: still in the tool row, hidden when "▸ Filters" is folded (default open). Mario chose the agent tree (Session › main › spawned) with subtree ticking and summaries under their agent. 7a dispatched.
- 2026-10-08 7a landed (session-scoped tokens <sess>:*, <sess>:<id>, <sess>:<id>*, <sess>:summaries:<id>; tree facet; real 9dbdaba4: main 23 children, 147 summaries attributed to 17 agents, 17 unattributed; npm test + check pass). Worker ran repo-wide git stash/pop — verified user's unrelated changes intact. 7r dispatched (incl. one-off popup-close bug, bench).
- 2026-10-08 7r review: HIGH popup-close = outside-click check after re-render removed clicked node (searchTree); MED live tail misses running fg children (parent link only at child end), O(depth²) subtree match, tree a11y; LOW main* token, stale tokens → empty page. Bench within noise under load 13–15. Fix chunk dispatched.
- 2026-10-08 Incident: Mario saw an empty Events view — the :7878 viewer (started 20:08, Phase 6 server) served web/dist that the 7r fix worker's npm test rebuilt at 20:42 (Phase 7 client) → API mismatch. Fix: Mario's viewer now runs from a frozen export of the last commit in /tmp/walstable; restart from a new export after each commit.
- 2026-10-08 7r fixes landed (composedPath outside-click + stable search list, lineage cache O(depth), visited-set cycles, tree a11y roving tabindex, main* token, stale tokens ignored; live fg-children limit documented — no earlier signal in WAL). npm test exit 0 (111/111), check exit 0, bench OK. Phase 7 committed; viewer restarted from fresh export.
