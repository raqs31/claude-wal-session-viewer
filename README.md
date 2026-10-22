# claude-wal-session-viewer

A standalone viewer for Claude Code sessions: the lifecycle events recorded by the `wal-hook`
plugin, and token usage and cost read from the transcripts. The viewer is not a plugin itself; the
hook that feeds it ships in this repo as one.

## Installing

The viewer needs Node 24 or newer. From npmjs:

```
npm install -g @raqs31/claude-wal-session-viewer
```

From GitHub Packages, which needs a token with `read:packages` even for public packages:

```
npm install -g @raqs31/claude-wal-session-viewer --@raqs31:registry=https://npm.pkg.github.com
```

The hook, from inside Claude Code:

```
/plugin marketplace add raqs31/claude-wal-session-viewer
/plugin install wal-hook@claude-wal-session-viewer
```

The hook needs `node` on PATH; without it the viewer still shows usage and cost, but no events.

The plugin also adds `/wal-hook:wal`, which Claude runs only when you invoke it:
`/wal-hook:wal install` walks through installing the viewer: by default it links `wal` to the plugin's marketplace checkout,
or installs from GitHub Packages or a separate git clone,
`/wal-hook:wal update` checks the viewer and this plugin for newer versions and offers to update
them, and `/wal-hook:wal run` starts it in the background, reports its URL and mentions a newer
viewer if there is one.

## Running

```
wal [--port=N] [--source=<config-dir>]...
wal legacy [--source=<config-dir>]...
```

`wal` starts the server and opens the printed URL. From a checkout, `scripts/wal` does the same
after installing dependencies when needed and building the page. The server binds `127.0.0.1` only:
the data contains prompts, file contents and command output and must not be reachable off the
machine.

Sources are Claude config dirs whose `projects/` is scanned: `~/.claude`, every
`~/.claude/workspaces/*`, and each `--source`. Sources are deduplicated by the realpath of their
`projects/` dir, so a workspace that symlinks it back is listed once.

## What the hook captures

The hook lives in `plugins/wal-hook/` (`wal-hook@claude-wal-session-viewer`). It registers for every
hook event and appends one JSON object per line to `<config>/projects/<slug>/<session>.wal.jsonl`,
beside the session transcript. Only when the payload has no `transcript_path` does it fall back to
`$CLAUDE_PROJECT_DIR/.ai/logs/wal.jsonl`.

Each record promotes the fields that correlate an event with a transcript (`session_id`,
`prompt_id`, `tool_use_id`, `duration_ms`), adds `workspace` (`default` for `~/.claude`, otherwise
the basename of `CLAUDE_CONFIG_DIR`), and keeps everything else verbatim under `payload`. Capturing
the remainder wholesale is deliberate: published docs disagree on whether the tool result arrives as
`tool_result` or `tool_response`, and an allowlist would silently drop one. Large values are
truncated with a `...[+N chars]` marker.

It never breaks a turn: it always exits 0 (a non-zero `PreToolUse` exit blocks the tool), writes
nothing to stdout (injected into model context on some events), and does one append per event so
parallel hooks cannot interleave a partial line.

`PostToolUse`, `PostToolUseFailure`, `Stop` and `SubagentStop` records also carry `context`: the firing
agent's last API call, `tokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
and `output = output_tokens`, with its `model`. It is the last reply, not summed and not a max, so it
drops after a compaction. The transcript is read from the payload: `agent_transcript_path` on
`SubagentStop`; otherwise, for a subagent event, `<session>/subagents/agent-<agent_id>.jsonl`, where
`<session>` is the `transcript_path` without its `.jsonl`; otherwise `transcript_path`. For a subagent
event, an `agent_id` that is not a plain id, or a `transcript_path` that is not a `.jsonl`, gives no
context rather than the main transcript's. `context` is omitted when no path qualifies, the file is
missing or unreadable, no assistant line with usage (not `<synthetic>`) lies within the last 4 MB, or
anything throws; the record is written either way.

## `wal legacy`

Folds old per-project `<cwd>/.ai/logs/wal.jsonl` files into the per-session files beside each
transcript. For each file it asks `[m]igrate / [d]elete / [s]kip`; delete needs a typed `yes`.
Migrating moves lines per `session_id`, leaves behind any it cannot place, and removes the file once
empty, so a rerun is a no-op. The viewer shows a banner while legacy files remain.

## The page

-  **Header**: the page title, the sessions root (Sessions only) and Toggle theme; it stays at the
  top on both tabs.
-  **Sidebar**: lists sessions grouped by project, each with a live/idle dot, workspace and worktree
  badges, length and age (`2h 14m · 5m`: first transcript entry to last write, so a live session's
  length is so far; just the age when the start is unknown; both times on hover) and a `+N` count of
  events not yet seen. A session is named by its latest `/rename` (the transcript's `custom-title`),
  else Claude Code's latest auto title (`ai-title`), else its cleaned first user message (a session
  started by a slash command or skill reads `⚡ /name args`); the same name shows in the sidebar, the
  × chips, the Sessions tab and the agent filter. Hovering or focusing a row shows a bubble with the
  whole first user message, cleaned the same way (system reminders and command output dropped, other
  tags stripped; newlines kept, scrollable), or none when no first message is stored; Escape or
  moving away hides it. Names and titles come from the transcript's first 1 MB (up to the first
  prompt) and its last 256 KB, so a rename seen in neither shows the auto title instead; the first
  message is cut at 8192 characters. Filter by source or workspace chip, project or text. The chips
  have All, None and Not like the Events filters: Not hides the sessions whose source or any
  workspace is ticked, and the collapsed summary shows it as `≠ default, work`. Click a session row
  to pick or unpick it; picked sessions are pinned on top under Selected and listed as chips with a
  × each, plus Clear all. The pick is kept in the browser (`localStorage` key `wal.pick`), so a
  refresh restores it and every open tab follows a pick made in another; only picking, unpicking and
  Clear all store it. With nothing stored, the page opens with the most recently active session
  picked; a stored empty pick restores as all sessions. When none of the picked sessions is listed
  any more, the most recently active one is shown instead (not all sessions) until the pick changes.
  An empty pick means all sessions on the Events tab. The arrow in its top corner pins or unpins it:
  pinned, it stays shown; unpinned, it hides and slides in when the pointer reaches the left edge.
-  **Usage tiles**: token and cost totals for the picked sessions, updated live. On Events they top
  the sticky head under the header; on Sessions they sit under the header and scroll away.
-  **Events**: the WAL rows of the picked sessions. A sticky head under the header keeps the usage
  tiles and one line in view while you scroll: the matching total with shown and recorded counts, a
  length (each picked session's first to last matching event, summed; it grows with live rows), a
  count per category, the active filters (shortened, in full on hover) with a Reset (only while one
  is set), and the Live, View (Tail or Table) and Format controls with the stream's live status. The
  filters sit in a right panel, unpinned by default: the Filters handle at the right edge just below
  the header, which shows how many filters are active, slides it in on hover or click, and the arrow
  in the panel's corner pins it, narrowing the list. It filters by text, category, tool, event name,
  agent (shown when the pick has more than one agent), date, time of day and duration. Filter chips
  offer only values present in the picked sessions, and a chosen value that no longer occurs is
  dropped when the pick changes. Each of the category, tool, event and agent sections has All, None
  and Not: All ticks every value offered now (tool includes `(no tool)` and the MCP tools), so a
  value first seen later is filtered out; use None or Not for "everything". None clears the section.
  Not is a toggle, enabled while something is ticked, that turns the ticked values from "show only
  these" into "hide these" (the chips read struck through, and the summary shows `tool: ≠2`); All
  with Not therefore excludes every offered value. Rows load as you scroll and follow the logs live;
  a row expands to its full record. MCP Pre/Post pairs get a synthetic "MCP call" row showing
  request beside response. Records render as a tree in JSON, YAML or Raw.
-  **Sessions**: one block per picked session with totals, By-agent and By-model tables, charts and
  agent rows that expand to type, model (main shows its model, or "mixed (see By model)"), turns or
  requests, token kinds, cost, duration, tool calls and context at end. The totals end with the main
  agent's context at end, and each By-agent row with its own (Ctx). An expanded agent row also shows
  that agent's charts, fetched when the row expands and refetched on each new call or token change:
  "Context per call" first, with a marker at each compaction, then cumulative tokens and tokens per
  API call. The Main row is open on load. Agents with 0 calls get none. It shows no event list; that
  is the Events tab.

## What the numbers mean

-  A turn is any human input the model answers: a typed prompt, a slash command, `/goal`. A local
  command the model never replies to (`/clear`) is not one. Only the main agent has turns; its row
  shows Turns, a subagent's shows Requests.
-  Usage is taken from the last transcript entry of each API message (`message.id`): every entry of
  a reply repeats it, and in subagent files the early ones are streaming snapshots.
-  Thinking is part of output. Its tile is shown on its own and never added to a total.
-  Context at end is the prompt of an agent's last request: input + cache read + cache write, so
  after a compaction it is the compacted size. It is tokens only: no transcript records the model's
  window size.
-  Estimated cost multiplies usage by `scripts/pricing.json`, USD per million tokens keyed by the
  transcript's `message.model`, taken from https://platform.claude.com/docs/en/about-claude/pricing
  on 30/09/2026. To update it, copy the per-model input, output, cache write 5m/1h and cache read
  prices from that page and bump `fetched`. It has no long-context tier (the page lists none), and
  fast mode, batch, US-only inference and web search are not priced. A model missing from the file
  shows "—", and so does any total that includes it.
-  Recorded cost is Claude Code's own figure from the transcript's `cost-state` entry, shown on the
  Whole scope beside the estimate, in total and per model. The estimate can run below it: 0–5% on
  most finished sessions measured, up to about 30% on some, likely from spend no transcript shows
  (subagents without a transcript file, Haiku background calls, advisor calls). The recorded figure
  is a `cost-state` snapshot, so on a live session it lags behind.
