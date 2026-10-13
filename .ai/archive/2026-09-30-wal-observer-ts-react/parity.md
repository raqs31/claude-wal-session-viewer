# Parity check: old page (d049c79) vs React page

Run on 30/09/2026 on branch `feat/wal-observer-ts-react` (HEAD 0a8d7d8, `npm run build` first).

## Setup

- Old: `git archive d049c79 agents/plugins/wal-observer` into a mktemp dir, `node …/scripts/wal-server.mjs --port=7881`. New: `node scripts/wal-server.ts --port=7882`. Both `TZ=UTC`, both on `--file=/tmp/wal-parity.jsonl`, Node v24.20.0.
- Log (465 lines, 957 KB → 1.07 MB after the big line): 450 filler rows (Bash/Read/Edit Pre/Post pairs, two sessions, 20–21/09/2026, durations 5–900 ms). On 22/09/2026 it adds SessionStart, UserPromptSubmit ("needle"), PermissionRequest, `mcp__postgres__query` pair (JSON-in-text-block response, including a multi-line string), `mcp__postgres__list_tables` pair (multi-line plain-text block), `mcp__idea__get_file_problems` Pre + `PostToolUseFailure` (`is_interrupt: true`), an orphan `mcp__neula__search_docs` Pre, a `mcp__neula__export` pair with a 1 068 213-byte line (7 500-row JSON array inside a text block), one unparseable line, Notification and Stop. That gives 469 indexed rows, so there are 3 pages at 200 rows each.
- Browser: Playwright (Chromium), one context with `timezoneId: 'UTC'`, viewport 1400×900. Old and new pages were open side by side on different origins, so localStorage was separate. Each action ran through the same scripted function on both pages. It captured the last `/events` URL (Resource Timing), `#hero`, `#herolabel`, the row count, a hash and the first line of the first 20 rows' cell text, plus action-specific extras. It then compared every captured key with a deep-equality check. Copy used a `navigator.clipboard.writeText` stub.
- Values in the table: `url` is the last `/events` request, `label` is `#herolabel`, and `rows(N)=h…` is the FNV-1a hash of the first 20 rows' cell text. `= old` means every captured key was identical.

## Results

| # | Action | Old | New | Result |
|---|---|---|---|---|
| 1 | Initial load (Tail, empty localStorage) | url=`/events?`; hero 469; label `matching events · showing 200 · 469 recorded`; rows(200)=h2256b416, first `2026-09-20\|10:24:00.000\|PostToolUse\|Edit\|463 ms\|a1b2c3d4`; tiles Tool 458, MCP call 4, Turn 2, Session 2, Permission 1, Failure 2; sessions `All sessions,a1b2c3d4,e5f6a7b8`; tool chips `(no tool),Bash,Read,Edit`; `live`; nodur `no duration: exclude` (disabled); `MCP calls` exp=false | = old | same |
| 2 | View → Table | `View: Table`, `wal.view=table`; rows(200)=h385d9d07 first `2026-09-22\|09:10:17.180\|Stop\|—\|—\|a1b2c3d4` | = old | same |
| 3 | Chip Tool alone | url `?cat=tool`; hero 458; first row `PostToolUseMCP res\|mcp__neula__export\|900 ms`; tiles Tool 458, others 0 | = old | same |
| 4 | Chip MCP call alone | `?cat=mcp`; hero 4; showing 4; first `MCP callneula\|mcp__neula__export` | = old | same |
| 5 | Chip Turn alone | `?cat=turn`; hero 2 | = old | same |
| 6 | Chip Session alone | `?cat=session`; hero 2; first Notification | = old | same |
| 7 | Chip Permission alone | `?cat=attn`; hero 1; `!PermissionRequest\|Bash` | = old | same |
| 8 | Chip Failure alone | `?cat=fail`; hero 2; first `!Unparseable\|—\|—\|—` | = old | same |
| 9 | Chips Tool + Failure | `?cat=tool%2Cfail`; hero 460 | = old | same |
| 10 | `(no tool)` chip | `?tool=-`; hero 5 | = old | same |
| 11 | Bash chip | `?tool=Bash`; hero 151; first `!PermissionRequest\|Bash` | = old | same |
| 12 | MCP pill → open | exp=true; focus `#mcpq`; list idea/get_file_problems, neula/export, search_docs, postgres/list_tables, query, all off (h80c9043b) | = old | same |
| 13 | MCP search `pg` | list empty (no server or tool contains "pg") | = old | same |
| 14 | `pg` → Select all | nothing selected, url unchanged `?` | = old | same |
| 15 | `pg` → Deselect all | unchanged | = old | same |
| 16 | MCP search `post` | `postgres:off`, `list_tables:off`, `query:off` | = old | same |
| 17 | `post` → Select all | `?tool=mcp__postgres__list_tables%2Cmcp__postgres__query`; hero 6; `MCP calls · 2 [on]`; all on | = old | same |
| 18 | `post` → Deselect all | `?`; `MCP calls`; all off | = old | same |
| 19 | Search cleared | full list, all off | = old | same |
| 20 | Select all (all visible) | tool = 5 MCP tools, sorted; hero 13; `MCP calls · 5 [on]` | = old | same |
| 21 | Deselect all | `?`; all off | = old | same |
| 22 | Check tool `query` (group partial) | `?tool=mcp__postgres__query`; hero 3; postgres `partial` | = old | same |
| 23 | Check `list_tables` (group full) | `?tool=…query%2C…list_tables`; hero 6; postgres `on` | = old | same |
| 24 | Group checkbox postgres off | `?`; all off | = old | same |
| 25 | Group checkbox idea on | `?tool=mcp__idea__get_file_problems`; hero 3; idea `on` | = old | same |
| 26 | Type `exp` then Esc | popover hidden, exp=false, focus `#mcppill` (the native search Esc also cleared `exp`) | = old | same |
| 27 | Reopen pill | exp=true, focus `#mcpq` | = old | same |
| 28 | Outside click (hero) | popover hidden, exp=false | = old | same |
| 29 | Reset | `?`; pressed only Live+JSON; inputs empty; `MCP calls` | = old | same |
| 30 | `q=needle` | `?q=needle`; hero 2; first UserPromptSubmit | = old | same |
| 31 | + session e5f6a7b8 | `?q=needle&session=e5f6…0002`; hero 1; filler row `Read\|264 ms` | = old | same |
| 32 | Reset | `?`; hero 469 | = old | same |
| 33 | `date_from=2026-09-22` | `?date_from=2026-09-22`; hero 19 | = old | same |
| 34 | Date 2026-09-21..2026-09-21 | hero 0; `No events match this filter.` shown | = old | same |
| 35 | + time 09:00..10:00 | url with `time_from=09%3A00&time_to=10%3A00`; hero 0; empty shown | = old | same |
| 36 | Time only 09:03..09:08 | `?time_from=09%3A03&time_to=09%3A08`; hero 25 | = old | same |
| 37 | Reset | `?`; nodur disabled | = old | same |
| 38 | `min_ms=1000` | `?min_ms=1000`; hero 4; nodur `exclude` enabled | = old | same |
| 39 | nodur → include | `&nodur=include`; hero 240 | = old | same |
| 40 | + `max_ms=1500` | `?min_ms=1000&max_ms=1500&nodur=include`; hero 238 | = old | same |
| 41 | nodur → exclude | hero 2 | = old | same |
| 42 | Reset | nodur `exclude` (disabled); inputs empty | = old | same |
| 43 | Theme toggle | `data-theme=dark` | = old | same |
| 44 | Theme toggle again | `light` | = old | same |
| 45 | Format YAML, reload | `wal.format=yaml`, YAML pressed, view still Table | = old | same |
| 46 | Click `live` status | `/events?` re-fetched; `live` | = old | same |
| 47 | Expand postgres call (JSON) | panes `Request`, `Response`; detail len 239 h b832c2cd | = old | same |
| 48 | → YAML (open row re-renders) | `wal.format=yaml`; detail len 166 h164c750b, `multi: \|` 2-line block | = old | same |
| 49 | YAML Copy both panes | `Copied`/`Copied`; copied `sql: select id, name from users limit 1\n` + response len 169 h56d06f4b | = old | same |
| 50 | → Raw | detail len 298 h6d196156 | = old | same |
| 51 | Raw Copy both panes | request `{\n  "sql": "select id, name from users limit 1"\n}`; response len 278 hd6903b6c | = old | same |
| 52 | → JSON | detail len 239 hb832c2cd | = old | same |
| 53 | JSON Copy both panes | response len 252 h5bb18554 | = old | same |
| 54 | Copy label after 1.3 s | back to `Copy` / `Copy` | = old | same |
| 55 | Copy with rejecting clipboard | `Copy failed` | = old | same |
| 56 | Collapse postgres call | no open detail | = old | same |
| 57 | Format YAML while closed, reopen | re-rendered in YAML (h164c750b) | = old | same |
| 58 | Collapse | closed | = old | same |
| 59 | Expand list_tables call (YAML) | `schema: public` \| `\|-` 5 lines incl. `  indented line`, `trailing: colon` | = old | same |
| 60 | list_tables YAML Copy | `schema: public\n`, `\|-\n  users\n  orders\n  items\n    indented line\n  trailing: colon\n` | = old | same |
| 61 | Collapse | closed | = old | same |
| 62 | Failure row (idea) JSON | panes `Request`, `Error (interrupted)`; 1 `.bad` pane; `"Interrupted by user\nsecond line"` | = old | same |
| 63 | Failure row YAML | `\|-` 2 lines; `.bad` | = old | same |
| 64 | Failure row Raw | plain text in `<pre class="bad">` | = old | same |
| 65 | Failure row Copy | `{\n  "filePath": "src/App.tsx"\n}`, `Interrupted by user\nsecond line` | = old | same |
| 66 | Collapse | closed | = old | same |
| 67 | Unparseable row (Raw) | `Record` pane, `{ts, event: "Unparseable", payload.line: "{this is not json"}`; the `ts` is each server's own index time, masked (len 138 hec52c9fa) | = old | same |
| 68 | Unparseable row → JSON | tree, 3 keys (masked ts) | = old | same |
| 69 | Orphan Pre (neula search_docs) | single `Record` pane, 6 keys (h eb7e4e7f) | = old | same |
| 70 | PermissionRequest (YAML) | `ts: "2026-09-22T09:03:03.000Z"`, … (h b0ee1891) | = old | same |
| 71 | MCP search `neu` kept across outside click + Reset | reopened: q `neu`; neula/export, search_docs off | = old | same |
| 72 | `/record` → 500 | detail `error 500` | = old | same |
| 73 | Reopen after error retries | record rendered (h276f3568) | = old | same |
| 74 | `/events` → 500 | label `could not load events (error 500) · change a filter or click the status to retry`; `disconnected`; old rows kept | = old | same |
| 75 | Click status → retry | `?q=zzz`; hero 0; empty shown; `live` | = old | same |
| 76 | Tail first page | scrollY 6420, 1 px from bottom; sentinel visible above the table | scrollY 6421, 0 px from bottom | same (1 px sub-pixel rounding) |
| 77 | Tail: scroll to top → page 2 | `?before=269`; showing 400; anchor drift 0 px | = old | same |
| 78 | Tail: scroll to top → page 3 | `?before=69`; showing 469; first `PreToolUse\|Bash` 08:01:01; sentinel hidden; drift −1 px | drift 0 px; scrollY 2345 vs 2346 | same (≤1 px, under the 2 px limit) |
| 79 | Tail: scroll to top again | no request; 469 | = old | same |
| 80 | View → Table | sentinel after the table; rows(200)=h385d9d07 | = old | same |
| 81 | Table: scroll to bottom → page 2 | `?before=269`; showing 400; last rows 08:38 | = old | same |
| 82 | Table: scroll to bottom → page 3 | `?before=69`; showing 469; sentinel hidden | = old | same |
| 83 | Table: Tool filter + two older pages | `?cat=tool&before=58`; showing 458 | = old | same |
| 84 | 1 MB row, JSON after YAML→JSON switch | detail text identical | = old | same |
| 85 | 1 MB YAML response Copy text | len 977 949, h 928ca7ca, starts `- id: 0\n  name: row-0\n  tags:\n    - x\n    - "y"` | = old | same |
| 86 | 1 MB row open, YAML, click → painted (ms, 6 runs) | 2 162, 3 047, 2 069, 1 993, 8 134, 4 053 (median 2 605) | 3 073, 2 327, 2 540, 3 497, 2 972, 2 747 (median 2 860) | same (timing noise, ~1.1×) |
| 87 | 1 MB row open, JSON, click → painted (ms, 3 runs) | 1 784, 4 076, 7 115 (median 4 076) | 4 170, 5 026, 4 248 (median 4 248) | same (timing noise, ~1.0×) |
| 88 | 1 MB open row, YAML → JSON switch → painted (ms) | 3 204, 2 854, 4 971 (median 3 204) | 10 399, 4 171, 4 059 (median 4 171) | same (~1.3×, not consistently >2×) |
| 89 | 1 MB open row, JSON → YAML switch → painted (ms) | 4 437, 4 608, 2 360 (median 4 437) | 5 224, 7 020, 6 670 (median 6 670) | same (~1.5×, not consistently >2×) |
| 90 | 1 MB Copy click → `Copied` (ms) | 934, 1 010, 1 011 | 77, 68, 73 | same (new faster) |
| 91 | 1 MB row collapse → painted (ms) | 521, 796, 734 | 295, 380, 376 | same (new faster) |
| 92 | Live setup: Tail at bottom, Follow on, MCP popover open with `li` | list `postgres`/`list_tables` | = old | same |
| 93 | Append 3 (incl. new `mcp__linear__list_issues`, new session) at edge | hero 472; showing 203; appended at bottom, still 0 px from edge, no pill; popover list gains `linear:off`/`list_issues:off` with `li` kept; session `c9d0e1f2` added; Tool 460, Turn 3 | = old | same |
| 94 | Append 3 while scrolled to 3000 px | hero 475; showing 203; pill `↓ 3 new` (`pill tail`) | = old | same |
| 95 | Click pill | showing 206; new rows at bottom; 0 px from edge | = old | same |
| 96 | Follow off | `Live` unpressed | = old | same |
| 97 | Append 3 at edge, Follow off | pill `↓ 3 new`; showing 206 | = old | same |
| 98 | Follow on at edge | flushed, showing 209, 0 px from edge | = old | same |
| 99 | View → Table, scroll 2000 | re-query; rows(200) first `10:03:03 PostToolUse\|Bash\|30 ms` | = old | same |
| 100 | Append 3 in Table at 2000 px, Follow on | shown at once (showing 203), no pill, scroll stays 2000 | = old | same (see note 1) |
| 101 | Scroll to top | nothing pending; top row `10:04:03` | = old | same |
| 102 | Table: Follow off at 2000 px | `Live` unpressed | = old | same |
| 103 | Append 3 (Table, Follow off) | pill `↑ 3 new` (`pill table`); showing 203 | = old | same |
| 104 | Click Table pill | showing 206, first row `10:05:03`, scrolled to 0 | = old | same |
| 105 | Follow on | pressed | = old | same |
| 106 | Append 3 in Table at top | prepended; showing 209; first `10:06:03` | = old | same |
| 107 | Open top row detail | record `2026-09-22T10:06:03.000Z` PostToolUse (h d7cb4045) | = old | same |
| 108 | Truncate + write 2 new lines | reset → re-query: hero 2, `showing 2 · 2 recorded`, open detail gone, `live` | = old | same |
| 109 | Open row after reset | record of the new file (`after truncate`, h3287ce90) | = old | same |
| 110 | `/record` → 409 | `/events?` re-fetched, rows rebuilt, no detail left open | = old | same |
| 111 | Truncate to empty | hero 0; `showing 0 · 0 recorded`; empty shown; `live` | = old | same |
| 112 | Append 3 to the empty log | 3 rows appear (Table, newest first); Tool 2, Turn 1 | = old | same |
| 113 | Reload with console + pageerror listeners | no errors | no errors | same |

## Notes

1. Old-page behaviour carried over (row 100, `same`, for the user to decide): in Table view, `atEdge()` compares `#rows` top with `thead` bottom. Only the `th` cells are sticky, not `thead`, so `thead`'s rect moves with the table and `atEdge()` is always true in Table view. With Follow on, live rows are always prepended at once and the `↑ N new` pill never shows. The pill only shows with Follow off (rows 103–104). The port matches this on purpose, because behaviour is frozen at d049c79.
2. Two apparent DIFFs in the first scripted run were caused by the test harness, not by the pages. Both were re-run and are `same` above:
   - Copy labels: Playwright's actionability waits between the two Copy clicks sometimes took longer than 1.2 s, so the first label had already reverted on the old page. The copy clicks were re-run in-page with a 20 ms gap.
   - Unparseable `ts`: each server stamps the unparseable record with its own index time, so the timestamps differ by the start-up gap. They are masked in the capture.
3. Timings are Chromium under WSL2, measured from click to the next frame after the `.tree` node is present, with `/record` fetch time included. Variance is large on both pages. The new page is within ~1.5× on format switches of the open 1 MB row, and faster on Copy and collapse, because the copy text is built from the value on click and there is no DOM rebuild on close.

## Summary

113 actions: 113 `same`, 0 `DIFF`. No web or server changes were needed.
