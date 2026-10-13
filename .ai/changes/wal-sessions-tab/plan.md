# WAL viewer — Sessions tab Implementation Plan

## Overview

Add a **Sessions** tab next to the existing Events view of the wal-observer page. It lists the
project's Claude Code sessions straight from Claude Code's own project folder, and for a selected
session shows a collapsible conversation timeline, token/model statistics with an estimated USD
cost, and uPlot charts — all following a scope selector (Whole session / Main only / one subagent)
and tailing the live transcript.

## Current State Analysis

- The plugin (`agents/plugins/wal-observer/`) is strict TS on Node 24 type stripping; the page is
  React 19 + Vite 8, built at launch. Every package is a devDependency; the hook needs no
  `node_modules`.
- `scripts/wal-server.ts` is a plain if-chain router (`handle`, l.333–393) over `/events`, `/record`,
  `/stream`, then static `web/dist`. Live tail is a 250 ms `setInterval` (l.290–315) writing SSE
  frames `id: <seq>\ndata: <json>\n\n`, and `event: reset` on truncation; a `gen` counter
  (starts at `Date.now()`) plus 409 "stale gen" on `/record` guards offsets against a replaced
  file. It binds 127.0.0.1; `--file=`/`--port=` flags; no transcript reading at all.
- `shared/api.ts` holds wire types only, imported with `import type … '../shared/api.ts'`.
- The page has no tabs (`web/src/App.tsx`): header → `StatsHeader` → `FilterBar` → `EventTable`.
  `useStored(key, allowed, fallback)` persists string unions (`wal.view`, `wal.format`). The
  "N new" pill and IntersectionObserver-driven "load older" live in `components/EventTable.tsx`
  (l.28, 57, 87–89). `RecordViewer.tsx` has an unexported `Pane({title, v, format, bad})` that
  renders any JSON value as JSON/YAML/Raw with a Copy button built on click.
- Tests: `web/src/lib/*.test.ts` use `node:test`; `scripts/*.test.ts` are top-level scripts that
  spawn `node scripts/wal-server.ts --port=<random> --file=<tmp>` and assert via a `check()` helper.
  `scripts/bench.ts` benchmarks a generated 100 MB WAL.
- `scripts/pricing.json` does not exist; no charting library is installed.

### Transcript ground truth (surveyed 30/09/2026 over 310 real main transcripts)

- Files: `~/.claude/projects/<slug>/<sessionId>.jsonl`; subagents in
  `<slug>/<sessionId>/subagents/agent-<agentId>.jsonl` + `agent-<agentId>.meta.json`
  (`agentType, description, model, requestNonInteractive, requestShape, spawnDepth, toolUseId`).
  Slug = project path with every non-alphanumeric char replaced by `-`
  (`/home/mraczynski/.config/unix_conf` → `-home-mraczynski--config-unix-conf`; holds for all 8
  folders on this host). Worktree folders would be `<slug>--ai-worktrees-<name>` (none exist yet).
- Sizes: main transcripts median 0.7 MB, max 10.1 MB; subagent files up to 15.9 MB; longest single
  line 653 KB.
- Entry types: `user`, `assistant`, `system` (subtypes `turn_duration`, `stop_hook_summary`,
  `local_command`, `compact_boundary`), `attachment`, plus uuid-less metadata (`mode`,
  `permission-mode`, `ai-title`, `last-prompt`, `atis-latch`, `queue-operation`, `cost-state`,
  `file-history-*`). Metadata repeats; the last one wins. No legacy `summary` entries.
- Assistant: one content block per entry (`text`, `thinking`, `tool_use`, rare `server_tool_use`,
  `advisor_tool_result`). One API reply spans 2–4 entries sharing `message.id`, ordered by
  `apiBlockIndex`, each carrying an **identical** `usage` → count the first entry per `message.id`.
  Usage keys: `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
  `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`,
  `output_tokens_details.thinking_tokens` (a subset of output).
- `message.model == "<synthetic>"`: 0 tokens, often `isApiErrorMessage: true` (rate_limit /
  server_error) → excluded from stats and requests, shown in the timeline as an error item.
- User: `tool_result` blocks (`tool_use_id`, `is_error`, content string|array) with sibling
  `toolUseResult`. A human prompt is string content, not `isMeta`, not `isCompactSummary`, with
  `origin.kind == "human"` (or no `origin` and not a command wrapper). `origin.kind ==
  "task-notification"` is a background-agent wakeup. `<command-name>` / `<local-command-*>`
  strings are command wrappers.
- Subagent entries all carry `isSidechain: true`; each subagent file opens with a plain-string user
  entry (no `origin`, no `isMeta`, `parentUuid: null`) that the rule above would misread as a human
  prompt (63/63 files). No subagent entry references a main-file uuid — the only link to the parent
  is the meta's `toolUseId` (also `parentAgentId`, `isFork`).
- Subagent spawn: assistant `tool_use` named `Agent` whose `id` equals the meta's `toolUseId`; its
  `tool_result`'s `toolUseResult.agentId` names the file.
- Compaction: `system/compact_boundary` (`parentUuid: null`, `logicalParentUuid`,
  `compactMetadata.preTokens/postTokens/trigger`), followed by a user entry with
  `isCompactSummary: true`. History before it stays in the file; `sessionId` is unchanged.
- `cost-state` entries carry `totalCostUSD` plus per-model `modelUsage.<model>.costUSD` (and token
  counts). Common: 66 entries in 33 of 35 main files of this repo; `totalCostUSD` never decreases
  within a file. It includes subagent spend (a subagent-only model appears in `modelUsage`), so it
  is comparable to scope `all` only.
- Timestamps are non-monotonic in file order in 305/310 files; no duplicate uuids or dangling
  parents were found.

## Desired End State

`/wal` opens the page with an **Events | Sessions** switch (remembered in `wal.tab`). Sessions shows
every session of the project and its worktrees, newest activity first, with title, start, last
activity, size and worktree. Selecting one shows:

- a stats panel for the chosen scope: input, output, cache read, cache write (5m/1h), thinking,
  requests, turns, duration; a breakdown per agent (main + each subagent) and per model; estimated
  USD cost (labelled *estimated*, "—" for unknown models) and, on the Whole scope when the
  transcript records one, Claude Code's own `cost-state` total next to it (per model too);
- uPlot charts: cumulative tokens over time stacked by type with turn markers, per-turn stacked
  bars, and share-by-agent / share-by-model stacked horizontal bars;
- a timeline opened at the end with "load earlier" on scroll-up: prompts, text, thinking, tool
  calls with results, subagents nested (folded) at their spawn point, compaction and command
  markers; each item folded, expanding to the full payload in the JSON/YAML/Raw pane, each reply
  showing model and tokens;
- live updates: new items land behind the "N new" pill, stats and charts refresh, subagents
  spawned mid-session appear.

Verify with `npm run check && npm test` plus the manual steps in each phase.

### Key Discoveries:

- Router, tick loop and SSE conventions to follow: `scripts/wal-server.ts:290-393`.
- Reusable viewer: `web/src/components/RecordViewer.tsx:6` (`Pane`, to export).
- Pill + load-older + anchoring pattern: `web/src/components/EventTable.tsx:28,57,87`.
- Persisted UI state: `web/src/useStored.ts`; CSS variables are defined in three places in
  `web/src/styles.css` (light, `prefers-color-scheme` dark, `[data-theme="dark"]`).
- Dev proxy list to extend: `vite.config.ts` (`proxy: { '/events', '/record', '/stream' }`).
- `/wal` launch line: `commands/wal.md` (passes `--file="$PWD/.ai/logs/wal.jsonl"`).

## What We're NOT Doing

- No session discovery from the WAL and no WAL changes (no `transcript_path` indexing, hook
  untouched). Consequently no "transcript missing" rows — every listed session has a file.
- No tokens/cost in the session list (metadata only); no sorting by cost.
- No cross-links between the Events and Sessions tabs.
- No sessions from other projects, and no listing beyond the project slug and its
  `--ai-worktrees-` slugs.
- No editing, resuming or exporting sessions; no search inside a conversation.
- No automatic price updates; `pricing.json` is hand-maintained.
- No pie/donut charts (uPlot has none).

## Implementation Approach

The server does all parsing and aggregation (approach A from the brainstorm): a pure,
fs-free `scripts/transcripts.ts` turns JSONL lines into items + usage records incrementally, and a
`scripts/sessions.ts` module owns discovery, path safety, a size+mtime cache and per-session
tailing. `wal-server.ts` only wires routes and the existing tick. The browser holds just the page
of items on screen plus the stats/series payload.

Order: pure logic first against a fixture cut from a real transcript (so the format is pinned
before any UI), then endpoints, then UI shell, timeline, charts, and finally live verification.

## Critical Implementation Details

- **Global constraints (carried over from the TS port).** Prefix every Node/npm command in a
  Claude session with `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH";` (distro node
  lacks type stripping). Erasable-only TS, `.ts`/`.tsx` extensions on relative imports,
  `import type` for types. Log and transcript data rendered as text only — never
  `dangerouslySetInnerHTML`. Why-only comments. Conventional Commits, one per phase step group;
  never stage `agents/settings.json` or `.playwright-mcp/`.
- **Path safety.** The page sends a session id (and agent id), never a path. Both must match
  `^[0-9a-f-]{36}$` / `^[A-Za-z0-9_-]+$` and are resolved only under the allowed slug folders; any
  other value is 400. Only `<slug>` and `<slug>--ai-worktrees-*` match — a bare prefix would also
  catch a sibling project like `unix_conf2` (slug `-…-unix-conf2`).
- **Partial last line.** A live transcript can end mid-line; the incremental parser only consumes up
  to the last `\n` and keeps the byte offset there. Lines have no size cap (653 KB seen).
- **Timeline order.** Order items by file order of uuid-bearing entries; Phase 1 must first
  confirm across all real sessions of this repo (not the re-parented fixture) that file order agrees with the `parentUuid` chain (bridging compaction
  via `logicalParentUuid`) and record which entry types break timestamp monotonicity. If file order
  and chain disagree, order by chain and note it in the parser's why-comment.
- **Usage dedupe.** Usage belongs to the first entry of each `message.id`; later blocks of the same
  reply carry none in our model. Thinking tokens are part of output — shown separately in stats,
  never added again in charts.
- **Session identity / reset.** Each open session has a `gen` (like the WAL's). If the main file or a
  subagent file shrinks or disappears, drop the cached parse, bump `gen`, send `event: reset`;
  `/item` with a stale `gen` returns 409 and the page re-opens the session.
- **Theme and canvas.** uPlot draws on canvas, which ignores CSS variables: read colours via
  `getComputedStyle` and rebuild chart options when `data-theme` changes (MutationObserver on
  `document.documentElement`) or `prefers-color-scheme` flips.
- **Cost honesty.** Every cost figure is labelled *estimated*; the `cost-state` total is labelled
  *recorded by Claude Code*. `pricing.json` carries the source URL and fetch date, never recalled
  prices.

---

## Phase 1: Fixture, parser and pricing (pure logic)

### Overview

Pin the real transcript format into a committed, text-blanked fixture and build the fs-free parser
and aggregator on it.

### Changes Required:

#### 1. Fixture extractor

**File**: `scripts/make-fixture.ts`

**Intent**: One-off, re-runnable script that cuts the minimal set of entries from real transcripts
of this repo (`~/.claude/projects/-home-mraczynski--config-unix-conf/`), keeps structure verbatim
and blanks all human/model text, so the fixture exercises every edge case without private content.

**Contract**:
- Input: one or two source session ids (the implementer picks the sessions that together cover the
  classes below), output directory. Exits non-zero listing every edge class it could not find.
- Edge classes to include: split reply (≥3 entries, one `message.id`), `<synthetic>` / API-error
  reply, `thinking`, `tool_use` + `tool_result` with `is_error: true`, array-content tool result,
  human prompt, task-notification prompt, `isMeta` skill body, `/clear` + other command wrappers,
  `compact_boundary` + `isCompactSummary`, `Agent` spawn with its subagent `.jsonl` + `.meta.json`,
  `turn_duration`, `cost-state`, repeated `ai-title`, a non-monotonic timestamp pair.
- Selection keeps contiguous windows around each class; the first entry of a window is re-parented
  to the last kept entry of the previous window so the `parentUuid` chain stays valid.
- Blanking is an **allowlist**: every string value is replaced by `"x"` repeated `min(len, 40)`
  unless its key is structural — `type`, `subtype`, `uuid`, `parentUuid`, `logicalParentUuid`,
  `sessionId`, `timestamp`, `message.id`, `requestId`, `model`, tool `name`/`id`, `tool_use_id`,
  `agentId`, `toolUseId`, `agentType`, `requestShape`, `origin.kind`, `turnOrigin`, `trigger`,
  `stop_reason`, `service_tier`, `error`. Numbers and booleans (usage, `apiBlockIndex`,
  `spawnDepth`, `compactMetadata` counts, `is*` flags) stay verbatim. Content strings that start
  with a recognised wrapper (`<command-name>`, `<command-message>`, `<local-command-caveat>`,
  `<local-command-stdout>`, `<task-notification>`) keep the opening tag and, for `<command-name>`,
  the command itself (e.g. `/clear`); the rest is blanked. This applies to every entry type,
  including `attachment`, `system/local_command`, `stop_hook_summary` and
  `compactMetadata.preserved*`.
- `cwd` is rewritten to `/tmp/proj` (main) or `/tmp/proj/.ai/worktrees/demo` (worktree copy),
  and `gitBranch` to `main`, so the fixture carries no real paths and matches the test's
  `--project=/tmp/proj`.
- Also reports, over **all** sessions of this repo's real project folder, whether file order of
  uuid-bearing entries agrees with the `parentUuid` chain and which entry types break timestamp
  order; the result goes into the parser's why-comment. At least one window with an out-of-order
  timestamp pair is kept whole (not re-parented), so the parser test sees a real case.
- Output layout (a fake projects root): `scripts/fixtures/projects/-tmp-proj/<sid>.jsonl`,
  `…/-tmp-proj/<sid>/subagents/agent-<id>.{jsonl,meta.json}`, one small copied session under
  `-tmp-proj--ai-worktrees-demo/`, one under a sibling `-tmp-proj2/` (must not be listed).
- The committed fixture holds only blanked real entries. The synthetic cases — a ~700 KB text
  block, multibyte/emoji text, a trailing partial line — are built at test time: the parser test
  feeds them through `push()`, and `sessions.test.ts` appends them to its temp copy of the fixture
  root.

#### 2. Transcript parser and aggregator

**File**: `scripts/transcripts.ts` (new, no `node:fs` import)

**Intent**: Incrementally turn transcript lines into timeline items and usage records, and
aggregate them into stats and chart series for a scope.

**Contract**:
- `createParser(agent: 'main' | agentId)` returning `{ push(chunk: Buffer): void, items, usage,
  meta }` — consumes complete lines only (see Partial last line), tolerates unparseable lines by
  skipping them.
- Item kinds: `prompt`, `notification`, `command`, `meta`, `text`, `thinking`, `tool` (call paired
  with its result by `tool_use_id`; result may arrive later), `agent` (an `Agent` tool call carrying
  `agentId`, type, description), `compact` (pre/post tokens, trigger), `error` (synthetic/API
  error). Each item: stable `uid` (entry uuid), `t`, `agent`, `turn` index, one-line `summary`
  (≤200 chars), `model` + `usage` on the first block of a reply, `isError` for tools.
- Turn = a human prompt in the main file; entries before the first prompt belong to turn 0.
  `isSidechain` entries are never prompts. A subagent's items and usage records take the turn of
  its spawning `Agent` tool_use (meta `toolUseId` → spawn item → `turn`), assigned when the session
  is assembled (`sessions.ts` open/advance), so per-turn sums under scope `all` land on the turn
  that spawned the work.
- Usage record per deduped `message.id` (non-synthetic): `t`, `agent`, `model`, `turn`, input,
  output, cacheRead, cacheWrite5m, cacheWrite1h, thinking.
- `aggregate(records, scope, pricing)` → stats (totals, per agent, per model, requests, turns,
  duration first→last timestamp, estimated cost or `null` when any model is unpriced — per-model
  rows show their own cost) and series (cumulative points per request; per-turn sums; turn start
  times).
- `meta`: last `ai-title`, first timestamp, first human prompt (fallback title), last
  `cost-state.totalCostUSD` and its `modelUsage.<model>.costUSD` map.

#### 3. Wire types

**File**: `shared/api.ts`

**Intent**: Add the Sessions wire types next to the Events ones.

**Contract**: `SessionMeta {id, worktree: string | null, title, started, last, size}`,
`Scope = 'all' | 'main' | \`agent:${string}\``, `Usage`, `SessionStats`, `SessionSeries`,
`AgentInfo {id, type, description, model, spawnUid, head}`, `TimelineItem`, `SessionPage {items, next}`,
`SessionFirst extends SessionPage {id, gen, scope, stats, series, agents, recordedCostUsd, head}`,
`ItemBody`, `SessionDelta {items, stats, series, agents, head}`.

#### 4. Price table

**File**: `scripts/pricing.json`

**Intent**: USD per million tokens for every model id seen in real transcripts, taken from the
official Anthropic pricing page fetched at implementation time — not from memory.

**Contract**: `{ "source": "<url>", "fetched": "DD/MM/YYYY", "models": { "<model id>": { "input",
"output", "cacheWrite5m", "cacheWrite1h", "cacheRead", "longContext"?: { "threshold", "input",
"output", "cacheWrite5m", "cacheWrite1h", "cacheRead" } } } }`. Models without an official price are
omitted (→ cost "—"). `longContext` is present only when the official page lists a premium tier for
that model; `aggregate` applies it to a request whose input + cache read + cache write exceeds
`threshold` (106 real requests do, on `claude-opus-5-5` and `claude-sonnet-5`). Web search/fetch
requests (`usage.server_tool_use`) and multi-entry `usage.iterations` are not priced; the README
says so.

#### 5. Parser tests

**File**: `scripts/transcripts.test.ts` (node:test; add to the `test` script glob, which already
covers `scripts/*.test.ts`)

**Intent**: Pin every edge class against the fixture.

**Contract**: asserts at least — split reply counted once; synthetic excluded from requests and
tokens but present as an `error` item; turn count equals human prompts (task-notifications,
`isMeta`, command wrappers, compact summary and a subagent's opening prompt excluded); subagent
usage carries the spawning main turn; `Agent` item linked to the right
subagent id; compact item carries pre/post tokens; tool error flagged; partial last line not
parsed until completed by a later `push`; a chunk split inside a multibyte character parses
correctly; last `ai-title` wins; cost `null` for an unpriced model, exact for a priced one, long-context rate applied above the
threshold and not at it;
file order vs chain order check result recorded as an assertion.

### Success Criteria:

#### Automated Verification:

- Extractor regenerates the fixture with no missing edge classes: `node scripts/make-fixture.ts <sid…> scripts/fixtures/projects`
- Fixture contains no original text: a scan (part of `transcripts.test.ts`) asserts every string value is under an allowlisted key, a placeholder, or a preserved wrapper tag, and no string contains `/home/`
- Parser tests pass: `node --test scripts/transcripts.test.ts`
- Type checks pass: `npm run check`

#### Manual Verification:

- Skim the fixture diff: only placeholders where text was, structure intact
- `pricing.json` source URL opens the official pricing page and the numbers match it

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 2: Server — discovery, endpoints, live tail

### Overview

Expose sessions over HTTP with safe path resolution, caching and a live stream.

### Changes Required:

#### 1. Sessions module

**File**: `scripts/sessions.ts` (new)

**Intent**: Discover sessions, open and cache parsed sessions, and advance them on each tick.

**Contract**:
- `slugOf(projectDir)`: replace every `[^A-Za-z0-9]` with `-`.
- `listSessions()`: top-level `*.jsonl` only in `<root>/<slug>` and `<root>/<slug>--ai-worktrees-*`
  (never recurse into `<sid>/subagents/`). Per file, no full parse: `stat` (size, mtime → `last`),
  a head read until the first timestamped entry (`started`, fallback title from the first human
  prompt), a tail read of the last 256 KB for the last `ai-title`. Worktree label = the folder
  suffix after `--ai-worktrees-` (`null` for the main slug); no need to read `cwd`. Sorted by `last` desc.
- `open(id)`: resolve the id under the allowed folders, parse main + all subagent files with
  `createParser`, remember byte offsets, size and mtime per file. Keep at most 3 open sessions
  (least recently used evicted). Opening an already cached session whose files changed size or
  mtime runs `advance` on it first (it may have grown with no stream client attached); only a
  shrink re-parses (reset).
- `advance(session)`: per tick for open sessions with SSE clients — read appended bytes of every
  known file, rescan `<sid>/subagents/` for new `agent-*.jsonl` / `.meta.json`, detect shrink →
  reset (bump `gen`). Returns new items and whether stats changed.
- Page queries: items for a scope, newest page first (`limit`, default 200; `before` = item
  position cursor). Scope `all` returns main items with `agent` items folded (their children are
  fetched with `scope=agent:<id>`); `main` returns main items with stats excluding subagents;
  `agent:<id>` returns that subagent's items and stats.

#### 2. Server wiring and flags

**File**: `scripts/wal-server.ts`

**Intent**: Route the new endpoints and drive session tailing from the existing 250 ms tick.

**Contract**:
- Flags: `--project=` (else `CLAUDE_PROJECT_DIR`, else cwd — same fallback as the WAL path) and
  `--projects-root=` (else `~/.claude/projects`), so tests never read the real home folder.
- `GET /sessions` → `{ root, project, sessions: SessionMeta[] }`.
- `GET /session?id&scope[&limit][&before]` → `SessionFirst` (no `before`) or `SessionPage`.
- `GET /item?id&uid&gen` → `ItemBody` (full tool input/result, text, thinking, meta body); 409 on
  stale `gen`, 404 on unknown uid, 400 on malformed id.
- `GET /session-stream?id&scope&after&gen` → SSE: `retry: 1000`, then `data: <SessionDelta>`
  frames (with `id: <head>`), `event: reset` when the session's `gen` changes; `Last-Event-ID`
  beats `after`, as in `/stream`.
- The tick advances only sessions that have stream clients, in the same try/catch as the WAL tick.

#### 3. Dev proxy

**File**: `vite.config.ts`

**Intent**: Proxy the four new paths to the dev API server.

**Contract**: add `/sessions`, `/session`, `/item`, `/session-stream` to `server.proxy`.

#### 4. Server test

**File**: `scripts/sessions.test.ts` (top-level script in the style of `live-tail.test.ts`)

**Intent**: Exercise endpoints and live tail against a temp copy of the fixture root.

**Contract**: spawn `wal-server.ts --port=<random> --file=<tmp wal> --project=/tmp/proj
--projects-root=<tmp copy>`; assert: list contains main + worktree sessions, not `-tmp-proj2`,
sorted by `last`, title = last `ai-title`; `/session` first page, `before` paging, all three scopes;
`/item` body, 409 on stale gen, 400 on `../` or non-uuid id; SSE: appending lines (including
completing the partial line) delivers items and updated stats; a new subagent file mid-session
appears in `agents`; truncating the main file sends `reset`.

### Success Criteria:

#### Automated Verification:

- Server test passes: `node scripts/sessions.test.ts`
- Full suite passes (existing WAL tests unaffected): `npm test`
- Type checks pass: `npm run check`

#### Manual Verification:

- `curl 'http://127.0.0.1:<port>/sessions'` against the real project lists this repo's sessions with sensible titles
- `curl '/session?id=<real id>&scope=all'` totals and per-model costs are plausible against the transcript's `cost-state` `totalCostUSD` / `modelUsage` (when present)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 3: Page shell — tabs, list, stats, scope

### Overview

Add the tab switch, the sessions list and the stats panel with the scope selector.

### Changes Required:

#### 1. Tabs

**File**: `web/src/App.tsx`, new `web/src/components/EventsTab.tsx`

**Intent**: Switch between the existing Events view and the new Sessions view; the inactive tab is
unmounted so its SSE stream closes.

**Contract**: `useStored('wal.tab', ['events', 'sessions'], 'events')`; the current Events body
(`useEvents` + `StatsHeader` + `FilterBar` + `EventTable`) moves into `EventsTab` unchanged, with
`filters`/`view`/`format`/`follow` state staying in `App` so it survives a tab switch. Header shows
the WAL path on Events and the projects folder on Sessions.

#### 2. Sessions data hooks

**File**: `web/src/useSessions.ts`, `web/src/useSession.ts`

**Intent**: Fetch the list; open a session for a scope, page older items, and follow the stream.

**Contract**: `useSessions()` → `{sessions, refresh, error}` (fetched on mount and on refresh).
`useSession(id, scope)` mirrors `useEvents`: `qgen` discards stale responses, `pending` holds live
items for the pill, `flush`, `loadOlder`, reset/409 → re-open.

#### 3. List, stats, scope

**File**: `web/src/components/SessionList.tsx`, `SessionStats.tsx`, `ScopeSelect.tsx`,
`web/src/lib/tokens.ts` (+ `tokens.test.ts`)

**Intent**: Render the metadata list (title, start, last activity, size, worktree badge; click to
select; Refresh button), the stats panel (totals, per agent, per model, estimated cost with
"estimated" label, recorded `cost-state` total when present) and the scope selector (Whole
session / Main only / each subagent by type + description).

**Contract**: `tokens.ts` exports token/size/USD/duration formatters (e.g. `1.2M`, `$0.43`, `—`
for `null`), unit-tested. New CSS for list rows, stat grid and token-type colours
(`--tok-input`, `--tok-output`, `--tok-cache-read`, `--tok-cache-write`, `--tok-thinking`) added
in all three theme blocks of `styles.css`.

### Success Criteria:

#### Automated Verification:

- Formatter tests pass: `node --test web/src/lib/tokens.test.ts`
- Type checks and build pass: `npm run check && npm run build`
- Full suite passes: `npm test`

#### Manual Verification:

- Tab choice survives a reload; Events tab behaves exactly as before (filters, tail, pill)
- Sessions list shows this repo's sessions, newest first, with titles
- Switching scope changes the stats; a subagent scope shows only that agent's numbers; cost shows "—" for an unpriced model
- Light and dark themes both readable

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 4: Conversation timeline

### Overview

Render the conversation for the selected scope, opened at the end, with folded items, nested
subagents and live appends.

### Changes Required:

#### 1. Shared viewer pane

**File**: `web/src/components/RecordViewer.tsx`

**Intent**: Export `Pane` so timeline bodies reuse the JSON/YAML/Raw viewer and click-built copy.

**Contract**: `export function Pane(...)`, signature unchanged.

#### 2. Timeline

**File**: `web/src/components/Timeline.tsx`, `TimelineItem.tsx`

**Intent**: Show items newest-last with "load earlier" on scroll-up keeping the visible rows
anchored (same technique as `EventTable`), follow mode at the bottom, and the "N new" pill for
live items when not following.

**Contract**:
- Every item folded to its one-line summary with kind icon/label, time, and — on a reply's first
  block — model and tokens (in/out/cache/thinking).
- Expanding fetches `/item` once and renders it in `Pane` using the global format; tool items show
  Request and Result panes (Result marked `bad` on `isError`).
- `agent` items (scope `all`) show type, description, and the subagent's totals; expanding loads a
  nested `Timeline` for `scope=agent:<id>` inside the row. The nested timeline is deliberately
  simpler than the top one: page scroll, the "N new" pill and follow mode belong to the top
  timeline only (all window-level — `EventTable.tsx:32,41`, fixed `.pill`), so the nested one pages
  with a "Load earlier" button and has no pill or follow. It has no stream of its own; when a
  parent `SessionDelta` shows that agent's `head` moved, it refetches its newest page.
- `compact` renders as a divider "Compacted (trigger): preTokens → postTokens"; `/clear` and other
  commands as command rows; `notification` and `meta` rows visually muted; `error` rows use
  `--status-critical`.
- Turn boundaries shown as a subtle separator with the turn number.

### Success Criteria:

#### Automated Verification:

- Type checks and build pass: `npm run check && npm run build`
- Full suite passes: `npm test`

#### Manual Verification:

- Opening a long real session lands at the end; scrolling up loads earlier items without the view jumping
- Expanding a 600 KB+ tool result stays responsive; Copy works
- A subagent nests at its spawn point and expands into its own conversation
- Compaction divider and `/clear` rows appear where expected
- In an active session, new items appear live (following) or behind the "N new" pill (scrolled up)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 5: Charts (uPlot)

### Overview

Add the three chart groups, driven by the scope's series and following the theme.

### Changes Required:

#### 1. Dependency

**File**: `package.json`, `package-lock.json`

**Intent**: Add uPlot (1.6.x) as a devDependency like every other package; import its CSS once.

**Contract**: `npm install -D uplot`.

#### 2. Chart components

**File**: `web/src/components/charts/UPlot.tsx`, `TokensOverTime.tsx`, `TurnBars.tsx`,
`ShareBars.tsx`, `web/src/lib/series.ts` (+ `series.test.ts`)

**Intent**: A thin React wrapper owning a uPlot instance (create on mount, `setData` on new series,
`setSize` via ResizeObserver, destroy on unmount, rebuild on theme change); three charts on top.

**Contract**:
- `series.ts` (pure, tested): builds uPlot-ready arrays — stacked cumulative input / output /
  cache read / cache write over time (thinking not added again), per-turn stacked bars, and
  share percentages by agent and by model.
- `TokensOverTime`: stacked areas (cumulative arrays + `bands`), vertical turn markers drawn in a
  `draw` hook, legend with values on hover.
- `TurnBars`: `uPlot.paths.bars` stacked by token type, one bar per turn.
- `ShareBars`: two stacked horizontal bars (by agent, by model) in plain HTML/CSS with a legend —
  no pie.
- Colours read from the `--tok-*` / agent palette CSS variables via `getComputedStyle`.

### Success Criteria:

#### Automated Verification:

- Series tests pass: `node --test web/src/lib/series.test.ts`
- Type checks and build pass: `npm run check && npm run build`
- Full suite passes: `npm test`

#### Manual Verification:

- Charts match the stats panel totals for each scope
- Turn markers line up with turn starts; hover shows values
- Theme toggle recolours charts without reload; resizing the window resizes charts
- Live session: charts grow as new replies land

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Phase 6: Verification, performance and docs

### Overview

Prove it on real data and big files, then document it.

### Changes Required:

#### 1. Benchmark

**File**: `scripts/bench-sessions.ts`, `package.json` (`bench` script runs both benches)

**Intent**: Generate a ~16 MB transcript (with a 650 KB line and a split multibyte character on a
read-chunk boundary) plus subagent files, and time the endpoints.

**Contract**: prints cold `/session` time, cached `/session` time, `/sessions` time for 300 files,
and per-tick advance time for a 1 MB append. Budgets: cold ≤ 1.5 s, cached ≤ 100 ms, list ≤ 500 ms.

#### 2. Launch and docs

**File**: `commands/wal.md`, `README.md`, `.ai/changes/wal-sessions-tab/change.md`

**Intent**: `/wal` passes `--project="$PWD"`; README gains a "Sessions" section (discovery rule incl.
worktrees, what the stats mean, cost is estimated from `scripts/pricing.json` and how to update it,
new endpoints and flags); `change.md` notes drop the stale "blocked" and "listed from the WAL"
lines.

**Contract**: README section names; `/wal` launch line.

### Success Criteria:

#### Automated Verification:

- Bench within budgets: `npm run bench`
- Full suite and types pass: `npm run check && npm test`
- `/wal` command file still valid: launch line contains `--project="$PWD"`

#### Manual Verification:

- `/wal` in this repo: open the current live session, watch this conversation appear in real time
- Estimated cost for a session with a `cost-state` entry is within a plausible range of the recorded total, per model and in total (Whole scope)
- Sessions from a worktree (create one under `.ai/worktrees/` and run a short session) appear with the worktree badge

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding.

---

## Testing Strategy

### Unit Tests:

- Parser/aggregator against the real-derived fixture (`scripts/transcripts.test.ts`): dedupe,
  synthetic exclusion, turn detection, subagent linking, compaction, tool errors, partial lines,
  multibyte chunk splits, cost with priced/unpriced models, ordering check.
- Pure page logic: `tokens.test.ts` (formatters), `series.test.ts` (chart arrays).

### Integration Tests:

- `scripts/sessions.test.ts`: discovery (incl. worktree, excluded sibling), paging, scopes, item
  fetch, path-safety 400s, stale-gen 409, SSE append/new-subagent/reset.

### Manual Testing Steps:

1. `/wal`, switch to Sessions, open the current session, confirm live updates.
2. Open the largest session of this repo; scroll to the top; expand the biggest tool result.
3. Switch scope Whole → Main → a subagent; confirm stats, charts and timeline follow.
4. Toggle theme; resize the window.
5. Compare estimated vs recorded cost on a session that has `cost-state`.

## Performance Considerations

Main transcripts reach 10 MB and subagent files 16 MB; a session is parsed once and then advanced
incrementally, with at most 3 sessions held in memory. The list never parses whole files (stat +
head + 256 KB tail). The browser receives only one page of item summaries plus stats/series;
full bodies come from `/item` on expand.

## Migration Notes

None: no stored data changes. `wal.tab` defaults to `events`, so the page opens as before.

## References

- Brainstorm decisions: `.ai/changes/wal-sessions-tab/change.md`
- Prior port (conventions, constraints): `.ai/archive/2026-09-30-wal-observer-ts-react/plan.md`
- Server patterns: `agents/plugins/wal-observer/scripts/wal-server.ts:290-393`
- Viewer pane: `agents/plugins/wal-observer/web/src/components/RecordViewer.tsx:6`
- Pill / load older: `agents/plugins/wal-observer/web/src/components/EventTable.tsx:28,57,87`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fixture, parser and pricing (pure logic)

#### Automated

- [x] 1.1 Extractor regenerates the fixture with no missing edge classes
- [x] 1.2 Fixture contains no original text
- [x] 1.3 Parser tests pass
- [x] 1.4 Type checks pass

#### Manual

- [x] 1.5 Fixture diff shows only placeholders, structure intact
- [x] 1.6 pricing.json matches the official pricing page

### Phase 2: Server — discovery, endpoints, live tail

#### Automated

- [x] 2.1 Server test passes
- [x] 2.2 Full suite passes
- [x] 2.3 Type checks pass

#### Manual

- [x] 2.4 /sessions lists this repo's sessions with sensible titles
- [x] 2.5 /session totals plausible against cost-state

### Phase 3: Page shell — tabs, list, stats, scope

#### Automated

- [x] 3.1 Formatter tests pass
- [x] 3.2 Type checks and build pass
- [x] 3.3 Full suite passes

#### Manual

- [x] 3.4 Tab persists and Events tab unchanged
- [x] 3.5 Sessions list newest first with titles
- [x] 3.6 Scope switch changes stats; unpriced model shows —
- [x] 3.7 Both themes readable

### Phase 4: Conversation timeline

#### Automated

- [x] 4.1 Type checks and build pass
- [x] 4.2 Full suite passes

#### Manual

- [x] 4.3 Opens at end; load earlier without jumping
- [x] 4.4 Large tool result stays responsive; Copy works
- [x] 4.5 Subagent nests at spawn point and expands
- [x] 4.6 Compaction divider and /clear rows appear
- [x] 4.7 Live items follow or go behind the N new pill

### Phase 5: Charts (uPlot)

#### Automated

- [x] 5.1 Series tests pass
- [x] 5.2 Type checks and build pass
- [x] 5.3 Full suite passes

#### Manual

- [x] 5.4 Charts match stats totals per scope
- [x] 5.5 Turn markers align; hover shows values
- [x] 5.6 Theme toggle and resize recolour/resize charts
- [x] 5.7 Live session charts grow

### Phase 6: Verification, performance and docs

#### Automated

- [x] 6.1 Bench within budgets
- [x] 6.2 Full suite and types pass
- [x] 6.3 /wal passes --project

#### Manual

- [x] 6.4 Live current session in /wal
- [x] 6.5 Estimated vs recorded cost plausible
- [x] 6.6 Worktree session appears with badge
