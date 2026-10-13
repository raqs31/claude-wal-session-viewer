---
change_id: wal-viewer-mcp-filter
title: WAL viewer — opt-in coloured filter chips and grouped "MCP calls" panel
status: archived
created: 2026-09-30
archived_at: 2026-09-30T12:27:35Z
updated: 2026-09-30
---

## Notes

— wal-observer viewer: per-tool MCP chips flood the filter bar. Replace them with one "MCP calls" pill opening a
grouped, searchable panel; colour tool chips; make every filter chip opt-in. Approved design in conversation.

### Approved design (2026-09-30)

Scope: `agents/plugins/wal-observer/scripts/index.html` and `README.md` only. Server unchanged (`cat=`/`tool=` are
already include-lists).

- **Opt-in filtering, all filter chips** (category, tool, MCP panel): everything starts unselected; an empty group sends
  no param (= no filter); selecting items sends only those. Groups AND together. `catOff`/`toolOff` → `catOn`/`toolOn`.
  MCP checkboxes share `toolOn` with plain tool chips. Reset clears all selections. Tools first seen live arrive
  unselected.
- **Colours**: Claude built-in tools (not `mcp__`) → Claude orange `--tool-claude: #d97757`; `(no tool)` → red
  `--status-critical`; MCP tools → stable hue hashed from server name (`hsl(h 60% 55%)`), shared by all tools of a
  server. Category chips keep category colours.
- **Chip style**: colour dot on every chip; unselected = plain outline (no fade); selected = border in its colour +
  ~15% `color-mix` fill.
- **MCP calls pill**: single chip in tools row, "MCP calls" / "MCP calls · N" when N selected, tinted if any selected.
  Hidden until the first MCP tool is seen. Popover under it: search (narrows list by group or tool name,
  case-insensitive; group match shows whole group; does not filter events), Select all / Deselect all (visible rows
  only), groups by server (segment between `mcp__` and next `__`) with colour dot + tri-state checkbox, tool checkboxes
  under each. Esc / outside click closes.
- **Table**: Tool cell gets the same colour dot before the name, incl. synthetic "MCP call" rows.
- **README**: Viewing section describes selection model, colours, MCP panel.

Out of scope: server/API changes, new config knobs.

### Approved design — record viewer (2026-09-30)

Scope: `scripts/index.html` + one README sentence; server unchanged.

- **normalize(v)** (JSON/YAML modes only), recursive: an array of MCP content blocks unwraps (a single
  `{type:"text", text}` becomes its `text`; other block types such as image stay as they are); a string that looks like a JSON
  object/array and parses becomes structured data, at any depth; other strings keep newlines; parse failure keeps the original.
- **Applies to** MCP call Request/Response/Error panes and the plain full-record view of every row.
- **Format: JSON | YAML | Raw** segmented control in top bar next to View; `localStorage` `wal.format`, default JSON;
  switching re-renders expanded rows. Raw = stored values, no unwrap, pretty-printed as before.
- **Tree viewer**, DOM via `textContent` only: objects/arrays in native `<details>`, open by default; collapsed summary
  `{…} N keys` / `[…] N items`. JSON syntax vs YAML syntax (indentation, `- ` items, `|` block for multi-line strings,
  quote only when YAML needs it). Syntax colours from palette vars for keys, strings, numbers, bool/null, light+dark.
- **Copy** button per pane: plain text in current format (JSON.stringify / YAML text emitter) via navigator.clipboard.
