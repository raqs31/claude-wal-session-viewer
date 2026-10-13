# wal-observer — session-aware, standalone viewer Implementation Plan

Design (approved, the source of truth): the design spec (removed from the repo 2026-10-08; this plan carries it).
Section refs below (§1–§4) point into it. Work on `main`, one commit per phase, review after every phase.

## Overview

Split the plugin in two: the hook stays a plugin (`agents/plugins/wal-hook/`) and writes one WAL per
session beside its transcript, stamped with the workspace; the viewer moves to `tools/wal-observer/`,
started by `scripts/wal`. The server discovers sessions across every Claude config dir, serves events
for a multi-session pick, sums usage over it, and drops the timeline. The page gets a global sidebar
with the pick, a header with tabs and live usage tiles, and Sessions becomes stats-only.

## Current State Analysis

- `agents/plugins/wal-observer/` (strict TS on Node 24 type stripping, React 19 + Vite 8). Hook:
  `hooks/wal-hook.mjs` writes `$CLAUDE_PROJECT_DIR/.ai/logs/wal.jsonl` (`walPath()`, l.74–78);
  `hooks/wal-hook.test.sh` drives it via `CLAUDE_PROJECT_DIR`. `commands/wal.md` launches the server
  with `--file=$PWD/.ai/logs/wal.jsonl --project=$PWD`.
- `scripts/wal-server.ts` holds **one global WAL index** (`index`, `tools`, `sessions`, `pending`,
  `tailPos`, `gen`, l.66–88) built by `tail()` (l.142–171); `/events` (`query`, l.254–288) pages
  newest-first by `before=<seq>`; `/record?gen&seq`; `/stream` SSE uses the global seq as frame id
  and `Last-Event-ID` (l.421–439); one 250 ms tick (l.342). `matcher()` (l.218–244) filters on `session`, cat, tool, date,
  time, duration, `q`. Flags: `--file`, `--project`, `--projects-root`, `--port`.
- `scripts/sessions.ts` `createStore(root, project, busy)`: lists only `<slug>` and
  `<slug>--ai-worktrees-*` dirs (l.70–73), describes each transcript from head+tail windows
  (l.75–99), keeps ≤ `OPEN_MAX=3` fully parsed sessions (l.15, l.179–198) unless pinned by a
  stream (`busy`). `/session` returns timeline items + stats; `/item`; `/session-stream` deltas.
- `scripts/transcripts.ts`: `createParser` (items, usage records, meta: title/first/firstPrompt/cost)
  and `aggregate()` (stats + series) — **no cwd capture**.
- Tests: `scripts/*.test.ts` spawn the server via `test-server.ts` (`--port=0`, inherits env);
  `query.test.ts` / `live-tail.test.ts` use `--file=<tmp>`; `sessions.test.ts` uses
  `--project=/tmp/proj --projects-root=<tmp copy of scripts/fixtures/projects>`;
  `project-default.test.ts` tests the `--project` default chain (dies with the flag).
  `web/src/lib/*.test.ts` are pure `node:test`. `npm test` = build + node tests + hook test.
  Benches: `bench.ts` (one 100 MB WAL) and `bench-sessions.ts` (300 transcripts, uses `/item`).
- Page: `App.tsx` header with tabs; `EventsTab` (FilterBar has a session `<select>`, l.71–74);
  `SessionsTab` = `SessionList` + `useSession` + `Timeline` + stats aside. `EventRow.tsx:30`
  fetches `/record?seq&gen`. `useStored` persists string unions only.
- Packaging refs to old paths: `agents/plugins/.claude-plugin/marketplace.json`,
  `agents/settings.json:135`, `hosts/henryk193/agents/settings.json:126`,
  `hosts/NEULA014/agents/settings.json:138` (`wal-observer@unix-conf: true`), `.gitignore:30–31`,
  `install.sh:72,78–79` (comments/excludes written for `/wal`'s node_modules and `web/dist`),
  `tsconfig.json` include `hooks`, `vite.config.ts` proxy list.

### Ground truth checked 08/10/2026 on this host

- Every record in this repo's `.ai/logs/wal.jsonl` (11.5 MB) carries `payload.transcript_path`, and
  its basename always equals `<session_id>.jsonl`. Subagent records (with `agent_id`) carry the
  **parent's** `transcript_path`, so §1 "subagent events land in their parent's file" holds for free.
- `~/.claude/workspaces/priv/projects` resolves to `~/.claude/projects` (the realpath-dedupe case);
  payloads from that workspace carry the unresolved `…/workspaces/priv/projects/…` path.
- The same session id (`63467a79…`) has records from both `~/.claude` and `workspaces/priv` — the
  "resumed under another workspace" case for `workspaces[]`.
- No `wal` binary is on PATH (pywal not installed), so `scripts/wal` does not shadow anything.

## Desired End State

`wal` (on PATH) builds and serves the page on `127.0.0.1`, opens it, and the page lists sessions from
`~/.claude`, every `~/.claude/workspaces/*` and any `--source`, grouped by project with workspace,
worktree, live and `+N` badges. The pick scopes Events and the usage header on every tab; Sessions
shows per-session stats blocks with expandable agent rows. New sessions write
`<config>/projects/<slug>/<session>.wal.jsonl`; `wal legacy` folds old per-project logs in.

## What We're NOT Doing

Changing what the hook captures (beyond `workspace`), pricing, the record viewer/tree formats, MCP
pairing logic; no timeline in any form; no remote binding; no uninstall logic in `install.sh`.

## Decisions (resolved 2026-10-08)

1. **Row identity** (2b): rows carry `sess` + per-file `seq`; `/record?id=<sess>&seq=&gen=` with a per-session `gen`; `before` is an opaque cursor `<t>.<sess>.<seq>`; SSE frame id is a per-file position vector (`<sess>:<n>,…`).
2. **SSE route** (2b): rename `/stream` to `/events-stream`; update the vite proxy.
3. **Connection cap** (2c, 4d): one multiplexed `/session-stream?ids=a,b` (frames carry `id`); `/usage-stream` stays separate.
4. **`+N` unit** (2a, 4a): `+N` = `walLines` delta; `/sessions` returns `walLines` (incremental newline count from the cached offset); sizes stay the change detector.
5. **`workspaces[]` source** (2a): incremental full scan cached per file (offset → set), first scan bounded by the `/sessions` ≤ 500 ms bench; fall back to head+tail windows if the bench fails.
6. **Live flag** (2a): WAL or transcript mtime within 2 min and the last WAL record is not `SessionEnd`.
7. **Agent chips in Events; no "Show in Events"**: dropped the link and any Events-local focus; Sessions agent rows show stats only. Events has no agent filter today (FilterBar has only category and tool chips; `matcher()` filters on session, cat, tool, date, time, duration, `q`), so 2b adds it: `IndexEntry.agent` (`agent_id`; `main` = no `agent_id`), a multi-value server-side `agent` filter like `tool`, and a distinct-agents facet; 4c renders the chips.
8. **Recorded cost over a pick** (2c): sum over sessions that have a `cost-state`; `—` only when none does; tooltip names how many were missing.
9. **Legacy lines out of time order** (3): the per-session index keeps a `t`-sorted order array (O(1) append in the common case, binary insert otherwise); merging uses it.
10. **`.wal.jsonl` in `projects/<slug>/`** (1b): proceed without checking Claude Code's `/resume` picker or cleanup sweep; no manual verification step.

## Implementation Approach

Phase 1 is mechanical and keeps the old server running against the fallback path. Phase 2 rebuilds
the server behind new endpoints with tests first per endpoint. Phase 3 (legacy) and Phase 4 (page)
both depend only on Phase 2 and on disjoint files, so they can run in parallel. Each verify command
is runnable by a subagent from the repo root.

Parallelism legend: **[seq]** must follow the previous chunk (shared files); **[par: X]** may run
alongside chunk X.

---

## Phase 1 — Packaging + hook

### 1a. Moves and references [seq]

Files: `agents/plugins/wal-observer/**` → `agents/plugins/wal-hook/**` + `tools/wal-observer/**`,
`agents/plugins/.claude-plugin/marketplace.json`, `agents/settings.json`,
`hosts/{henryk193,NEULA014}/agents/settings.json`, `.gitignore`, `install.sh`,
`tools/wal-observer/{package.json,tsconfig.json}`.

1. `mkdir -p agents/plugins/wal-hook tools`;
   `git mv agents/plugins/wal-observer/hooks agents/plugins/wal-hook/hooks`;
   `git mv agents/plugins/wal-observer/.claude-plugin agents/plugins/wal-hook/.claude-plugin`;
   `git rm agents/plugins/wal-observer/commands/wal.md`;
   `git mv agents/plugins/wal-observer tools/wal-observer` (untracked `node_modules`/`web/dist` may
   stay behind — delete the leftover dir so the marketplace does not see it; check `git status` per
   the repo hard rule).
2. `wal-hook/.claude-plugin/plugin.json`: name `wal-hook`, description "Records every Claude Code
   lifecycle event to a per-session JSONL write-ahead log beside its transcript."
   `hooks/hooks.json` top `description` likewise.
3. `marketplace.json`: drop the `wal-observer` entry, add `wal-hook` (`source: ./wal-hook`,
   category observability). The file already carries uncommitted `blast-radius`/`subagent-pane`
   entries (untracked plugins) — stage only the wal hunks so the phase commit does not sweep them
   in. The Edit auto-stage hook stages the whole file and `git add -p` is unavailable here, so
   `git restore --staged` it and stage the wal hunk with `git diff … | <filter> | git apply --cached`.
4. The three settings files: `"wal-observer@unix-conf": true` → `"wal-hook@unix-conf": true`.
5. `.gitignore:30–31` → `/tools/wal-observer/node_modules/`, `/tools/wal-observer/web/dist/`.
6. `install.sh:72,78`: comments no longer reference `/wal`; the excludes stay harmless — keep them,
   reword the comment to "no plugin tracks node_modules or a dist/".
7. Hook test placement (decided): stays in the hook plugin; `tools/wal-observer/package.json` `test`
   runs it by relative path `bash ../../agents/plugins/wal-hook/hooks/wal-hook.test.sh` so one
   `npm test` still proves everything. `tsconfig.json` include `hooks` →
   `../../agents/plugins/wal-hook/hooks` (keeps `checkJs` on the hook). Drop the `wal-observer` npm
   script (the launcher replaces it).

Manual (Mario, after the phase lands): `./install.sh`, then
`claude plugin uninstall wal-observer@unix-conf` — `install.sh` never uninstalls, and the stale cache
copy would otherwise keep logging twice if re-enabled.

Verify:
```
git status --short | grep -c '^R' ; test ! -e agents/plugins/wal-observer && echo gone
jq -e '[.plugins[].name] | index("wal-hook") and (index("wal-observer") | not)' agents/plugins/.claude-plugin/marketplace.json
! grep -rn 'wal-observer@unix-conf\|plugins/wal-observer' agents/settings.json hosts .gitignore install.sh
cd tools/wal-observer && npm install --no-audit --no-fund && npm run check && npm test
```

### 1b. Hook: per-session target + workspace stamp [seq after 1a] [par: 1c]

Files: `agents/plugins/wal-hook/hooks/wal-hook.mjs`, `agents/plugins/wal-hook/hooks/wal-hook.test.sh`.

1. `walPath(parsed)`: if `typeof parsed?.transcript_path === 'string'` and it ends in `.jsonl`,
   return it with the suffix replaced by `.wal.jsonl`; else the current
   `$CLAUDE_PROJECT_DIR|cwd/.ai/logs/wal.jsonl`. Keep `mkdirSync(dirname)` (the slug dir exists, but
   the fallback dir may not). Unparseable stdin goes to the fallback.
2. `workspace`: `CLAUDE_CONFIG_DIR` unset/empty, or `realpathSync` of it equals
   `realpathSync(join(homedir(), '.claude'))` → `'default'`; else `basename` of it. Resolve inside a
   try (a missing dir must not throw out of `main`; on failure use the plain basename). Stamp on every
   record including `Unparseable`, after `ts`. Update the header comment's path claim.
3. Tests (§4): run each case with a scratch `HOME` and explicit env:
   - payload with `transcript_path=$work/projects/-x/S.jsonl` → line lands in `…/S.wal.jsonl`, nothing
     in the fallback;
   - subagent payload (`agent_id`) with the same `transcript_path` lands in the same file;
   - `workspace`: `CLAUDE_CONFIG_DIR` unset → `default`; `=$HOME/.claude` (create it) → `default`;
     `=$HOME/.claude/workspaces/priv` → `priv`;
   - no `transcript_path` → fallback `$CLAUDE_PROJECT_DIR/.ai/logs/wal.jsonl`;
   - keep exit-code, clamp, no-stdout, line-count checks (recount per target file).

Verify: `bash agents/plugins/wal-hook/hooks/wal-hook.test.sh && cd tools/wal-observer && npm run check`

### 1c. `scripts/wal` launcher [seq after 1a] [par: 1b]

Files: `scripts/wal` (new, executable).

1. Bash, `set -euo pipefail`, style of `scripts/cl`: `repo="$(dirname "$(realpath "$0")")/.."`
   (the `~/.local/bin` symlink resolves back to the repo), `tool="$repo/tools/wal-observer"`.
2. Missing `node`/`npm` → message on stderr, exit 1. `node_modules` missing (or older than
   `package-lock.json`) → `npm --prefix "$tool" ci --no-audit --no-fund` (falls back to `install`
   if `ci` fails on a lock mismatch). Then `npm --prefix "$tool" run build --silent`.
3. `exec`-free foreground run: `node "$tool/scripts/wal-server.ts" "$@"` piped through a
   `while IFS= read -r line` loop that echoes every line and, on the first `^wal viewer:` match,
   runs `xdg-open "$url" >/dev/null 2>&1 &` when `command -v xdg-open` succeeds (WSL may lack it —
   then just print). Propagate the server's exit status (`PIPESTATUS`); forward SIGINT/SIGTERM.
4. Usage line on `-h|--help`: `wal [--port=N] [--source=<config-dir>]...` (and `wal legacy` from
   Phase 3). No `legacy` dispatch yet.
5. `install.sh` needs no change (`install_scripts` links `scripts/*`).

Verify: `bash -n scripts/wal && shellcheck scripts/wal && test -x scripts/wal && scripts/wal --help`
plus `timeout 60 scripts/wal --port=0 | head -1` printing a `wal viewer:` URL.

**Phase 1 commit**: `refactor(wal): split the hook plugin from a standalone viewer tool`.

---

## Phase 2 — Server

All four chunks touch `scripts/wal-server.ts` and `shared/api.ts` → **strictly sequential**. Tests
isolate from the real home by setting `HOME=<tmp>` before `startServer` (`os.homedir()` honours
`HOME`), with fixtures under `<tmp>/.claude/projects`, `<tmp>/.claude/workspaces/<w>/projects`
(symlink and isolated variants) and `--source=<tmp>/other`.

### 2a. Discovery + `/sessions` [seq]

Files: `scripts/discovery.ts` (new), `scripts/sessions.ts`, `scripts/transcripts.ts`,
`shared/api.ts`, `scripts/wal-server.ts`, `scripts/sessions.test.ts`, `scripts/discovery.test.ts`
(new), `scripts/fixtures/` (new `.wal.jsonl` + second-source fixtures), delete
`scripts/project-default.test.ts`.

1. `discovery.ts`: `sources(extra: string[])` = `~/.claude`, each `~/.claude/workspaces/*`, each
   `--source`, labelled by basename (`default` for `~/.claude`). For each, `realpath(<src>/projects)`
   if it exists; dedupe on realpath keeping the first label. Returns `{label, projectsDir}[]`.
2. `scan()` walks every `projectsDir/<slug>/<uuid>.jsonl` (same `SESSION_RE` filter; `.wal.jsonl`
   does not match it). Project + worktree: a slug containing `--ai-worktrees-` splits into parent slug
   and worktree name (existing rule generalised from the one-project prefix check). Keeps an
   `id → {projectsDir, slug}` map for `locate` (replaces `sessions.ts:73`'s `existsSync` probe).
3. Per row (cached by `(size, mtime)` of both files, like `describe`): existing `SessionMeta` fields
   plus `project: {slug, cwd}` (`cwd` = first entry's `cwd`; add `meta.cwd` to the parser in
   `transcripts.ts`, first-wins), `source`, `workspaces[]` (decision 5; `['unknown']` with no
   WAL), `last` = max of both mtimes, `live` (decision 6), `walSize`, `walLines` (decision
   4), `transcriptSize`. `SessionList` becomes `{ sources: {label, projectsDir}[], sessions, legacy:
   number }`; drop `root`/`project`.
4. `legacy`: distinct `cwd`s over all rows → count existing `<cwd>/.ai/logs/wal.jsonl`. Export the
   path list for Phase 3 (`legacyFiles()`).
5. `createStore` takes the discovery handle instead of `(root, project)`; `discover()` (subagents)
   uses the located dir. Server: drop `--project`, `--file`, `--projects-root`; add repeatable
   `--source=`. Startup log prints the sources instead of `watching:`.
6. Tests (`discovery.test.ts`): two sources + a workspace whose `projects` symlinks to the default
   (listed once) + an isolated workspace (listed with its own label); `workspaces[]` from a WAL with
   two workspace values, `['unknown']` without a WAL; worktree badge; `walSize`/`transcriptSize`;
   `legacy` count from a fixture cwd with `.ai/logs/wal.jsonl`; newest-first order. Rebase
   `sessions.test.ts`'s list assertions onto the new shape.

Verify: `cd tools/wal-observer && npm run check && node --test scripts/discovery.test.ts && node scripts/sessions.test.ts`

### 2b. `/events?ids=` — per-session indexes, merge, SSE [seq after 2a]

Files: `scripts/wal-index.ts` (new), `scripts/wal-server.ts`, `shared/api.ts`,
`scripts/query.test.ts`, `scripts/live-tail.test.ts`, `vite.config.ts`.

1. Extract the index (`IndexEntry`, `indexLine`, `tail`, `reader`, MCP pairing, `PENDING_MAX`) into
   `createWalIndex(path)` returning `{tail(), entries, tools, gen, order, text(r)}`; behaviour per file
   unchanged (truncation → new gen). Add `agent: string | null` (`agent_id`) and `agentType: string | null`
   (payload `agent_type`, empty string → null) to `IndexEntry`; the index also keeps `agents: Map<id, type|null>`.
2. LRU of indexes keyed by session id (cap 8, pinned while a stream or in-flight query uses it — same
   shape as `sessions.ts`' `open`/`busy`). Created lazily from `locate(id)` → `<dir>/<id>.wal.jsonl`;
   a missing file is an empty index that starts tailing when it appears.
3. `query(ids, params)`: tail each picked index, then k-way merge newest-first by `(t, sess, seq)`
   over each index's `order` (decision 9); filters as today minus `session`, plus `agent` (multi-value, parsed like `tool`; `main` matches
   `agent === null`). Cursor/identity per decision 1. `FirstPage`: `gens` per id,
   facet `tools` unioned, facet `agents: {id, type}[]` unioned across the pick (`main` first; type from
   the first record that carries `agent_type`), `sessions` = ids that had rows. Unknown/invalid ids → 400; empty `ids` →
   empty page.
4. `/record?id&seq&gen` against that session's index (409 on stale gen, as now).
5. SSE (decision 2 name): client holds `ids`, matcher, per-id next positions and gens; the 250 ms
   tick tails every index any client uses, emits new matching rows merged by `t`, frame id = position
   vector; `reset` when any of its gens changed. One failing file logs and is skipped, never stalls
   the tick (keep the existing try/catch shape per index).
6. Tests: rebase `query.test.ts` fixtures onto two `.wal.jsonl` files under a fake `HOME`
   (one holds today's s1 lines, the other s2's; MCP log as a third session); every existing filter
   assertion keeps its expected rows, now addressed by `(sess, seq)`; new: merge order across two
   sessions, `agent` filter (`main` alone, one agent, `main` + agent, agent from the second session), `agents`
   facet lists `main` + each distinct agent with its type, paging through the merged set with no dupes/gaps. `live-tail.test.ts`:
   two files growing concurrently reach one stream in time order; partial line held back;
   truncation of one file resets; Last-Event-ID resume after reconnect.
7. `vite.config.ts` proxy: add `/usage`, `/usage-stream`, the renamed stream; drop `/item`.

Verify: `cd tools/wal-observer && npm run check && node scripts/query.test.ts && node scripts/live-tail.test.ts`

### 2c. Slim `/session`, add `/usage` + `/usage-stream` [seq after 2b]

Files: `scripts/sessions.ts`, `scripts/transcripts.ts` (only if a helper is needed),
`scripts/wal-server.ts`, `shared/api.ts`, `scripts/sessions.test.ts`, `scripts/usage.test.ts` (new).

1. `/session?id&scope` returns `{id, gen, version, scope, stats, series, agents, recordedCostUsd}` —
   no `items`, `next`, `head`. Remove `/item`, `before=` paging, `page()`'s item slicing, `item()`,
   and items/`updated` from deltas (`touched`/`pruned` bookkeeping goes with them). The parser keeps
   building items internally (transcripts tests depend on them) — only the wire drops them.
2. Per agent (incl. `main`): `tools` = count of `tool` + `agent` items in that parser, `duration` =
   last − first usage-record `t` (0 when < 2). Expose as `agentStats: Record<string, {tools,
   duration}>` beside `stats.agents` so `StatRow` stays shared with models.
3. `/usage?ids=` → `{ totals: Usage & { cost: number | null }, recorded: number | null, missing:
   number }` summed from `aggregate(…, 'all', …)` per session; cost `null` if any session's is
   (unpriced model → `—`, as today); recorded per decision 8.
4. `/usage-stream?ids=` SSE, 250 ms tick shared with `/session-stream`: send when any picked
   session's `version` moved. `/session-stream` per decision 3 (multiplexed `ids=`). Raise
   `OPEN_MAX` to cover a pick of 8 or make it pick-aware; keep the busy pin.
5. Tests: `/usage` totals equal the sum of each session's `/session` totals (two fixture sessions,
   one with a subagent); unpriced model → `cost: null`; stream frame after appending a reply to one
   session; `/item` → 404; `/session` has no `items`; `agentStats` for the fixture subagent.

Verify: `cd tools/wal-observer && npm run check && node scripts/sessions.test.ts && node scripts/usage.test.ts`

### 2d. Benches + full suite [seq after 2c]

Files: `scripts/bench.ts`, `scripts/bench-sessions.ts`.

1. `bench.ts`: generate 5 sessions × 20 MB `.wal.jsonl` (+ minimal transcripts) under a fake `HOME`;
   `/events?ids=<all 5>` first page ≤ 300 ms, `q=haystackrare` ≤ 3 s, `before=` page ≤ 300 ms,
   RSS ≤ 300 MB, `/record` across the 8 MB chunk boundary intact (keep the multibyte probe in one file).
2. `bench-sessions.ts`: 300 transcripts split across 2 sources (one a symlinked workspace, one
   `--source`), each with a small `.wal.jsonl`; `/sessions` ≤ 500 ms (best of 3) and lists 300 once.
   Replace the `/item` boundary check with a `/session` stats check on the 16 MB transcript;
   keep `/session` cold ≤ 1.5 s, cached ≤ 100 ms.
3. `grep -rn "project-default\|--file=\|--project=" scripts` must be empty.

Verify: `cd tools/wal-observer && npm test && npm run bench`

**Phase 2 commit**: `feat(wal-observer): session-aware server across config dirs`.

---

## Phase 3 — `wal legacy` [after Phase 2] [par: Phase 4]

Files: `tools/wal-observer/scripts/legacy.ts` (new), `tools/wal-observer/scripts/legacy.test.ts`
(new), `scripts/wal`.

1. `legacy.ts` (run as `node scripts/legacy.ts [--source=…]`): reuse `discovery.ts`'
   `legacyFiles()`; per file print path, size, distinct `session_id` count, then prompt
   `[m]igrate / [d]elete / [s]kip` on stdin (`node:readline`; non-TTY reads answers line by line, so
   tests can pipe them).
2. Migrate: group lines by `session_id`; for ids with a located transcript, read the target
   `<id>.wal.jsonl` into a `Set` of lines and append only absent lines (one `appendFileSync` per
   target); rewrite the legacy file with the remaining (unmatched / unparseable) lines via temp file +
   `rename`; remove it if empty. Rerun → nothing appended, file unchanged.
3. Delete: second prompt `type yes to delete <path>`; anything but `yes` skips.
4. `scripts/wal`: `legacy` as first arg → run build-free `node "$tool/scripts/legacy.ts" "${@:2}"`
   (after the deps check); help text updated.
5. Tests (§4): fixture with 2 matched sessions + 1 unmatched + 1 junk line; migrate → targets contain
   exactly their lines, legacy file keeps the unmatched + junk; rerun is byte-identical; a fully
   matched file is removed; delete with `no` keeps the file, with `yes` removes it; skip touches
   nothing. Add `legacy.test.ts` to the `npm test` glob (it is `scripts/*.test.ts` already).

Verify: `cd tools/wal-observer && node scripts/legacy.test.ts && bash -n ../../scripts/wal && shellcheck ../../scripts/wal`

**Phase 3 commit**: `feat(wal-observer): wal legacy migrates per-project logs`.

---

## Phase 4 — Web UI [after Phase 2] [par: Phase 3]

`App.tsx` and `styles.css` are shared: 4a → 4b sequential; 4c ∥ 4d after 4b, each adding its own
`styles.css` section at the end and not editing `App.tsx`.

### 4a. Pure state + data hooks [seq]

Files: `web/src/lib/pick.ts`, `web/src/lib/unseen.ts`, `web/src/lib/sidebar.ts` (new, with
`*.test.ts` each), `web/src/useSessions.ts`, `web/src/usePick.ts`, `web/src/useUsage.ts` (new),
`web/src/useStoredJson.ts` (new; `useStored` only takes string unions).

1. `pick.ts`: `reconcile(stored: string[], sessions) → string[]` — drop missing ids; empty → the
   newest-active id; no sessions → `[]`.
2. `unseen.ts`: baseline per id `{walLines, transcriptSize}` (decision 4) in localStorage key
   `wal.seen`; `unseen(row, baseline) → number`; `advance(baselines, ids, rows)` for ids picked while
   `document.visibilityState === 'visible'`. First sight of a session sets its baseline (no `+N` flood).
3. `sidebar.ts`: `filterRows(rows, {chips, project, text})` and `groupByProject(rows)` (worktrees under
   their parent project, groups ordered by newest row).
4. `useSessions` polls `/sessions` every 5 s (live dots, `+N`, new sessions) instead of a one-shot;
   `usePick` persists `wal.pick` and reconciles on every list; `useUsage(ids)` = `/usage` + SSE.
5. Tests: each lib's edge cases (all ids gone, ties, baseline creation, chip AND project AND text).

Verify: `cd tools/wal-observer && npm run check && node --test web/src/lib/*.test.ts`

### 4b. Sidebar + header shell [seq after 4a]

Files: `web/src/App.tsx`, `web/src/components/Sidebar.tsx` (new), `web/src/components/UsageTiles.tsx`
(new), `web/src/components/LegacyBanner.tsx` (new), `web/src/styles.css`; delete
`components/SessionList.tsx`.

1. Sidebar (§3): pin toggle in `wal.pin`; pinned = in-flow column pushing content; unpinned =
   off-canvas, a 6 px left-edge hot zone opens it on `pointerenter`, closes on `pointerleave`. Contents:
   source/workspace chips, project `<select>`, search input, grouped rows with checkbox (multi-pick),
   workspace badge(s), worktree badge, live dot, `+N` badge, title + relative time.
2. Header: tabs Events | Sessions (`wal.tab` as now) and `UsageTiles` over the pick (input, output,
   cache read, cache write 5m+1h, estimated cost, recorded cost), live via `useUsage`.
3. `LegacyBanner` when `/sessions.legacy > 0`: `N legacy WAL files — run wal legacy`.
4. `App` passes `pick` (ids) to both tabs.

Verify: `cd tools/wal-observer && npm run check && npm run build` + manual: `scripts/wal`, pin/unpin,
multi-pick survives reload, a vanished id is dropped.

### 4c. Events scoped to the pick [seq after 4b] [par: 4d]

Files: `web/src/useEvents.ts`, `web/src/lib/params.ts`, `web/src/lib/params.test.ts`,
`web/src/components/{EventsTab,FilterBar,EventRow,EventTable}.tsx`.

1. `Filters`: drop `session`, add `agent: Set<string>` (like `tool`; present-but-empty = every chip off).
   `buildParams(f, ids)` sets `ids` and `agent`.
2. `useEvents(filters, view, ids)`: requery on pick change; cursor/gens/stream id per decision 1;
   reset handling unchanged.
3. FilterBar: remove the session `<select>`; add an agent chip group (`main` + each entry of the
   `agents` facet across the pick, label = agent type + first 6 chars of the id, `main` plain), wired
   to `filters.agent`. Session column
   stays. `EventRow` fetches `/record?id=${r.sess}&seq&gen=${gens[r.sess]}`; React keys use `sess:seq`.
4. `params.test.ts`: `ids` and `agent` params (multi-value, empty-set case); no `session` param.

Verify: `cd tools/wal-observer && npm run check && node --test web/src/lib/params.test.ts && npm run build`

### 4d. Sessions blocks [seq after 4b] [par: 4c]

Files: `web/src/components/SessionsTab.tsx`, `web/src/components/SessionStats.tsx`,
`web/src/useSession.ts` (→ `useSessionStats(ids)`), `web/src/components/AgentRow.tsx` (new);
delete `Timeline.tsx`, `TimelineItem.tsx`, `ScopeSelect.tsx` (move `agentLabel` into
`SessionStats.tsx`).

1. One block per picked session: header (title, project, workspace/worktree badges), totals tiles,
   By-model table, the three charts, By-agent table. Data from `/session?scope=all` + the multiplexed
   stream (decision 3).
2. Clicking a By-agent row toggles an expansion row: type, model, turns, each token class, estimated
   cost, duration, tool calls (`agentStats`). Stats only, no link out.
3. Remove `RecordViewer`'s `Pane` export only if nothing else uses it after `TimelineItem` goes.

Verify: `cd tools/wal-observer && npm run check && npm run build && ! grep -rn "Timeline\|/item\|ScopeSelect" web/src`

**Phase 4 commit**: `feat(wal-observer): global session pick, usage header, stats-only Sessions`.

---

## Phase 5 — Docs + final verification [after Phases 3 and 4]

### 5a. Docs [seq]

Files: `tools/wal-observer/README.md`, `CLAUDE.md` (root, only if a pointer is needed).

1. README: rename the title to the tool; "What it captures" now describes the per-session path, the
   `workspace` field and the fallback, and points at `agents/plugins/wal-hook/`; "Viewing" →
   `wal [--port=N] [--source=…]` and `wal legacy`; Sessions section rewritten for discovery across
   sources, `/sessions`, `/events?ids`, `/usage(-stream)`, slim `/session`; remove `--project`,
   `--file`, `/wal`, timeline, `/item`; Testing names the hook test's new path and the new benches.
2. `CLAUDE.md` "Where the rest lives": add a row `tools/` → `tools/wal-observer/README.md` (no other
   doc names the old path; `.ai/changes/wal-sessions-tab/` is history and stays untouched).

Verify: `! grep -rn "agents/plugins/wal-observer\|/wal\b\|--project=\|--file=" tools/wal-observer/README.md CLAUDE.md docs .claude`

### 5b. Success-criteria walk-through [seq after 5a]

```
cd tools/wal-observer && npm test && npm run bench
bash -n scripts/wal && shellcheck scripts/wal
bash agents/plugins/wal-hook/hooks/wal-hook.test.sh
```
Manual (Mario, after `./install.sh` + plugin uninstall from 1a):
- Start a fresh session → `<config>/projects/<slug>/<session>.wal.jsonl` exists beside it.
- `wal`: sessions from `~/.claude` and an isolated workspace (`claude-workspace create …`) both list,
  with the right badges; symlinked `priv` sessions are listed once.
- Picking sessions scopes Events and the usage tiles on both tabs; Sessions shows no event list, and
  agent rows expand with stats.
- `wal legacy` on this repo's 11.5 MB `.ai/logs/wal.jsonl`; rerun is a no-op; banner disappears.

Write the review section below with the pasted outputs.

## Review

_(filled in when the work lands)_
