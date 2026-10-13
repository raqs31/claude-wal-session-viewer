# WAL viewer — server-side query, date column, infinite scroll — Implementation Plan

## Overview

The wal-observer viewer shows event time without the date, and loads the whole WAL into the browser
tab as one snapshot. This change adds a byte-accurate in-memory index on the server, a filtered
query and paging API, and a per-client filtered live stream. It then rebuilds the page with Date
and Time columns, the full filter bar, infinite scroll in both directions, rows whose detail is
fetched on click, and Table/Tail view modes with auto-follow and a "N new" pill. Approved design:
`change.md` → "Approved design (2026-09-29)".

## Current State Analysis

- `agents/plugins/wal-observer/scripts/wal-server.mjs` (115 lines) exposes three routes:
  - `/` serves the page.
  - `/events` returns every parsed record plus the byte `offset`.
  - `/stream?from=<offset>` is an SSE stream; one 250 ms interval tails the file separately for
    each client.
- `readSince` (`wal-server.mjs:35`) allocates one buffer for the whole remaining file, then splits
  the **decoded string**. That is fine for streaming, but it cannot produce byte offsets.
- `scripts/index.html` (268 lines):
  - keeps every record in `all[]`, filters on the client (`matches`, line 172) and rebuilds the
    DOM for every match on each keystroke and each live event (`render`, line 196);
  - shows time only (`fmtTime`, line 169);
  - holds the category map `OF`/`catOf` on the client (lines 152–159).
- `scripts/live-tail.test.mjs` (91 lines) is a dependency-free Node script with a `check()` helper,
  a random port and a spawned server. It proves four things: an append reaches the client, a split
  write arrives once, resuming at the offset doesn't replay, and truncation resets.
- `hooks/wal-hook.mjs` writes one JSON line per event. `ts` is ISO UTC. The promoted fields are
  `event`, `session_id`, `tool_name`, `duration_ms` and others. A line can be up to `MAX_LINE` =
  96 000 chars, so a page of 200 full records can reach about 19 MB.
- `commands/wal.md` only launches the server with `$ARGUMENTS`, so it needs no change.

## Desired End State

- Every row shows a local Date (`2026-09-29`) and Time (`13:43:05.123`).
- The browser holds only the rows it has shown, as small summaries. The full record is fetched
  when a row is opened.
- Filters run on the server: text, session, category, tool multi-select with `(no tool)`, date
  from/to, an every-day time window that can wrap past midnight, and duration ≥/≤ with a
  no-duration include/exclude switch (default exclude).
- Pages are 200 rows. Tail mode (the default, remembered) puts oldest at the top, appends new rows
  at the bottom, and loads older pages when you scroll up. Table mode is newest first and loads
  older pages when you scroll down.
- Live follow is on by default. It pauses automatically when you scroll away from the newest edge,
  and held rows show as a "N new" pill.
- Verify with: `node scripts/query.test.mjs`, `node scripts/live-tail.test.mjs` and
  `node scripts/bench.mjs` all pass, plus the manual browser checks in each phase.

### Key Discoveries:

- `wal-server.mjs:53` splits `cursor.carry + buf.toString('utf8')`. Offsets must come from
  splitting the **Buffer** on `0x0A`, or multibyte text shifts every later offset.
- `wal-server.mjs:45` does `Buffer.alloc(size - cursor.offset)`, which reads the whole file into
  one buffer at startup. It must read in fixed chunks instead.
- `wal-server.mjs:23` shows the existing fallback for a line that isn't valid JSON: it becomes
  `Unparseable` with `ts = now`. The index keeps that behaviour.
- `index.html:143` warns that record strings come from tool output: always use `textContent`,
  never `innerHTML`. That still applies.
- `live-tail.test.mjs` is the test pattern to copy: spawn the server with `--port --file`, an
  `until()` readiness poll, `check()`, and exit code = failure.

## What We're NOT Doing

- Saving filters in the URL or localStorage. Only the view mode is saved.
- String interning or other index memory tricks beyond the design.
- A cache of text-search results. Every `q` query rescans. The bench will show whether that's a
  problem.
- New config knobs, CLI flags or environment variables.
- Changes to `hooks/`, `commands/wal.md` or the WAL record format.
- Keeping the old `/events` snapshot or `/stream?from=` contract. The page is its only consumer.

## Implementation Approach

The server becomes the single owner of matching logic. The client builds query parameters and
renders summaries. One global tail feeds the index. Queries and per-client streams read from the
index; raw lines are read from disk only for text search and `/record`. Seq (the index position)
is the cursor everywhere. `gen` changes only when truncation forces a rebuild, and any seq held
under an old `gen` is invalid.

Phases 1–2 are server work, Phase 3 is the page, Phase 4 is scale proof and docs. Between the
Phase 1 commit and the Phase 3 commit the page is broken (the old snapshot API is gone). This is
accepted.

## Critical Implementation Details

**Timing & lifecycle** — Run the tail synchronously before every `/events` answer and before
`listen()` at startup, so `head` is exact. The client then streams `after=head` with no gap and
no duplicate. Build the full index before listening, so the first query is complete.

**State sequencing (client)** — Each query bumps a client generation number `qgen`. A first-page
response, a next-page response or a stream message tagged with an older `qgen` must be dropped.
Otherwise a slow text search appends rows from the previous filter. Close the old EventSource
before sending the new first-page request, and open the new stream only after that page arrives.

**Timezone** — Local `day` and `minute` use the server process's timezone. Tests must spawn the
server with `TZ=UTC` so fixtures are deterministic.

**User experience spec** — In Tail mode, loading an older page inserts rows **above** the viewport.
Keep the scroll position anchored by adding the height delta to `scrollY`, or the view jumps.
Loading while pinned to the bottom must not unpin follow.

## Phase 1: Server index and query API

### Overview

Replace `readSince` and the snapshot `/events` with an index built by a chunked, byte-accurate
tail. Add the filtered, paged `/events` and `GET /record`. `/stream` is left as-is in this phase
and is reworked in Phase 2.

### Changes Required:

#### 1. Index and tail

**File**: `agents/plugins/wal-observer/scripts/wal-server.mjs`

**Intent**: One global tail reads new bytes in 8 MB chunks. It splits on the `\n` byte, carries a
partial trailing line as a Buffer, and appends one index row per complete line. If the file
shrinks, it clears the index and facets and bumps `gen`. The category map `OF`/`catOf` moves here
from `index.html`.

**Contract**:
- Index row: `{ off, len, t, day, minute, event, cat, tool, dur, sess }`. Seq is the array
  position.
  - `t` is epoch ms from `ts`; if `ts` is missing or invalid, use the previous row's `t` (index
    time only for the first row). Index time alone would make old unparseable lines look new after
    every restart.
  - `day` is the local date as the integer `YYYYMMDD`.
  - `minute` is the local minute of the day (0–1439).
  - `tool`, `dur` and `sess` are `null` when absent.
- Lines that aren't valid JSON are indexed as event `Unparseable` (category `fail`), matching
  today's `parse()` fallback.
- Blank or whitespace-only lines get no index row, as today (`wal-server.mjs:55`).
- A missing WAL file gives an empty index, not an error. The tail picks the file up once it
  appears (today: `wal-server.mjs:36`, `:111`).
- Facets are kept up to date as lines are indexed: `tools` and `sessions` in first-seen order,
  over the whole index regardless of filters.
- `gen` is an integer that starts at the process start time (epoch ms) and goes up only when the
  file shrinks. Seeding it per process means a page reconnecting to a restarted server always gets
  a reset, even if the file was truncated while the server was down.

#### 2. Filter parsing and matching

**File**: `agents/plugins/wal-observer/scripts/wal-server.mjs`

**Intent**: Turn query parameters into one predicate over index rows. The same predicate serves
`/events` now and `/stream` in Phase 2.

**Contract**:

| Parameter | Behaviour |
|---|---|
| `session` | Exact match. |
| `cat`, `tool` | Comma lists. Absent means no filter. Present but empty means match nothing (all chips off). `tool` token `-` matches `tool === null`. |
| `date_from`, `date_to` | `YYYY-MM-DD`, inclusive, compared against `day`. |
| `time_from`, `time_to` | `HH:MM`, compared against `minute`, `to` inclusive. `from` only means `[from, 1439]`; `to` only means `[0, to]`. If `from > to`, the window wraps: `minute >= from \|\| minute <= to`. |
| `min_ms`, `max_ms` | Inclusive bounds. When neither is set, duration is not filtered. When either is set, a row with `dur === null` passes only if `nodur=include`. The default is `exclude`. |
| `q` | Case-insensitive substring on the raw line (decoded as UTF-8, lowercased). Checked only for rows that passed every index filter, by reading the file in chunks. |

Empty or unparseable parameter values count as unset.

#### 3. `/events` and `/record`

**File**: `agents/plugins/wal-observer/scripts/wal-server.mjs`

**Intent**: Run a paged query, newest first.
- Without `before` (first page): one pass from `head - 1` down to 0 that counts every match
  (`total`, `counts`, facets) and collects the newest `limit` rows.
- With `before=X` (next page): scan down from `X - 1` only until `limit + 1` matches are found;
  no totals are computed. After the first page, counts stay current through the stream
  (`after=head`), never through a recount.
- `next` is set only if more matches remain below the last row collected.

`/record` returns one full record by seq.

**Contract**:
- `GET /events?<filters>&before=<seq>&limit=<n>` (default limit 200) returns
  `{ file, gen, head, total, counts: {cat: n}, tools, sessions, rows, next }`.
  - `total`, `counts`, `tools` and `sessions` are present only when `before` is absent.
  - Each row is `{ seq, cat, t, event, tool, dur, sess }`: a summary built from the index, with
    no disk read.
  - `rows` are newest first.
  - `next` is the lowest seq collected, or `null`.
- `GET /record?seq=N&gen=G` returns the full parsed record, read with a `pread` of `off`/`len`.
  Unparseable lines return the same `Unparseable` wrapper as today. The response is 404 if seq is
  out of range and 409 if `gen` doesn't match. `/record` runs the tail before checking `gen`, so
  a truncation made since the last tick is caught instead of `pread` returning the wrong bytes.

#### 4. Query tests

**File**: `agents/plugins/wal-observer/scripts/query.test.mjs` (new)

**Intent**: Prove the index and every filter against a crafted fixture, following the
`live-tail.test.mjs` pattern and spawning the server with `TZ=UTC`.

**Contract**: The fixture includes:
- multibyte text (`zażółć gęślą jaźń`) early in the file;
- records on two different days;
- records around 23:30 and 01:00;
- tools `Bash` and `Read`, plus events with no tool;
- events with and without `duration_ms`;
- one line that isn't valid JSON.

The tests assert:
- every filter parameter from the contract above, including the midnight-wrap window, both `nodur`
  settings, `tool=-` and the empty-list cases;
- `/record` returns the right record for rows after the multibyte text (proves the offsets);
- paging with `limit=2` over the whole file returns every match exactly once, and `next` is null
  at the end;
- `total` and `counts` are correct under a filter;
- `/record` returns 409 for a stale `gen`.

### Success Criteria:

#### Automated Verification:

- Syntax check passes: `node --check agents/plugins/wal-observer/scripts/wal-server.mjs`
- Query tests pass: `node agents/plugins/wal-observer/scripts/query.test.mjs`

#### Manual Verification:

- `curl '127.0.0.1:<port>/events?limit=3'` against the real repo WAL returns 3 summaries with a correct `total`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Filtered live stream

### Overview

Replace the per-client file tail with a stream per client, fed from the global index and filtered
with the Phase 1 predicate. Truncation is signalled with a reset event.

### Changes Required:

#### 1. `/stream`

**File**: `agents/plugins/wal-observer/scripts/wal-server.mjs`

**Intent**: Each client stores its predicate, `after` seq and `gen`. On each 250 ms tick, run the
global tail once, then send each client the summaries of new matching rows (ascending seq) and
advance its `after`. Any client whose `gen` differs from the global `gen` gets `event: reset`
instead. This is checked on every tick, not only on the tick that rebuilt the index, because an
`/events` request can run the tail that detects the truncation.

**Contract**:
- `GET /stream?<filters>&after=<head>&gen=<G>` is an SSE stream.
- Each `data:` frame is a JSON array of summary rows (same shape as `/events` rows), in ascending
  seq order.
- `event: reset` carries no data; the client must re-query.
- `retry: 1000` is kept.
- Each `data:` frame carries `id: <highest seq in the frame>`. On connect, a `Last-Event-ID`
  header overrides `after`, so the browser's automatic reconnect (which reuses the original URL)
  resumes without replaying rows.
- A `q` filter on the stream checks new lines by reading their bytes from disk.

#### 2. Live-tail tests rewritten

**File**: `agents/plugins/wal-observer/scripts/live-tail.test.mjs`

**Intent**: Re-prove the four existing properties under the new API, and add a filtered-stream
case.

**Contract**: The test asserts:
- connecting with `after=head` from `/events` replays nothing;
- an appended record arrives intact (the check goes through `/record` on the returned seq);
- half a line is held back, and the completed line arrives exactly once;
- truncation produces an `event: reset` frame, and a fresh `/events` then returns the new record
  with a higher `gen`;
- truncation first detected by an `/events` call (made right after the truncate, before the next
  tick) still produces `event: reset` on an open stream;
- reconnecting with the original `after` plus `Last-Event-ID: <last received seq>` replays nothing;
- a stream opened with `tool=Read` receives an appended `Read` row but not a `Bash` row.

### Success Criteria:

#### Automated Verification:

- Live-tail tests pass: `node agents/plugins/wal-observer/scripts/live-tail.test.mjs`
- Query tests still pass: `node agents/plugins/wal-observer/scripts/query.test.mjs`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Page

### Overview

Rebuild `index.html` around the query API. It shows summaries only, with detail fetched on
demand, the new columns and filters, infinite scroll in both view modes, and live follow with a
pill. The existing visual system (CSS variables, category chips as the legend, tiles, hero,
theme toggle) is kept.

### Changes Required:

#### 1. Columns and row detail

**File**: `agents/plugins/wal-observer/scripts/index.html`

**Intent**: Split the Time column into Date and Time, both local, from `t`. Clicking a row fetches
`/record?seq&gen` once, caches it on the row and shows the pretty-printed JSON in the detail row.
The category comes from the server's `cat`; `OF`/`catOf` is removed from the client.

**Contract**:
- Columns: Date | Time | Event | Tool | Duration | Session.
- `fmtTime` is replaced with separate date and time formatters: `YYYY-MM-DD` and
  `HH:MM:SS.mmm`, 24-hour.
- Record text is still set only through `textContent`.

#### 2. Filter bar

**File**: `agents/plugins/wal-observer/scripts/index.html`

**Intent**: Add the new controls. Every filter change goes through one 250 ms debounce into the
query routine.

**Contract**:
- Existing controls stay: search, the session select (from `sessions` facets) and category chips.
  A session first seen in a live row is added to the select, as today (`index.html:258`).
- **Tool chips:** one per `tools` facet plus `(no tool)`, all on by default. The `tool` parameter
  is sent only when at least one chip is off, and then lists the chips still on. A tool first seen
  in a live row gets a new chip, turned on.
- **Date:** `date` inputs for from and to.
- **Time:** `time` inputs for from and to.
- **Duration:** `number` inputs for ≥ and ≤ ms, plus a switch "no duration: exclude/include"
  (default exclude). The switch is visibly disabled when neither bound is set.
- **Reset** restores every filter to its default and leaves the view mode alone.
- The hero shows `total`, labelled "matching events", with `head` recorded. The tiles show
  `counts`.

#### 3. Query, paging and view modes

**File**: `agents/plugins/wal-observer/scripts/index.html`

**Intent**:
- **Query routine:** bump `qgen`, close the stream, fetch the first page, render it, then open
  the stream with `after=head&gen`. Responses from an older `qgen` are dropped.
- **Paging:** an IntersectionObserver sentinel at the older edge (bottom in Table mode, top in
  Tail mode) fetches `before=next`.
- **Tail mode:** displays rows in ascending order and keeps the scroll anchored when older rows
  are added above.
- **View toggle:** switches between Table and Tail. The choice is saved in `localStorage`
  (`wal.view`), and Tail is the default.
- **Stream reset:** an `event: reset` from the stream re-runs the query.

**Contract**: One function builds query parameters from the filter state and is used for both
`/events` and `/stream`. The sentinel is hidden when `next === null`.

#### 4. Live follow and pill

**File**: `agents/plugins/wal-observer/scripts/index.html`

**Intent**: A "Live" toggle, on by default. Rows are *following* when Live is on and the viewport
is within about 40 px of the newest edge (the top in Table mode, the bottom in Tail mode).

**Contract**:
- **While following:** arriving rows render immediately at the newest edge, and in Tail mode the
  view stays pinned to the bottom.
- **While not following:** arriving rows go into a pending buffer, and a pill shows "↑ N new"
  (Table) or "↓ N new" (Tail).
- **Leaving the pending state:** clicking the pill, or scrolling back to the edge while Live is on,
  inserts the pending rows and resumes following.
- **Counts:** the hero and tile counts go up on arrival regardless of follow state.
- **Connection dot:** the live dot and its text keep showing the connection state.

### Success Criteria:

#### Automated Verification:

- Existing server tests still pass: `node agents/plugins/wal-observer/scripts/query.test.mjs && node agents/plugins/wal-observer/scripts/live-tail.test.mjs`
- Page has no `innerHTML` sink: `! grep -n innerHTML agents/plugins/wal-observer/scripts/index.html`

#### Manual Verification:

- Date and Time columns show the correct local date for events from today and from earlier days
- Each filter narrows the list and the hero and tile counts. Reset restores everything.
- Tail mode opens pinned at the bottom. Scrolling up loads older pages with no jump. A new event appends at the bottom while pinned.
- Scrolling away shows the "N new" pill. Clicking it or scrolling back to the edge inserts the held rows.
- Table mode works the same with the edges swapped. The chosen mode survives a reload.
- Typing quickly in search never leaves rows from an earlier query in the list
- Clicking a row shows the full record, fetched once

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Scale check and docs

### Overview

Prove the server-side choice on a large log, and document the new API and tests.

### Changes Required:

#### 1. Bench

**File**: `agents/plugins/wal-observer/scripts/bench.mjs` (new)

**Intent**: Generate a synthetic WAL of about 100 MB in a temporary directory, start the server
against it and assert the budgets.

**Contract**: About 100k lines of mixed events and tools, about 1 KB each, with some multibyte
text. The bench asserts:
- the server is listening, which means the index is built;
- `total` with no filters equals the number of generated lines;
- `/record` returns the right record for the line that straddles the first 8 MB chunk boundary.
  The generator places a multibyte character across that boundary, so this is the only check of
  the carried partial line between chunk reads;
- a first page with no `q` answers in under 300 ms;
- a `q` query answers in under 3 s;
- a `before=next` page with a frequently matching `q` answers in under 300 ms (the cost depends on
  scroll depth, not file size);
- the server's `VmRSS` (from `/proc/<pid>/status`) stays under 300 MB after both queries.

It prints the measured numbers, and its exit code reflects pass or fail.

#### 2. README

**File**: `agents/plugins/wal-observer/README.md`

**Intent**: Update **Viewing** (server-side filtering and paging, Tail/Table modes, live follow)
and **Testing** (the three scripts and what each one proves).

**Contract**: Only the **Viewing** and **Testing** sections change.

### Success Criteria:

#### Automated Verification:

- Bench passes within budgets: `node agents/plugins/wal-observer/scripts/bench.mjs`
- All tests pass: `node agents/plugins/wal-observer/scripts/query.test.mjs && node agents/plugins/wal-observer/scripts/live-tail.test.mjs`

#### Manual Verification:

- README Viewing and Testing sections match the shipped behaviour

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Filter semantics against a fixed fixture under `TZ=UTC`: date bounds, the midnight-wrap time
  window, tool lists including `-` and empty, duration with both `nodur` settings, text search
  with multibyte text.

### Integration Tests:

- A spawned server through its HTTP API: paging completeness, `/record` offsets, the filtered
  stream, reset on truncation, no replay after `head`.

### Manual Testing Steps:

1. Run `/wal` in this repo and confirm the date on rows from before today.
2. Set the time window to 22:00–02:00 and confirm that only overnight events remain.
3. Turn off every tool chip except `(no tool)` and confirm that only prompt, session and turn
   events remain.
4. In Tail mode, scroll up two pages, trigger a tool call in a Claude session, check that the
   pill counts it, then click the pill.

## Performance Considerations

- The index is about 150–250 bytes per line in the V8 heap. For 100k lines that's tens of MB,
  measured by the bench.
- `q` rescans the whole file on every first-page query; later pages scan only down from their
  cursor until the page fills. There's no cache by design; if the bench misses the 3 s budget,
  revisit with a single-entry hit cache.
- A query without `q` is one O(n) pass over the index, sub-millisecond per 10k rows.

## Migration Notes

None. The WAL format is unchanged, and the viewer has no consumers other than its own page.

## References

- Approved design: `.ai/changes/wal-viewer-query/change.md`
- Current server: `agents/plugins/wal-observer/scripts/wal-server.mjs:35` (readSince), `:67` (routes)
- Current page: `agents/plugins/wal-observer/scripts/index.html:152` (category map), `:172` (matches), `:196` (render)
- Test pattern: `agents/plugins/wal-observer/scripts/live-tail.test.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server index and query API

#### Automated

- [x] 1.1 Syntax check passes: `node --check agents/plugins/wal-observer/scripts/wal-server.mjs` — d97b067
- [x] 1.2 Query tests pass: `node agents/plugins/wal-observer/scripts/query.test.mjs` — d97b067

#### Manual

- [x] 1.3 `curl '127.0.0.1:<port>/events?limit=3'` against the real repo WAL returns 3 summaries with a correct `total` — d97b067 (real WAL: 738/738 rows)

### Phase 2: Filtered live stream

#### Automated

- [x] 2.1 Live-tail tests pass: `node agents/plugins/wal-observer/scripts/live-tail.test.mjs` — d7d3ae3
- [x] 2.2 Query tests still pass: `node agents/plugins/wal-observer/scripts/query.test.mjs` — d7d3ae3

### Phase 3: Page

#### Automated

- [x] 3.1 Existing server tests still pass — 8fc8f9d
- [x] 3.2 Page has no `innerHTML` sink — 8fc8f9d

#### Manual

- [ ] 3.3 Date and Time columns show the correct local date for events from today and from earlier days
- [x] 3.4 Each filter narrows the list and the hero and tile counts. Reset restores everything. — 8fc8f9d (headless Chromium probe)
- [x] 3.5 Tail mode opens pinned at the bottom. Scrolling up loads older pages with no jump. A new event appends at the bottom while pinned. — 8fc8f9d (headless Chromium probe)
- [x] 3.6 Scrolling away shows the "N new" pill. Clicking it or scrolling back to the edge inserts the held rows. — 8fc8f9d (headless Chromium probe)
- [x] 3.7 Table mode works the same with the edges swapped. The chosen mode survives a reload. — 8fc8f9d (headless Chromium probe)
- [x] 3.8 Typing quickly in search never leaves rows from an earlier query in the list — 8fc8f9d (headless Chromium probe)
- [x] 3.9 Clicking a row shows the full record, fetched once — 8fc8f9d (headless Chromium probe)

### Phase 4: Scale check and docs

#### Automated

- [x] 4.1 Bench passes within budgets: `node agents/plugins/wal-observer/scripts/bench.mjs` — e362c45
- [x] 4.2 All tests pass — e362c45

#### Manual

- [ ] 4.3 README Viewing and Testing sections match the shipped behaviour
