# Persist session pick, trash sessions, All/None/Not filters — Implementation Plan

## Overview

Three capabilities for the WAL viewer: (1) the session pick survives a refresh and is shared across
tabs; (2) sessions can be moved to a per-source trash from the sidebar (picked or filtered), then
restored or deleted for good from a new Trash tab; (3) every chip filter section — category, tool,
event and agent in the Events filter panel, and the source/workspace chips in the sidebar — gets
All / None / Not controls, with Not excluding the ticked values.

## Current State Analysis

- **Pick**: in-memory `useState<string[] | null>(null)` in `usePick` (`web/src/usePick.ts:9-36`);
  `null` means "just opened / loading" and `settlePick` then picks the newest session
  (`web/src/lib/pick.ts:18-22`). An empty pick means all sessions. The 2026-10-09 session-picker change
  removed a persisted `wal.pick` on purpose because cross-tab sync re-picked the newest session
  (`.ai/archive/2026-10-09-wal-session-picker/todo-board.md:7,20`). This change reintroduces
  persistence *with* sync, at the user's explicit request, so it must avoid that failure mode.
- **Filters**: `Filters` (`web/src/lib/params.ts:5-19`) are opt-in sets — empty sends no param, which
  the server reads as no filter. One `matcher` (`scripts/wal-index.ts:465-493`) serves both `/events`
  and `/events-stream`; `list()` (`:335`) treats present-but-empty as "nothing allowed". Agent tokens
  are session-scoped and matched by `agentMatch` (`:433-463`), which returns false for a session with
  no token. Facets are independent of filters (`:595-611`). McpPanel already has Select all /
  Deselect all (`web/src/components/McpPanel.tsx:71-78`); there is no "None" state anywhere.
- **Sidebar chips**: source labels and workspace names share one set, OR-matched, AND-ed with project
  and text (`web/src/lib/sidebar.ts:22-31`). The filtered rows are `rows` in `Sidebar.tsx:46`
  (picked rows included).
- **Server**: one synchronous `handle()` with an `if (url.pathname === …)` chain
  (`scripts/wal-server.ts:181-307`); GET-only in practice, never checks method, Host or Origin; binds
  `127.0.0.1`, port 7878 (+up to 10) or `--port`. No body parsing exists.
- **Discovery**: `walk()` lists `<projectsDir>/<slug>/*.jsonl` and fills `where: Map<id, Found{id,
  source, slug, dir}>` (`scripts/discovery.ts:160-200`); ids only become paths through that listing.
  `Source = {label, projectsDir}` where `projectsDir` is a realpath; the config dir is its parent.
  `live` = written in the last `LIVE_MS` (2 min) and not ended (`:17`, `:339`). `locate(id)` returns
  only `dir`.
- **Caches after files vanish**: the WAL index of a removed session stays in `createIndexes`' LRU as an
  empty index and is not reported `unknown` (`scripts/wal-index.ts:303-330`); `store` drops a session
  whose transcript is gone (`scripts/sessions.ts:107-115`). No fs watchers, no long-lived fds.
- **UI**: tabs `['events','sessions']` in `App.tsx:15`, persisted as `wal.tab`; the `Tab` type is
  duplicated in `Sidebar.tsx:11`. No dialog component exists. Fetches are bare `fetch` with
  `if (!res.ok) throw`. `useSessions` exposes `refresh`.
- **Tests**: `node:test` on pure helpers in `web/src/lib/*.test.ts`; server tests spawn
  `scripts/wal-server.ts --port=0` via `scripts/test-server.ts` with `HOME` set to a `mkdtemp` dir.
  `npm test`, `npm run check`, `npm run lint`.

## Desired End State

- Refreshing the page restores the sessions that were picked; picking in one tab updates every open
  tab; a pick whose sessions are all gone falls back to the newest session, never to "all sessions".
- Each chip section in the filter panel has All, None and Not. With Not on, the section's ticked values
  are excluded server-side (`<field>_not`), so a value first seen live is included. The head summary
  reads e.g. `tool: ≠2`. The sidebar's source/workspace chips get the same three controls.
- The sidebar offers **Delete picked** and **Delete N filtered**. A confirm dialog lists what goes and
  what is skipped as live. Sessions move to `<config>/wal-trash/<YYYY-MM-DD>/<project-slug>/` and leave
  the list. A **Trash** tab lists trashed sessions across sources with Restore, Delete forever and
  Empty trash (the last two need a typed `yes`).
- Every write endpoint rejects requests not made by the viewer's own page.
- README documents all of it; version is 0.4.0.

### Key Discoveries:

- Prior decision reversed: `.ai/archive/2026-10-09-wal-session-picker/units/1.1.md:13,37` — the sync
  bug came from pruning/re-picking being written back to storage (see Critical Implementation Details).
- `matcher` is the single filter point for list and stream — `scripts/wal-index.ts:465`; negation goes
  there and nowhere else.
- `agentMatch` returning false for a session with no token (`scripts/wal-index.ts:450`) is right for
  include and wrong for exclude: a negated session with no token must be kept.
- `discovery.where` holds `Found.slug` (raw folder name, worktree suffix included) — the trash path must
  use it, not `SessionMeta.project.slug` (worktree suffix stripped, `discovery.ts:327-331`).
- Index LRU keeps a removed session's index — `scripts/wal-index.ts:312-320`; trash must evict it.
- Destructive precedent: `wal legacy` delete needs a typed `yes` (`README.md:85`).

## What We're NOT Doing

- No persistence of filter values (prior decision: filters stay unpersisted); only the pick persists.
- No hard delete from the sidebar — deleting from the sidebar always moves to trash; only the Trash
  tab deletes for good.
- No automatic trash retention / expiry, no OS (freedesktop) trash integration.
- No automatic repair of files left suffixed by a crash mid-move; README documents how to fix by hand.
- No cross-filesystem copy fallback: a rename that fails with `EXDEV` reports `failed` and rolls back.
- No Host/Origin hardening of the existing GET routes (out of scope; noted as a risk).
- No tri-state (include/exclude per chip) filters — Not is per section.
- No publishing; only the version bump.

## Implementation Approach

Client-only pieces first (pick, filter controls), so they land and get used while the riskier server
writes are built. The server trash work is one phase with integration tests on temp HOME dirs before
any UI calls it. Pure logic lives in `web/src/lib/` (tested with `node:test`); components stay thin.
Server moves use a two-step rename (suffix in place, then move and strip) so a session is never
listed half-moved, and every step is undone on failure.

## Critical Implementation Details

**State sequencing — pick persistence.** The earlier sync bug was derived state being written back
to storage. Keep two layers: the *wanted* pick (what storage holds and tabs share) and the *effective*
pick (wanted minus ids this tab does not list or a stream reported unknown, recomputed whenever the
list changes). Storage is written **only** on user intent — toggle, Clear all, and removing trashed
ids after a trash — never by pruning, `forget`, the newest-session fallback or adopting another tab's
value. An id another tab just picked but this tab's 5 s-old list does not have yet then reappears when
the list catches up instead of being pruned away for good. When wanted is non-empty and effective is
empty, the tab shows the newest session, frozen until wanted changes (no flicker as `last` moves), and
writes nothing. A toggle always starts from what is shown (the effective pick, or the fallback) and
writes the result, so dead ids leave storage on the next user action and unpicking the last shown
session gives `[]` (all sessions), not the fallback. The cost: an id another tab picked that this tab
does not list yet is dropped if the user toggles in that ≤5 s window. Nothing stored (or an
invalid value) behaves as today; a stored `[]` restores as all sessions. `pick` stays `null` until the
first `/sessions` lands, so no query runs for all sessions before restore.

**Timing & lifecycle — async POST in a sync router.** `handle()` is synchronous and its caller's
try/catch only sees synchronous throws (`wal-server.ts:309-317`). The POST handlers read the body
asynchronously and must catch their own errors and answer 500, or a rejected promise escapes.

**State sequencing — move order.** Discovery lists a session by its transcript, so the transcript is
the commit point. Trash: rename in place with suffix `.wal-trash` — transcript **first** (the session
leaves the listing at once), then WAL, then `<id>/`; move the suffixed pieces into the trash dir; strip
the suffixes — WAL and dir first, transcript **last** (the trash entry appears complete). Any failure
undoes the completed steps in reverse. Restore mirrors it with suffix `.wal-restore`. Listings in both
places ignore suffixed names.

## Phase 1: Persist the session pick

### Overview

Restore the pick on refresh and share it across tabs without reintroducing the re-pick bug.

### Changes Required:

#### 1. Pick rules

**File**: `web/src/lib/pick.ts`, `web/src/lib/pick.test.ts`

**Intent**: Express the wanted → effective derivation and the stored-value check as pure functions so
the rules in Critical Implementation Details are unit-tested.

**Contract**: a validator for a stored pick (array of session-id strings, deduped); an `effective`
function of `(wanted | null, sessions, gone, fallback)` returning the ids to show — `null` wanted →
newest, `[]` → `[]`, non-empty that prunes to empty → the frozen fallback (newest at the moment it
emptied). Existing `settlePick`/`prune` callers keep working or are replaced.

#### 2. usePick

**File**: `web/src/usePick.ts`

**Intent**: Hold the wanted pick in localStorage key `wal.pick`, adopt other tabs' writes via the
`storage` event, derive the effective pick, and write only on user intent.

**Contract**: return shape `{ pick, toggle, clear, forget }` unchanged, plus a `drop(ids)` used after a
trash (user intent: removes ids from wanted and writes). `forget` only adds to the local gone set.
`useStoredJson` cannot be reused as-is (it writes on mount and its fallback cannot be "absent"); either
extend it with an opt-out of the mount write or keep the storage code local to `usePick`, whichever
keeps the diff smaller.

#### 3. Docs

**File**: `README.md` (The page → Sidebar)

**Intent**: Replace "The page opens with the most recently active session picked" with the restore,
sync and fallback rules.

### Success Criteria:

#### Automated Verification:

- Pick rule tests pass: `node --test web/src/lib/pick.test.ts`
- Full suite passes: `npm test`
- Types check: `npm run check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Pick two sessions, refresh: the same two are picked
- Two tabs: picking in one updates the other; neither tab's pick jumps to the newest session on its own
- Clear all, refresh: all sessions stays selected (empty pick)
- Pick a session, remove its files on disk, refresh: the newest session is picked, not all sessions

**Implementation Note**: After automated verification passes, pause for manual confirmation before
the next phase.

---

## Phase 2: All / None / Not on the Events filter panel

### Overview

Per-section bulk controls and server-side exclusion for category, tool, event and agent.

### Changes Required:

#### 1. Server negation

**File**: `scripts/wal-index.ts`

**Intent**: Read `cat_not`, `tool_not`, `event_not`, `agent_not` next to the existing params and
exclude rows whose value is in them; the stream and the list share it automatically through `matcher`.

**Contract**: a section sends either `<field>` or `<field>_not`, never both (if both arrive, both
apply). `tool_not` uses the same `'-'` no-tool bucket. `agent_not` excludes rows the tokens match; a
session with no `agent_not` token keeps all its rows (the inverse of `agentMatch`'s
false-for-no-token). Unparseable agent tokens → no filter, as today. An empty `<field>_not` excludes
nothing.

**File**: `scripts/query.test.ts`, `scripts/live-tail.test.ts`

**Intent**: In `query.test.ts`, cover each `_not` param on `/events`, `tool_not=-`, and `agent_not`
with two sessions where only one has a token. In `live-tail.test.ts` (where `/events-stream` tests
live), one stream case showing a row with a value absent at open time passes a `tool_not` filter.

#### 2. Client filter model

**File**: `web/src/lib/params.ts`, `web/src/lib/params.test.ts`

**Intent**: Add the per-section Not flag and send it.

**Contract**: `Filters.not: ReadonlySet<'cat' | 'tool' | 'event' | 'agent'>`, empty in
`EMPTY_FILTERS` (so Reset clears it). `buildParams` sends a Not section's set under `<field>_not`.
`filterSummary` renders a Not section as `tool: ≠2` (agent: `agent: ≠<selection>`). `pruneFilters`
keeps `not`; `sameRows` stays correct (a Not set emptied by pruning changes rows too).

#### 3. Agent "All"

**File**: `web/src/lib/agents.ts`, `web/src/lib/agents.test.ts`

**Intent**: A helper that ticks every node of the picker tree, reusing the private `ticked`/`compress`
logic, so All on the agent section yields the compressed full selection.

**Contract**: `selectAll(tree): Set<string>` equal to toggling every top-level node on.

#### 4. Panel controls

**File**: `web/src/components/FilterPanel.tsx`, `web/src/components/AgentPicker.tsx`,
`web/src/styles.css`

**Intent**: Each of the four sections gets All (tick every offered value; tool includes `(no tool)`
and MCP tools), None (clear) and a Not toggle (`aria-pressed`) in a small row under the heading,
styled like McpPanel's `.acts` ghost buttons. Not is disabled while nothing is ticked. Chips of a Not
section read as excluded (e.g. struck through) so the state is visible without the toggle.

**Contract**: section setters go through `setFilters`; no new state outside `Filters`. The Agent
section's existing "All agents" clear button becomes None (one control per meaning).

#### 5. Docs

**File**: `README.md` (The page → Events, filter paragraph)

**Intent**: Describe All / None / Not and the `≠` summary. State that All pins the values offered now
(a value first seen later is filtered out — use None or Not for "everything"), and that All with Not
excludes every offered value.

### Success Criteria:

#### Automated Verification:

- Server negation tests pass: `node --test scripts/query.test.ts scripts/live-tail.test.ts`
- Client helper tests pass: `node --test web/src/lib/params.test.ts web/src/lib/agents.test.ts`
- Full suite passes: `npm test`
- Types check: `npm run check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Tool → Not with Read and Grep ticked: no Read/Grep rows; summary shows `tool: ≠2`
- Live tail with a Not tool filter keeps showing rows of a tool that first appears after opening
- All then None returns to unfiltered; Reset clears Not flags
- Agent All / None / Not behave the same across a two-session pick
- Tool All on a live session, then a new tool appears: its rows are filtered out (as documented)

**Implementation Note**: After automated verification passes, pause for manual confirmation before
the next phase.

---

## Phase 3: All / None / Not on the sidebar chips

### Overview

The same controls for the source/workspace chip set in the sidebar.

### Changes Required:

#### 1. Sidebar filter rule

**File**: `web/src/lib/sidebar.ts`, `web/src/lib/sidebar.test.ts`

**Intent**: Add a negation flag to `SidebarFilter`: with it on, a row passes when its source and none
of its workspaces are among the chips.

**Contract**: `SidebarFilter.not: boolean`; `filterRows` and `sidebarSummary` honour it (summary marks
the negated chips, e.g. `≠ default, work`). Empty chips mean no filter either way.

#### 2. Sidebar controls

**File**: `web/src/components/Sidebar.tsx`

**Intent**: All / None / Not next to the chips in `.sb-chips`, same look as Phase 2.

#### 3. Docs

**File**: `README.md` (The page → Sidebar)

### Success Criteria:

#### Automated Verification:

- Sidebar rule tests pass: `node --test web/src/lib/sidebar.test.ts`
- Full suite passes: `npm test`
- Types check: `npm run check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Not with `default` ticked hides sessions from the default source and from the default workspace
- All / None tick and untick every chip

**Implementation Note**: After automated verification passes, pause for manual confirmation before
the next phase.

---

## Phase 4: Trash on the server

### Overview

Write endpoints for trash, restore and purge, guarded against cross-site requests, plus the trash
listing.

### Changes Required:

#### 1. Shared types

**File**: `shared/api.ts`

**Contract**:
- `TrashRef { source: string; date: string; slug: string; id: string }` identifies a trashed session.
- `TrashEntry extends TrashRef { title: string; cwd: string | null; size: number }` (title and cwd read
  the same way discovery reads them, from the trashed transcript).
- `TrashResult { id: string; status: 'ok' | 'live' | 'conflict' | 'unknown' | 'failed'; reason?: string }`.
- `SessionMeta.busy: boolean` — `live`, or a WAL whose last event is not `SessionEnd` and `last`
  within the past 24 h (`OPEN_MS`, next to `LIVE_MS` in `discovery.ts`). A session idle at the prompt
  is not `live` but still open in Claude, which would recreate `<id>.jsonl` / `<id>.wal.jsonl` as a
  fragment after a trash. Sessions without a WAL fall back to `live`.

#### 2. Trash module

**File**: `scripts/trash.ts` (new), `scripts/trash.test.ts` (new)

**Intent**: All filesystem work for trash, restore, purge and listing, kept out of the router.

**Contract**:
- Trash dir per source: `dirname(projectsDir)/wal-trash/<YYYY-MM-DD>/<Found.slug>/`, holding
  `<id>.jsonl`, `<id>.wal.jsonl` (if any) and `<id>/` (if any). Date in local time.
- `trash(ids)`: each id must be located by discovery (else `unknown`) and not live at that moment
  — checked as `busy` (else `live`, `reason: 'not ended'` when only the 24 h rule hit); a name already taken in the target dir → `conflict`; then the suffix-in-place,
  move, strip sequence in Critical Implementation Details. Errors (including `EXDEV`) → roll back
  completed steps, `failed` with the reason.
- `restore(refs)`: each ref must match an entry of the current listing (else `unknown`); if discovery
  locates the id in any source, or any target name exists in `<projectsDir>/<slug>/` → `conflict`;
  recreates `<slug>/` if missing; mirror sequence with `.wal-restore`.
- `purge(refs | 'all')`: recursive removal of the entry's pieces, then removal of now-empty
  `<slug>/` and `<date>/` dirs. Never touches suffixed leftovers.
- `list()`: entries across all sources, newest date first; suffixed names ignored.
- Paths are only ever built from discovery's `Found` and the trash listing, never from request strings.
- Ids are processed independently; one failure never stops the batch.

#### 3. Cache eviction

**File**: `scripts/wal-index.ts`, `scripts/sessions.ts`, `scripts/discovery.ts`

**Intent**: After a trash, the session must read as unknown everywhere: drop its WAL index, store
entry and discovery caches (`heads`, `wals`), and expose discovery's `Found` (source, slug, dir) for
the trash module.

**Contract**: `indexes.drop(id)`, `store.drop(id)` (or equivalent), a discovery accessor returning
`Found` plus live state for one id without a full `list()` if practical. `acquire` serves an open
index without `locate` and reads a missing file as empty (`wal-index.ts:206,314-316`), and the LRU
skips busy ids, so `drop` must also remove busy/requested entries; the next `acquire` (including a
stream's tick) then resolves through `locate` and reports the id unknown. Discovery drops the `heads`
and `wals` entries for the moved paths (`heads` is otherwise never evicted, `discovery.ts:211`).

#### 4. Routes and guard

**File**: `scripts/wal-server.ts`

**Intent**: Wire the endpoints and the same-origin guard.

**Contract**:
- `GET /trash` → `{ entries: TrashEntry[] }`.
- `POST /trash` `{ ids: string[] }`, `POST /trash/restore` `{ refs: TrashRef[] }`,
  `POST /trash/purge` `{ refs: TrashRef[] } | { all: true }` → `{ results: TrashResult[] }`.
- Guard on every POST: method must be POST (else 405); `content-type` media type (before `;`,
  case-insensitive) `application/json` (a cross-site form can't set it without a preflight the server
  never answers); `Host` must be `127.0.0.1:<port>` or `localhost:<port>` with `<port>` =
  `req.socket.localPort` (`handle()` never sees the bound port, which may be 7878+n or ephemeral)
  (DNS rebinding); `Origin` must equal `http://<Host>`; `Sec-Fetch-Site`, when
  sent, must be `same-origin`. Any failure → 403. Body over 1 MB → 413; bad JSON or shape → 400.
- Ids validated with `validId`; a bad id → 400 for the whole request.

**File**: `vite.config.ts`

**Intent**: Keep `npm run dev` working behind the guard: the shorthand proxy forwards the browser's
`Host`/`Origin` (`localhost:5173`), which the guard rejects.

**Contract**: a `/trash` proxy entry (prefix covers `/trash/restore`, `/trash/purge`) as an object
with `target: api`, `changeOrigin: true` and `headers: { origin: api }`, so proxied POSTs arrive
same-origin. The server guard has no dev special case.

#### 5. Server tests

**File**: `scripts/trash.test.ts`

**Intent**: Integration tests through `startServer` on a temp HOME: trash moves all three pieces and
the session leaves `/sessions` and reads `unknown` on `/events`; a live session (fresh mtime) is
skipped; a session idle >2 min whose WAL does not end with `SessionEnd` is skipped as `not ended`; a name clash in trash → `conflict`; a forced failure mid-move (e.g. read-only target dir)
rolls back so the session is still listed with all pieces; an `/events-stream` open on the session
while it is trashed reports it unknown; restore brings it back and `/sessions`
lists it; restore with the id present → `conflict`; purge one and all; `/trash` lists across two
sources and ignores suffixed files. Guard: missing or foreign `Origin`, wrong `Host`,
`Sec-Fetch-Site: cross-site`, `text/plain` body and GET on a POST route are each rejected (use
`node:http` `request` to set headers).

#### 6. Docs

**File**: `README.md` (Running — the 127.0.0.1 paragraph; new "Trash" section)

**Intent**: State that the server now has write endpoints and how they are guarded; document the
trash layout, the suffixes, and how to fix a session left as `*.wal-trash` / `*.wal-restore` by a
crash (strip the suffix by hand).

### Success Criteria:

#### Automated Verification:

- Trash tests pass: `node --test scripts/trash.test.ts`
- Full suite passes: `npm test`
- Types check: `npm run check`
- Lint passes: `npm run lint`

#### Manual Verification:

- `curl -X POST` to `/trash` with no Origin is rejected with 403
- A session trashed with curl from the page's origin shows up under `~/.claude/wal-trash/<date>/<slug>/`
  and `claude --resume` no longer offers it

**Implementation Note**: After automated verification passes, pause for manual confirmation before
the next phase.

---

## Phase 5: Trash UI

### Overview

Delete actions in the sidebar, a confirm dialog, and the Trash tab.

### Changes Required:

#### 1. Client helpers

**File**: `web/src/lib/trash.ts` (new), `web/src/lib/trash.test.ts` (new)

**Intent**: Pure helpers: split a candidate set into movable and skipped (by `busy`; label `live` or
`not ended`), and summarise `TrashResult[]`
into one line (`3 moved · 1 live skipped · 1 conflict`).

#### 2. Confirm dialog

**File**: `web/src/components/ConfirmDialog.tsx` (new), `web/src/styles.css`

**Intent**: A modal on the native `<dialog>` (`showModal`, Escape cancels) listing the count and
session names (scrollable), the busy ones marked as skipped (`live` / `not ended`), with Cancel and a confirm button;
an optional typed-`yes` field that keeps the confirm button disabled until it matches.

#### 3. Sidebar actions

**File**: `web/src/components/Sidebar.tsx`, `web/src/App.tsx`

**Intent**: **Delete picked** (by the picked chips / Clear all) and **Delete N filtered** (by the count
line; always shown; N = `rows.length`, the `filterRows(...)` result in `Sidebar.tsx:46` — picked rows
that match count, picked rows pinned on top without matching do not). The dialog lists exactly that
set. Both open the dialog,
then `POST /trash`, show the result summary, call `usePick().drop` with the moved ids and
`useSessions().refresh`.

#### 4. Trash tab

**File**: `web/src/components/TrashTab.tsx` (new), `web/src/useTrash.ts` (new), `web/src/App.tsx`,
`web/src/components/Sidebar.tsx`

**Intent**: Third tab `trash` (in `TABS`, the tab switch, the `h1`, the shared `Tab` type). A table
of entries — name, project, source, trashed date, size — with row checkboxes, per-row Restore and
Delete forever, bulk Restore selected / Delete selected, and Empty trash. Delete forever and Empty use
the dialog with typed `yes`. The list loads on opening the tab and after each action; restore also
refreshes sessions. Results show as the summary line, conflicts named.

#### 5. Docs

**File**: `README.md` (The page → Sidebar; new Trash tab bullet; Trash section from Phase 4)

### Success Criteria:

#### Automated Verification:

- Helper tests pass: `node --test web/src/lib/trash.test.ts`
- Full suite passes: `npm test`
- Types check: `npm run check`
- Lint passes: `npm run lint`

#### Manual Verification:

- Delete picked: dialog lists them; after confirm they leave the sidebar and the pick; the newest
  session is picked if the pick emptied
- Delete N filtered with a project filter moves only that project's idle sessions; live ones are
  reported skipped
- Trash tab lists them; Restore brings one back to the sidebar; a second restore of the same id
  reports a conflict
- Delete forever and Empty trash stay disabled until `yes` is typed; files are gone from disk afterwards
- Playwright pass over the above in light and dark theme

**Implementation Note**: After automated verification passes, pause for manual confirmation before
the next phase.

---

## Phase 6: Release 0.4.0

### Overview

Final docs pass and version bump.

### Changes Required:

#### 1. Version

**File**: `package.json`, `package-lock.json`

**Intent**: Bump to 0.4.0 (the hook plugin is unchanged, so `plugin.json` keeps its version).

#### 2. README pass

**File**: `README.md`

**Intent**: Read the touched sections end to end for consistency with the shipped behaviour.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`
- Lint passes: `npm run lint`
- Package builds: `npm run build:dist`

---

## Testing Strategy

### Unit Tests:

- Pick: stored-value validation; null / `[]` / pruned-to-empty / partially pruned; fallback frozen
  while `last` changes; unpicking the last shown session with a dead id in wanted → `[]`; adopting a pick with an id not yet listed keeps it for later.
- Params: `_not` params built per section; summary `≠`; prune keeps `not`; `sameRows` with Not.
- Agents: `selectAll` equals ticking every top node.
- Sidebar: chip negation over source and workspaces; summary.
- Trash helpers: live split, result summary.

### Integration Tests:

- `_not` params on `/events` and the stream (Phase 2).
- Trash, restore, purge, listing, live skip, conflicts, rollback and the origin guard (Phase 4).

### Manual Testing Steps:

1. Pick two sessions in tab A, open tab B: same pick; refresh B: same pick.
2. Filter Tool → Not {Read}; start a tool in a live session; its rows appear.
3. Sidebar Not on a workspace chip; Delete N filtered; confirm; check the trash dir on disk.
4. Trash tab: restore one, purge one with `yes`, Empty trash.

## Performance Considerations

`_not` checks are set lookups in the existing matcher, same cost as today. `GET /trash` walks only the
trash dirs and reads each transcript's head for the title; trash is expected to hold tens to hundreds
of sessions, fetched on tab open, not polled.

## Migration Notes

None. No stored `wal.pick` exists today, so the first load behaves as before. Trash dirs are created on
first use.

## References

- Prior pick decision: `.ai/archive/2026-10-09-wal-session-picker/units/1.1.md`
- Filter panel change: `.ai/archive/2026-10-09-wal-filter-panel/plan.md`
- Matcher: `scripts/wal-index.ts:465`
- Discovery walk: `scripts/discovery.ts:160-200`
- Bulk select pattern: `web/src/components/McpPanel.tsx:71-78`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Persist the session pick

#### Automated

- [x] 1.1 Pick rule tests pass
- [x] 1.2 Full suite passes
- [x] 1.3 Types check
- [x] 1.4 Lint passes

#### Manual

- [x] 1.5 Pick two sessions, refresh: the same two are picked
- [x] 1.6 Two tabs stay in sync without jumping to the newest session
- [x] 1.7 Clear all, refresh: empty pick stays
- [x] 1.8 Pick with removed files falls back to newest, not all sessions

### Phase 2: All / None / Not on the Events filter panel

#### Automated

- [x] 2.1 Server negation tests pass
- [x] 2.2 Client helper tests pass
- [x] 2.3 Full suite passes
- [x] 2.4 Types check
- [x] 2.5 Lint passes

#### Manual

- [x] 2.6 Tool Not excludes ticked tools and shows `≠2`
- [x] 2.7 Live tail keeps rows of a tool first seen after opening
- [x] 2.8 All then None returns to unfiltered; Reset clears Not
- [x] 2.9 Agent All / None / Not across a two-session pick
- [x] 2.10 Tool All hides a tool first seen live, as documented

### Phase 3: All / None / Not on the sidebar chips

#### Automated

- [x] 3.1 Sidebar rule tests pass
- [x] 3.2 Full suite passes
- [x] 3.3 Types check
- [x] 3.4 Lint passes

#### Manual

- [x] 3.5 Not on `default` hides default source and workspace sessions
- [x] 3.6 All / None tick and untick every chip

### Phase 4: Trash on the server

#### Automated

- [x] 4.1 Trash tests pass
- [x] 4.2 Full suite passes
- [x] 4.3 Types check
- [x] 4.4 Lint passes

#### Manual

- [x] 4.5 POST without Origin is rejected with 403
- [x] 4.6 Trashed session lands in wal-trash and leaves `claude --resume`

### Phase 5: Trash UI

#### Automated

- [x] 5.1 Helper tests pass
- [x] 5.2 Full suite passes
- [x] 5.3 Types check
- [x] 5.4 Lint passes

#### Manual

- [x] 5.5 Delete picked removes them from sidebar and pick
- [x] 5.6 Delete N filtered moves only matching idle sessions
- [x] 5.7 Restore works; second restore reports conflict
- [x] 5.8 Delete forever and Empty need typed yes and remove files
- [x] 5.9 Playwright pass in light and dark theme

### Phase 6: Release 0.4.0

#### Automated

- [x] 6.1 Full suite passes
- [x] 6.2 Lint passes
- [x] 6.3 Package builds
