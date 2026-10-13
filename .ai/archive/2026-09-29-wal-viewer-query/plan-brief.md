# WAL viewer — server-side query, date column, infinite scroll — Plan Brief

> Full plan: `.ai/changes/wal-viewer-query/plan.md`

## What & Why

The wal-observer viewer shows each event's time but not its date, so you can't tell whether an
event is from today or yesterday. It also loads the whole WAL into the browser tab. This change
moves filtering and paging to the server, so the tab holds only the rows on screen, and adds the
filters the page is missing.

## Starting Point

`wal-server.mjs` serves one snapshot of every record plus a byte-offset SSE tail. `index.html`
filters that array on the client (by text, session and category) and re-renders every match on
each change. `live-tail.test.mjs` proves the tail is correct.

## Desired End State

- Rows show a local Date and a Time column.
- The server filters by text, session, category, tool (multi-select, including "no tool"), date
  range, an every-day time window and duration ≥/≤. Events without a duration are excluded by
  default when you set a bound, with a switch to include them.
- The page loads 200 rows at a time as you scroll, opens full records on click, and follows new
  events in Tail mode (the default) or Table mode, with a "N new" pill when you've scrolled away.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where filtering runs | Server-side | Keep browser tab memory flat on large logs. | Design (change.md) |
| Date display | Separate Date and Time columns | Answers "today or yesterday?" at a glance. | Design |
| Time filter | Date from/to plus an every-day time window, wrapping past midnight | Supports questions like "what ran overnight?". | Design |
| Tool filter | Multi-select chips including `(no tool)` | Several tools at once, or only non-tool events. | Design |
| Duration and no-duration events | ≥/≤ plus an include/exclude switch, default exclude | Most events have no duration; bounds should mean "timed events". | Design |
| Paging | Seq cursor, 200 rows, infinite scroll | Stable cursor on an append-only index. | Design |
| Row payload | Summaries plus `/record` on click | A page stays around 30 KB even with 96 KB records. | Plan |
| Live UX | Tail (default, remembered) and Table modes; auto-pause follow plus "N new" pill | Rows never jump under the cursor; reads like `tail -f`. | Plan |
| Scale proof | 100 MB bench: page under 300 ms, `q` under 3 s, server RSS under 300 MB | Proves the claim that drove the server-side choice. | Plan |

## Scope

**In scope:**
- Server index, the `/events`, `/record` and `/stream` APIs.
- The page rebuild.
- Rewritten and new tests, the bench, and the README Viewing and Testing sections.

**Out of scope:**
- Saving filters in the URL or localStorage.
- A text-search cache.
- String interning.
- Config knobs.
- Changes to the hook or command.

## Architecture / Approach

One global tail reads the WAL in 8 MB chunks and appends a byte-accurate index row per line. Each
row holds the offset, length, epoch time, local day and minute, event, category, tool, duration
and session. `/events` runs one pass over the index for totals, counts and a newest-first page;
text search reads raw lines from disk. `/record` reads one line from disk. `/stream` sends each
client the new rows that match its filters, and sends `reset` on truncation. The page builds
query parameters, renders summaries, and guards every response with a query generation number.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server index and query API | Index, filters, `/events`, `/record`, `query.test.mjs` | Byte offsets and multibyte text; midnight-wrap logic |
| 2. Filtered live stream | Per-client `/stream`, reset event, rewritten `live-tail.test.mjs` | No gap or duplicate between `head` and the stream |
| 3. Page | Columns, filters, infinite scroll, Tail/Table, follow and pill | Scroll anchoring in Tail mode; stale responses |
| 4. Scale check and docs | `bench.mjs` within budgets; README | `q` rescan speed at 100 MB |

**Prerequisites:** Node (already used by the plugin). No new dependencies.
**Estimated effort:** about 2–3 sessions over 4 phases. The page is broken between the Phase 1 and
Phase 3 commits.

## Open Risks & Assumptions

- "Local" means the server process's timezone, which is the same machine as the browser.
- Text search rescans on every page. If the bench misses 3 s, add a single-entry hit cache.
- Text search matches the raw JSON line, so quotes appear as `\"` and newlines as `\n` in matched
  text.

## Success Criteria (Summary)

- You can see at a glance whether an event is from today or an earlier day.
- Any combination of filters narrows the list and counts, and scrolling loads more. The tab grows
  only with the rows scrolled through, never with the size of the log.
- A 100 MB log stays within the bench budgets.
