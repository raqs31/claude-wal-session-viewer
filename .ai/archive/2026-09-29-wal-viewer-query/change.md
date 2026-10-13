---
change_id: wal-viewer-query
title: WAL viewer — date column plus server-side filtering with infinite scroll
status: archived
created: 2026-09-29
updated: 2026-09-29
archived_at: 2026-09-29T13:40:18Z
---

## Notes

— wal-observer viewer: show date+time columns; server-side filtering (date range, every-day time window, tool multi-select incl. no-tool, duration ≥/≤ with include/exclude-no-duration switch default exclude, text, session, category) with seq-cursor pagination and 200-row infinite scroll; per-client filtered live stream. Approved design in conversation (Sections 1–3).

### Approved design (2026-09-29)

Scope: `agents/plugins/wal-observer/scripts/{wal-server.mjs,index.html,live-tail.test.mjs}`, new
`scripts/{query.test.mjs,bench.mjs}`, and `README.md`.
`commands/wal.md` unchanged. Server-side filtering chosen over in-browser so the browser tab
holds only the rows on screen, not the whole log.

**1. Server (`wal-server.mjs`)**

- In-memory index, one row per WAL line: `{seq, off, len, day, minute, event, cat, tool, dur, sess}`.
  Full records stay on disk and are `pread` only for returned rows.
- One global tail every 250 ms appends to the index. Reads in fixed 8 MB chunks (no
  whole-file buffer). Splits on the `\n` **byte**, not decoded-string indices, so multibyte UTF-8
  cannot skew offsets. Partial trailing line is carried, as today.
- Local `day` (YYYY-MM-DD) and `minute` (minute-of-day) computed once at index time, in the
  server process timezone (same machine as the browser).
- Category map (`OF`/`catOf`) moves to the server. Rows are returned as summaries
  `{seq, cat, t, event, tool, dur, sess}` built from the index; the full record is fetched on
  click via `GET /record?seq&gen` (a `pread` of one line).
- File shrink (truncate/rotate) → rebuild index, bump `gen`.
- `GET /events?<filters>&before=<seq>&limit=200` → newest-first `rows`, `next` cursor (or null),
  `total` + per-category `counts` over all matches, `tools` + `sessions` facets, `head` (index
  length at query time; tail runs before answering), `gen`, `file`. `total`/`counts`/facets are
  computed only on the first page; `before=` pages scan down from the cursor until the page fills.
- Filters: `q` (case-insensitive substring on the raw line; disk scan only over rows passing the
  index filters), `session`, `cat` (comma list), `tool` (comma list, `-` = no tool; omitted = all),
  `date_from`/`date_to` (inclusive YYYY-MM-DD), `time_from`/`time_to` (HH:MM, every day; wraps past
  midnight e.g. 22:00–02:00), `min_ms` (≥)/`max_ms` (≤), `nodur=include|exclude` (default exclude;
  only has effect when a duration bound is set — with no bounds every event shows).
- `GET /stream?<filters>&after=<head>` → per-client filtered SSE of matching rows with `seq > after`
  (no gap, no duplicate). On truncation sends `event: reset`; client re-queries. `gen` is seeded
  from process start time; frames carry `id: <seq>` and `Last-Event-ID` overrides `after`.

**2. Page (`index.html`)**

- Columns: Date (`2026-09-29`) | Time (`13:43:05.123`) | Event | Tool | Duration | Session.
- Filter bar: search, session select, category chips (existing); tool multi-select chips incl.
  `(no tool)`, all on by default (a tool first seen live still shows until the set is narrowed);
  date from/to; time from/to; duration `≥`/`≤` with no-duration include/exclude switch; Reset.
- Infinite scroll: first 200 matches; IntersectionObserver sentinel loads next page via
  `before=next`. Hero + tiles from server `total`/`counts`; "showing N of total".
- Filter edits debounced 250 ms. Every query carries a client generation number; any response or
  page not matching the current generation is dropped (a slow `q` scan must not append stale
  rows). After the new first page, the stream reconnects with `after=head`; live matches bump
  counts.
- View modes: Tail (default, saved in `localStorage` as `wal.view`) is oldest-first with new rows
  at the bottom and older pages loaded on scroll up; Table is newest-first. A Live toggle follows
  the newest edge, pauses when scrolled away, and holds arrivals behind a "N new" pill.

**3. Tests and docs**

- Rewrite `live-tail.test.mjs` against the new API, re-proving: append reaches client; split write
  arrives once and intact; resume from cursor does not replay; truncation resets.
- Add: each filter (incl. midnight-wrap window and `nodur` switch), multibyte offsets, seq paging
  without gaps/duplicates, filtered live stream.
- Add `bench.mjs`: ~100 MB synthetic WAL; first page < 300 ms, `q` < 3 s, RSS < 300 MB.
- Update README Viewing and Testing sections.

Out of scope: URL-persisted filters, string interning, new config knobs.
