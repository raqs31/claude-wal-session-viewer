# WAL viewer — Sessions tab — Plan Brief

> Full plan: `.ai/changes/wal-sessions-tab/plan.md`

## What & Why

A Sessions tab in the wal-observer page that shows each Claude Code session of the project as a
readable conversation timeline, with token usage, per-model/per-agent breakdown, an estimated USD
cost and charts. Hook payloads carry no usage, so the numbers have to come from the transcripts
Claude Code writes itself.

## Starting Point

The page (React + Vite, served by `scripts/wal-server.ts` on Node 24 TS) shows only the WAL event
log: one view, no tabs, no transcript reading, no charting library, no price table.

## Desired End State

`/wal` opens an Events | Sessions switch. Sessions lists the project's sessions (plus worktree
sessions) by last activity; opening one shows stats, uPlot charts and a live, collapsible
conversation — replies with model + tokens, tool calls with results, subagents nested at their
spawn point, compaction markers — all following a Whole / Main / one-subagent scope selector.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where parsing happens | Server parses/aggregates, browser holds one page | Transcripts reach 10–16 MB | Brainstorm |
| Session discovery | `~/.claude/projects/<slug>/` + `<slug>--ai-worktrees-*`, not the WAL | Canonical source; WAL misses older sessions | Plan (user correction) |
| List contents | Metadata only (title, start, last, size, worktree) | Stays instant as history grows | Plan |
| Charts | uPlot; share chart as stacked horizontal bars | Fast canvas charts; uPlot has no pie | Plan |
| Cost | `scripts/pricing.json` (official page, URL + date) + `cost-state` cross-check, labelled estimated | Per-agent/model split with a sanity check | Plan |
| Timeline entry point | Open at end, load earlier on scroll-up | Natural for live sessions, reuses Events pattern | Plan |
| Compaction / `/clear` | Divider/command rows, history kept | File keeps everything; stats stay complete | Plan |
| Turn | Human prompts only | Matches "I asked X, it cost Y" | Plan |
| Tests | Fixture cut from a real transcript of this repo, text blanked, committed | Real structure without private text | Plan |
| Cut line | Nothing cut — all ships | User priority | Plan |

## Scope

**In scope:** discovery incl. worktrees; parser (reply dedupe by `message.id`, synthetic/error
exclusion, turns, subagents, compaction); 4 endpoints + SSE; tabs; list; stats + scope; timeline;
3 chart groups; live tail incl. subagents spawned mid-session; price table; bench; docs.

**Out of scope:** WAL/hook changes, tokens in the list, cross-tab links, other projects, search in
conversations, automatic price updates, pie charts.

## Architecture / Approach

`transcripts.ts` (pure, fs-free incremental parser + aggregator) ← `sessions.ts` (discovery, path
allowlist, size+mtime cache for ≤3 open sessions, per-tick advance, reset/gen) ← `wal-server.ts`
routes `/sessions`, `/session`, `/item`, `/session-stream` on the existing 250 ms tick. Page:
`useSessions` / `useSession` hooks → `SessionList`, `SessionStats`, `ScopeSelect`, `Timeline`
(reusing the exported JSON/YAML/Raw `Pane`), uPlot chart components.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fixture, parser, pricing | Real-derived fixture, `transcripts.ts`, `pricing.json`, unit tests | Fixture misses an edge class; order vs chain disagreement |
| 2. Server | Discovery, 4 endpoints, live tail, server test | Path safety; partial-line/multi-file tail correctness |
| 3. Page shell | Tabs, list, stats, scope selector | Moving Events body must not change its behaviour |
| 4. Timeline | Folded items, nesting, load earlier, live pill | Scroll anchoring with nested expansion |
| 5. Charts | uPlot cumulative, per-turn bars, share bars | Canvas theming; stacked areas in uPlot |
| 6. Verify & docs | Bench, live check, README, `/wal --project` | Budgets on 16 MB files |

**Prerequisites:** `wal-observer-ts-react` done (archived 30/09/2026); Node 24 via nvm; web access
to fetch the official pricing page.
**Estimated effort:** ~4–6 sessions across 6 phases (estimate).

## Open Risks & Assumptions

- Transcript format is internal to Claude Code and may change; the fixture pins today's shape
  (surveyed 30/09/2026 over 310 real files).
- Timestamps are non-monotonic in file order in 305/310 files; Phase 1 confirms file order matches
  the parent chain before relying on it.
- Worktree slug format `<slug>--ai-worktrees-<name>` is inferred from the naming rule; no such
  folder exists yet (verified in Phase 6).
- Costs are estimates from list prices; the `cost-state` total (in 33/35 main files, includes
  subagents, per-model split) is the only recorded figure and is shown on the Whole scope only.

## Success Criteria (Summary)

- Open the current session in `/wal` and watch this conversation, its tokens and cost grow live.
- Scope switch makes stats, charts and timeline agree for main vs each subagent.
- `npm run check && npm test && npm run bench` pass within the stated budgets.
