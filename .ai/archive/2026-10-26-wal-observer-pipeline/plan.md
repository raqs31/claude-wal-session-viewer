# WAL observer pipeline with token columns — Implementation Plan

## Overview

An in-process **observer** reads each session's raw sources: the WAL, the transcripts and the subagent
`.meta.json` files. It writes one append-only, self-contained **target** file per session. The Events index
and the Sessions stats read only targets. Discovery (session list, live / busy, trash checks) stays on the raw
files. The viewer never writes a WAL.

On this pipeline, every tool call gets a **call row** (request, response, timespan). Call rows and Stop rows
get token numbers from the transcript, joined by `tool_use_id`:
- **Output**: the issuing message's output tokens, split over its parallel calls.
- **Result**: the tokens that the call's result added to context.
- **Total**: Output + Result.

The Events tab gets three token columns, a ≥ / ≤ token filter with a "no tokens" switch, and an
**Order: Time / Tokens** control. Main use: find the largest calls, for example MCP calls.

## Current State Analysis

- **Events index** (`scripts/wal-index.ts`):
  - Tails the WAL itself (`tail()` `:207-260`). It makes one `IndexEntry` per non-blank line in
    `indexLine` (`:129-203`). It pairs MCP Pre / Post into a virtual "MCP call" entry (`:191-201`).
  - `q` and `/record` read raw WAL bytes by `off` / `len` (`:265`, `:507`, `wal-server.ts:329-356`).
- **Sessions store** (`scripts/sessions.ts`, `scripts/transcripts.ts`):
  - Parses the transcripts incrementally (`grow()` `:50-63`, `createParser` `transcripts.ts:115`). It keeps an
    LRU of 8 sessions.
  - Builds `SessionView`, `AgentStat` and `UsageTotals` at read time (`:148-202`).
  - Usage records are amended in place: the last streamed line per `message.id` wins
    (`transcripts.ts:173-183`).
- **Discovery** (`scripts/discovery.ts`): owns `/sessions`, `locate`, `find` and the trash checks. It stays as
  it is.
- **Trash** (`scripts/trash.ts`): renames whole sessions into `<config-dir>/wal-trash/`. The `forget` callback
  drops the in-memory index and store (`wal-server.ts:116-135`).
- **Tests**: tests expect the very next one-shot request to see new bytes
  (`live-tail.test.ts:247-286`, `query.test.ts:564`, `trash.test.ts:124-206`, `sessions.test.ts:337-355`).
  The fixtures under `scripts/fixtures/projects/` have transcripts but no WALs.
- **Tokens**: no token numbers exist per row. The hook's `context` field is stale on 25% of Posts (review F1),
  so it is not used.

## Desired End State

- The server owns `<config-dir>/wal-viewer/` through a lock. It keeps one target per discovered session.
- `/events`, `/events-stream`, `/record`, `/session`, `/session-stream`, `/usage` and `/usage-stream` read only
  targets. They give the same answers as today, except for these planned changes:
  - Every tool call has a call row. It replaces the MCP-only virtual row.
  - A session without a WAL gets call rows and turn rows from its transcripts, and its Sessions stats.
- A backlog builds in the background. A partly built pick shows its rows with a "building" progress note. A
  header chip shows overall progress.
- A changed source (shrunk, new inode) or an old format version freezes its target and marks it stale. A
  rebuild comes only from the page's Rebuild action or `wal rebuild`.
- Call rows and Stop / SubagentStop rows show Output / Result / Total once known. Every other row shows —.
- `min_tok` / `max_tok` / `notok=include` filter on Total. `sort=tokens` lists rows by Total, largest first,
  with paging, only while Live is off.
- `npm run check`, `npm run lint`, `npm test` and `npm run bench` pass.

### Key Discoveries:

- Real data (43 sessions):
  - The next distinct `message.id` in an agent's transcript is the next request in 5202 of 5202 cases.
  - Compaction makes growth negative 11 times.
  - Every tool_result is its own user line.
  - A reply's lines can be split by other lines, so group them by `message.id`.
- Partial `output_tokens` occur only in CC 2.1.306. There, the last line per `message.id` holds the final
  count. Once the next request exists, the issuing reply is final.
- Stop / SubagentStop: the last assistant message at or before the Stop `ts` matches the prefix of
  `payload.last_assistant_message` in 482 of 482 cases. The hook clamps that text to 2000 chars.
- Only 125 of 1134 (session, agent_id) pairs have a subagent transcript. The 1008 SubagentStop-only ids have
  no file and get no tokens.
- Parsing all 43 main transcripts takes 0.3 s, and the largest takes 54 ms
  (`/tmp/tok-probe/`, data probe).
- `createParser` already merges streamed lines and collects tool ids (`transcripts.ts:121`, `:173-194`).
  `UsageRecord` has no tool_use ids, and items keep no result size.
- `seq` is the entry index, not a line number. Virtual rows take their own seq (`wal-index.ts:112`, `:201`).
- `day` / `minute` depend on the server time zone (`wal-index.ts:174`), so they are derived at read time.
- An unparseable WAL line takes the previous row's `t`, or `Date.now()` (`wal-index.ts:139-143`). Only a
  persisted `t` is replayable.
- Trash moves files by rename inside one config dir, so a restored source keeps its inode.

## What We're NOT Doing

- No change to discovery, `/sessions`, the trash flow or `wal legacy`.
- No automatic rebuild. A rebuild is manual only.
- No use of the hook's `context` field, and no hook change.
- No Tokens order while Live is on, and no live insertion into a sorted list.
- No input / cache columns, no cost per row, no choice of sort key (always Total).
- No version bumps: the release commit does them.

## Implementation Approach

1. **Target**: `<config-dir>/wal-viewer/<id>.jsonl`, one JSON record per line, with `k` as the first key.
   - `head` `{k, v, id, wal}`: always line 1. `v` is the format version. `wal` is true when the target was
     built with a WAL.
   - `ev`: one WAL line. It holds the per-line derived fields (`t`, `event`, `cat`, `tool`, `dur`, `tuid`,
     `agent`, `agentType`, `mcp`, `err`), the WAL byte offset `woff`, and `rec` (the parsed WAL record).
     Unparseable lines hold `raw` (the line text) instead.
   - `call`: one per tool call, written when its Post / PostFailure is read. It holds `tuid`, `t` (Pre `ts`,
     else Post `ts`), `end` (Post `ts`), `dur`, `tool`, `mcp`, `err`, `agent`, `agentType`, `input` and
     `response` (`tool_response`, else `error`).
   - `tok`: a token patch. `{tuid, out, res?}` targets a call row. `{woff, out}` targets the Stop /
     SubagentStop `ev` at that WAL offset. The last `tok` per target wins.
   - `use`, `turn`, `compact`, `agent`, `tools`, `cost`: the transcript data for Sessions stats. Keyed
     records (`use` by agent + id, `agent` by id, `tools` by agent, `cost`) are last-wins upserts. The writer
     appends one only when its value changed.
   - `ck`: a checkpoint `{wal: {ino, off}, tr: {<agent or "main">: {ino, off}}}`. It is written at the end of
     each pass that wrote records.
   - `stale` `{reason}`: the last record of a frozen target.
2. **Observer** (`scripts/observer.ts`):
   - It is the only writer. Per session, a **pass** reads the transcripts first (main, then agents, spawner
     first), then the WAL. It appends the new records and then a `ck`.
   - After a restart, it replays each source up to the last `ck` without writing, to rebuild its parser
     state. Then it continues.
   - A request runs a budgeted pass for its picked sessions first. A background loop builds the backlog and
     follows every session with a WAL.
3. **Readers**:
   - The Events index tails the target instead of the WAL. It takes `ev`, `call` and `tok` records as
     entries. `tok` entries are hidden: they patch their target row and are never rows.
   - The Sessions store builds its views from the transcript records.
   - Cross-line WAL state (agent tree, type upgrades, summaries) is still resolved by the index at read time,
     because later lines amend it.
4. **Tokens**: the observer joins call and Stop rows to the transcript and appends `tok` records, using the
   rules in "Token rules".
5. **Server and web**: the filter, the order and the stream use the row numbers. Stream `tokens` frames come
   from hidden `tok` entries met in the normal scan.

## Critical Implementation Details

**One seq space for patches.** `tok` records take a seq like rows, so the stream's `id:` vector covers them.
A reconnect rescans from the vector and replays any missed patch or held row. Do not add a second position
vector.

**Search text.** `q` matches only the source part of the target line, never the derived keys: every `ev`
line holds `"mcp":null`, `"err":false` and a numeric `t`, so a whole-line match would hit every row.
- `ev` writes `rec` (or `raw`) as its last key. `q` tests the line from `"rec":` (or `"raw":`) to the end.
- `call` writes `input` and then `response` as its last keys. `q` tests the line from `"input":` to the end.
- `ev` keeps `rec` as an object, not as a string, so quotes and backslashes are not escaped twice.
- `JSON.parse` moves integer-like keys to the front, so `q` matches the re-serialized `rec`, not the exact
  WAL bytes.

**Call row order.** A call row's `t` is the Pre time, but the row lands at Post. The page must put a late row
in `cmp` order, not at the end, and drop a row whose `sess` + `seq` it already has. This applies to the live
stream with or without a token filter.

**Torn tail.** A crash can leave the target's last line without `\n`. On open, the observer writes a `\n`
before its next record. The reader skips an unparseable target line.

**Replay must not write.** The replay to the `ck` rebuilds the parser maps and the open-call set (calls with
no `tok` yet, read from the target). It appends nothing. The first write after replay starts after the `ck`
offsets, so no record is written twice.

**Single writer.** The lock is `<config-dir>/wal-viewer/observer.lock`. It holds the pid and is created with
`O_EXCL`. A lock whose pid is dead is replaced. A second server whose lock is held runs with no observer and
serves the targets read-only. It logs that once.

**Token rules.** For a call whose `tool_use_id` is in reply R of agent A's transcript:
- N is the next distinct reply after R in A's file order. `prompt(x)` = input + cacheRead + cacheWrite5m +
  cacheWrite1h.
- Output: R.output, split over R's `tool_use` and `server_tool_use` blocks by `JSON.stringify(input).length`.
- Result: growth = prompt(N) − prompt(R) − R.output, split by the result size of each block. The result size
  is the length of the tool_result content: the string itself, or `JSON.stringify` of the blocks.
- Splits round so that the parts add up to the whole.
- Result is omitted (Output only) in three cases:
  - Growth < 0 (compaction).
  - A user prompt (a non-tool_result user line) lies between R and N (an interrupted turn).
  - N does not exist and the WAL has a `SessionEnd` after the call.
- N does not exist and the session has not ended: the call stays open, and no `tok` is written yet.
- A session without a WAL never ends, so its last open calls stay open and show —.
- The call's `tool_use_id` is in no transcript: no `tok` is ever written.
- Stop / SubagentStop: `out` is the output of the agent's last reply with `t` ≤ the Stop `ts`. That reply's
  last text block must start with `last_assistant_message` (with its `…[+N chars]` suffix cut). Until such a
  reply exists, the Stop stays open.

**Sessions without a WAL.** The pass reads only the transcripts and writes rows from them:
- Call rows: one per `tool_use` / `server_tool_use` block in the main and subagent transcripts, written when
  its tool_result arrives. `t` = the tool_use line `timestamp`, `end` = the tool_result line `timestamp`,
  `dur` = end − t. Event `Tool call` / `MCP call` and cat as for WAL call rows. `agent` is the subagent id
  (null for main) and `agentType` comes from its `.meta.json`. `input` is the block input, `response` the
  result content. `/record` returns `{call}`, and `q` searches `input` and `response`.
- Turn rows (`ev` records with `rec` = the transcript line): `UserPromptSubmit` per main turn start
  (`turnStarts`) and per subagent first prompt. `Stop` (main) / `SubagentStop` (subagent) per reply line with
  `stop_reason: "end_turn"`, with `out` set inline. Streamed snapshots carry `stop_reason: null`, so the
  `end_turn` line holds the final count.
- Call rows get `tok` records by the normal "Token rules".
- A WAL that appears for a target with `head.wal = false` makes the target stale (`wal appeared`). A rebuild
  then builds it from the WAL.

**Sorted pages with `q`.** On a page after the first, the scan applies the filter without `q`, sorts the rows
below the cursor, and then tests `q` in that order until `limit + 1` hits. Only the first page runs `q` on
every row, because it returns `total` and `counts`.

**Sort cursor.** In Tokens order, `before` is `<total>.<t>.<sess>.<seq>`, with `total = -1` for no data. Rows
order by `(total, t, sess, seq)` descending. Each page is one scan of the pick that keeps the top `limit` rows
below the cursor.

## Phase 1: Target format, writer, reader, lock

### Overview

The building blocks: the target path, the record types, append, incremental read and the cache lock.

### Changes Required:

#### 1. Target module

**File**: `scripts/target.ts` (new)

**Intent**: One module owns the target's on-disk contract, so the observer and the readers share it.

**Contract**:
- `targetDir(source)` → `<config-dir>/wal-viewer`. `targetPath(source, id)` → `<dir>/<id>.jsonl`.
- `TargetRecord`: a discriminated union on `k`, covering every kind in "Implementation Approach" step 1.
  `TARGET_VERSION = 1`.
- `appendRecords(file, records)`: writes whole lines in batches of at most 64 KB, like `appendLines`
  (`scripts/legacy.ts:24`). It writes a leading `\n` when the file ends mid-line.
- `createTargetReader(file)`: an incremental tail with `{ino, offset, carry}`. It returns the new records with
  their `off` / `len` in the target. It reports a shrink or new inode, and it skips unparseable lines.
- `acquireLock(dir)` / `releaseLock`: the `O_EXCL` pid lock from "Single writer". It returns `false` when a
  live pid holds the lock.

#### 2. Tests

**File**: `scripts/target.test.ts` (new)

**Intent**: Cover append, the torn tail, incremental read across a partial line, shrink detection and the
lock (held, dead pid, released).

**Contract**: `node --test` on a temp dir, with no server.

### Success Criteria:

#### Automated Verification:

- Target tests pass: `node --test scripts/target.test.ts`
- Type check passes: `npm run check`
- Lint passes: `npm run lint`

---

## Phase 2: Observer — WAL to target

### Overview

The observer turns a WAL into `head`, `ev`, `call` and `ck` records. It can resume after a restart and
detects a changed source.

### Changes Required:

#### 1. Observer core

**File**: `scripts/observer.ts` (new)

**Intent**: Per session, read the WAL from the checkpoint and append `ev` records. Append a `call` record at
each Post / PostFailure, using the input and `ts` of the matching Pre. Write a `ck` after each pass.

**Contract**:
- `createObserver({discovery, write: boolean})` gives `sync(id, budgetMs)` → `{done, total, stale}`, where
  done / total are WAL bytes. It also gives `state(id)` and `drop(id)`.
- The per-line derivation moves here from `indexLine` (`wal-index.ts:129-203`): `t`, event, cat, tool,
  `dur`, `tuid`, agent, agentType, mcp, err. An unparseable line takes the previous `t`, else the time of
  the pass, and the observer persists it.
- The open-Pre map has the same cap as `pending` today (10 000). A Post with no Pre gives a call row with
  `t = end`. A second Post for the same `tuid` gives no second call row, as today.
- Restart: read the target, take the last `ck`, replay the WAL to `ck.wal.off` without writing, then
  continue.
- Stale: a WAL smaller than `ck.wal.off`, a new inode, or a `head.v` other than `TARGET_VERSION` appends
  `stale {reason}` once and stops all writes for that target.
- A WAL that does not exist (for example, in trash) is skipped. That does not make the target stale.

#### 2. Tests

**File**: `scripts/observer.test.ts` (new)

**Intent**: Check the records over temp WALs.

**Contract**: Cases:
- `ev` fields match today's `IndexEntry` for the same lines.
- A call row for a plain tool, an MCP tool and a failure.
- Post with no Pre.
- A duplicate Post.
- Unparseable lines keep `raw` and a persisted `t`.
- Resume after a new observer instance writes no duplicates.
- Shrink and new inode give `stale` and no further writes.
- A torn target tail.
- A budget of 0 ms makes partial progress, and later passes finish.

### Success Criteria:

#### Automated Verification:

- Observer tests pass: `node --test scripts/observer.test.ts`
- Type check passes: `npm run check`
- Lint passes: `npm run lint`

---

## Phase 3: Observer — transcripts to target

### Overview

The observer adds the transcript records that the Sessions stats need. A golden test proves that a view
built from the target equals today's view.

### Changes Required:

#### 1. Transcript pass

**File**: `scripts/observer.ts`

**Intent**: Per session, run today's `createParser` on the main transcript and on each subagent transcript
that has a `.meta.json`. Append the records that changed since the last pass.

**Contract**:
- `use`: one per reply, keyed by (agent, id). It holds the `UsageRecord` fields. It is appended when the
  value differs from the last one written.
- `turn`: main turn starts.
- `compact`: per agent.
- `agent`: id, type, description, model, toolUseId, parent, prompt. It is re-appended when the parent or type
  resolves later.
- `tools` `{agent, n}`: `meta.toolCalls`.
- `cost` `{usd, byModel}`: from main's last `cost-state`.
- Order: main first, then agents, spawner before nested agent. The spawn turn logic is the same as
  `sessions.ts:80-83`.
- `ck.tr` holds each transcript's `{ino, off}`. Replay to `ck.tr` follows the same rules as the WAL. A shrink
  or new inode of a transcript makes the target stale.
- For a session without a WAL, the pass also writes the call and turn rows from "Sessions without a WAL".

#### 2. Target-based views

**File**: `scripts/session-view.ts` (new)

**Intent**: Build `SessionView`, `AgentStat` and `UsageTotals` from transcript records, with the same rules
as `sessions.ts:148-202`. Phase 4 uses this module as the store's read path.

**Contract**:
- `context` is the last `use` record in first-appearance order per key, the same as file order today.
- `recordedCostUsd` comes from `cost`.
- Same exported shapes as `shared/api.ts`.

#### 3. Golden test

**File**: `scripts/session-view.test.ts` (new)

**Intent**: For every fixture session in `scripts/fixtures/projects/`, build a target with the observer.
Assert that the target-based view deep-equals today's `store.view` for scopes `all`, `main` and each agent,
and that `usage` matches.

**Contract**: Fixtures are copied to a temp `HOME` as they are, with no WAL. This phase writes no
`make-fixture.ts` changes.

#### 4. Observer tests for sessions without a WAL

**File**: `scripts/observer.test.ts`

**Intent**: Cases:
- Call rows for a main and a subagent tool call, with `t`, `end`, `dur`, `agent` and `response`.
- Turn rows: `UserPromptSubmit` per turn start, and `Stop` / `SubagentStop` only on `end_turn` lines.
- A WAL that appears later makes the target stale with `wal appeared`.

### Success Criteria:

#### Automated Verification:

- Golden test passes: `node --test scripts/session-view.test.ts`
- Observer tests still pass: `node --test scripts/observer.test.ts`
- Type check and lint pass: `npm run check && npm run lint`

---

## Phase 4: Readers switch to targets

### Overview

The Events index and the Sessions store read only targets. Each request first catches up its sessions within
a time budget. The old raw-read paths are removed.

### Changes Required:

#### 1. Events index

**File**: `scripts/wal-index.ts`

**Intent**: `tail()` reads the target through `createTargetReader` instead of the WAL. Each `ev` and `call`
record becomes an entry. The virtual MCP pairing and the per-line derivation are removed, because the
observer now does them. The read-time tree state (`agents`, `parents`, `about`, `links`) stays.

**Contract**:
- `IndexEntry` keeps its fields, and `off` / `len` now point into the target.
- A call row has event `MCP call` for an MCP tool, else `Tool call`. Its cat follows the Post's cat.
- `day` / `minute` are derived from `t` at read time.
- `q` reads the source part of the target line, as in "Search text".
- `createIndexes` keys indexes by target path.

#### 2. Sessions store

**File**: `scripts/sessions.ts`

**Intent**: The store keeps its API (`get`, `view`, `usage`, `drop`), but it reads target records through
`session-view.ts`. Its parsers move into the observer.

**Contract**:
- `version` is the target offset of the last transcript record read, so WAL rows do not resend views. It
  also changes when `pipe.stale` is set. `gen` changes when the store re-opens the target.

#### 3. Server routes

**Files**: `scripts/wal-server.ts`, `shared/api.ts`

**Intent**:
- Routes call `observer.sync(id, budget)` for their sessions before they read.
- `walTick` and `sessionTick` sync their streamed sessions before they read, so live latency stays at the
  250 ms tick.
- `/record` reads the target. For a call row, it returns the call record plus the Pre and Post `rec` found by
  `tuid`.
- `forget` drops the reader state on trash and restore. Purge also deletes the target.

**Contract**:
- `shared/api.ts` gains `Pipe = {done: number; total: number; stale: string | null}`.
- `FirstPage` gains `pipe: Record<string, Pipe>` for the picked sessions, and `SessionView` gains `pipe`.
- The budget is 150 ms per request, shared by its sessions. The env `WAL_SYNC_BUDGET_MS` overrides it for
  tests only.
- When a streamed session's target turns stale, `/events-stream` sends `event: stale` with `{sess, reason}`
  once and no `reset`. `/session-stream` and `/usage-stream` carry it in `pipe.stale` of the next frame.
- `RecordResponse` keeps its shape for `ev` rows. For call rows, it uses the same `{pre, post}` shape that
  virtual rows use today, plus `call`.

#### 4. Test updates

**Files**: `scripts/query.test.ts`, `scripts/live-tail.test.ts`, `scripts/sessions.test.ts`,
`scripts/usage.test.ts`, `scripts/trash.test.ts`, `scripts/discovery.test.ts`, `scripts/bench-sessions.ts`
(its direct `createStore` call at `:213` gets an observer, so `npm run check` passes)

**Intent**: Existing tests pass, with only these expected changes:
- Every tool call has a call row, which replaces the MCP-only virtual row in counts and seqs.
- Fixture sessions without a WAL now have call and turn rows in Events.
- A truncated or renamed WAL (`live-tail.test.ts:247-297`) gives `event: stale` and frozen rows, not
  `reset`. A deleted WAL leaves the rows and sends nothing.
- A truncated transcript (`sessions.test.ts:343-351`) gives `pipe.stale` in the next frame, not a higher
  `gen`.

**Contract**: New cases:
- A no-WAL session gives call and turn rows, and its stats equal today's.
- With `WAL_SYNC_BUDGET_MS=0`, a first page is partial with `pipe.done < pipe.total`, and a later page is
  complete.
- Trash, restore and purge keep, resume and delete the target.

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Type check and lint pass: `npm run check && npm run lint`
- No raw WAL or transcript read remains outside `observer.ts`, `discovery.ts`, `trash.ts` and `legacy.ts`:
  `grep -nE "\.wal\.jsonl|subagents|createParser" scripts/wal-index.ts scripts/sessions.ts scripts/wal-server.ts`
  prints nothing

#### Manual Verification:

- With the viewer on real data, Events and Sessions show the same numbers as before the change for a
  session with a WAL

**Implementation Note**: After this phase passes automated verification, pause for the human's manual
confirmation before Phase 5.

---

## Phase 5: Background loop, progress, stale and rebuild

### Overview

The server owns the cache, builds the backlog, follows live sessions, reports progress and offers a manual
rebuild.

### Changes Required:

#### 1. Lock and loop

**Files**: `scripts/wal-server.ts`, `scripts/observer.ts`

**Intent**:
- At start, the server takes the lock of each source's target dir. With the lock, it runs a 1 s loop over
  all `discovery.list()` sessions. Each tick works in slices of at most 50 ms, so requests stay fast.
- `sync` reports `done` / `total` as WAL plus transcript bytes.
- New sessions and grown sources are synced. Sessions never built are built in the background.

**Contract**: Without the lock, the observer is not started (read-only mode), and the server logs that once.

#### 2. Progress and rebuild routes

**Files**: `scripts/wal-server.ts`, `shared/api.ts`

**Intent**:
- `GET /observer` reports the progress.
- `POST /rebuild {ids}` deletes those targets and the in-memory state. The loop then builds them again. It
  uses the existing `crossSite` and `writeOf` POST pattern.

**Contract**:
- `ObserverStatus = {owner: boolean; total: number; built: number; building: string[]; stale: {id, reason}[]}`.
- `/rebuild` returns `{results: {id, ok, error?}[]}`. It is refused with 409 in read-only mode.

#### 3. CLI rebuild

**Files**: `scripts/cli.ts`, `scripts/observer.ts`, `README.md` (usage block)

**Intent**: `wal rebuild [ids…] [--source=<config-dir>]…` rebuilds the given sessions, or all, and prints the
progress per session.

**Contract**: If a live pid holds the lock, it exits 1 with `server running — use Rebuild in the page`.
Otherwise, it takes the lock for the run.

#### 4. Tests

**File**: `scripts/observer-server.test.ts` (new)

**Intent**: Cover the server-level behaviour.

**Contract**: Cases:
- The backlog builds with no request, and `/observer` reaches `built === total`.
- A WAL appended with no client open is synced by the loop.
- A shrunk WAL appears in `stale`, and its rows stop updating.
- `/rebuild` clears the stale state and rebuilds.
- A second server is read-only and refuses `/rebuild`.
- The CLI refuses while a server holds the lock, and it rebuilds when none holds it.

### Success Criteria:

#### Automated Verification:

- Server observer tests pass: `node --test scripts/observer-server.test.ts`
- All tests pass: `npm test`
- Type check and lint pass: `npm run check && npm run lint`

---

## Phase 6: Token join

### Overview

The observer writes `tok` records for call rows and Stop rows. The index applies them to the rows.

### Changes Required:

#### 1. Parser data for the join

**File**: `scripts/transcripts.ts`

**Intent**: Give the observer the data that the join needs, without changing today's outputs.

**Contract**:
- Per reply: its tool_use / server_tool_use ids in block order, the input size of each, and the prefix of its
  last text block (2000 chars).
- Per tool id: its reply id and its result size, set when the tool_result arrives.
- Per reply: a flag for "a user prompt came after this reply". It is set when a non-tool_result user line
  follows the reply.

#### 2. Join

**File**: `scripts/observer.ts`

**Intent**: Apply "Token rules" after each pass. Keep the open calls and open Stops per session, and retry
them on every pass.

**Contract**:
- `tok {tuid, out, res?}` and `tok {woff, out}`, as in "Implementation Approach".
- A WAL row with `agent_id` joins against `subagents/agent-<agent_id>.jsonl`. With no such file, there is no
  `tok`.
- A `tool_use_id` found in more than one file uses the first file read.

#### 3. Index and row

**Files**: `scripts/wal-index.ts`, `shared/api.ts` (`Row`)

**Intent**: A `tok` record becomes a hidden entry. It sets `out` / `res` on its target entry, found through a
`tuid` → call seq map and a `woff` → Stop seq map. `woff` is the WAL offset; `IndexEntry.off` is the target
offset.

**Contract**:
- `IndexEntry` gains `out: number | null`, `res: number | null` and `hidden: boolean`. Every entry sets all
  three, to keep one hidden class.
- `Row` gains `out?: number` and `res?: number`, set only when present.
- Hidden entries count in no `total`, `counts`, facets or rows.

#### 4. Tests

**File**: `scripts/tokens.test.ts` (new)

**Intent**: Build targets from the fixture transcripts plus hand-made WALs that copy their `tool_use_id`s.

**Contract**: Cases:
- A single call.
- Parallel calls split by input size and result size; the parts add up.
- Streamed subagent replies use the final count.
- Compaction gives no `res`.
- An interrupted turn gives no `res`.
- No next request: open while live, Output only after `SessionEnd`.
- A Stop matched by prefix, including a clamped `last_assistant_message`.
- A SubagentStop with no transcript file gives no `tok`.
- A `tok` applied across a restart without duplicates.
- MCP call rows get numbers.
- A session without a WAL: its call rows get `tok` records, and its Stop rows carry `out`.

### Success Criteria:

#### Automated Verification:

- Token tests pass: `node --test scripts/tokens.test.ts`
- All tests pass: `npm test`
- Type check and lint pass: `npm run check && npm run lint`

#### Manual Verification:

- On a real session, the Output / Result of a few large calls are checked by hand against the transcript's
  usage lines

---

## Phase 7: Server — token filter, Tokens order, live frames, bench

### Overview

`/events` filters and orders by Total. `/events-stream` sends token patches and holds rows that a token
filter cannot judge yet. The bench guards the pipeline and the new queries.

### Changes Required:

#### 1. Filter

**File**: `scripts/wal-index.ts` (`matcher`)

**Intent**: Add a Total filter next to the duration filter, with the same rules.

**Contract**:
- Params `min_tok`, `max_tok` and `notok=include`, parsed with `num()`. The filter applies only when a bound
  is set.
- Total = `out + (res ?? 0)` when `out` is set. A row with no `out` passes only with `notok=include`.
- The check goes before `q`.

#### 2. Tokens order

**File**: `scripts/wal-index.ts` (`query`)

**Intent**: With `sort=tokens`, return the matching rows in the "Sort cursor" order, paged. "Sorted pages
with `q`" applies. Without `sort`, nothing changes.

**Contract**:
- `before` in this mode matches `^(-?\d+)\.(-?\d+)\.([0-9a-f-]{36})\.(\d+)$`, and `next` is built in the same
  form.
- The first page still returns `total`, `counts`, `spans`, the facets and `pipe`.
- A `before` in the wrong form for the mode reads as no cursor.

#### 3. Stream frames

**File**: `scripts/wal-server.ts` (`walTick`)

**Intent**: When the scan meets a hidden `tok` entry, it does two things:
- It sends `event: tokens` with `[{sess, seq, out, res?}]` for the target row.
- With a token filter set, it sends the target row as a normal row frame if the row now matches but did not
  match without numbers.

**Contract**:
- `tokens` frames have no `id:` line. The row frames' `id:` vector covers `tok` entries, so a reconnect
  replays them.
- A `sort=tokens` stream is refused with 400.

#### 4. Tests

**Files**: `scripts/query.test.ts`, `scripts/live-tail.test.ts`

**Intent**: Cover the filter, the order and the frames through the server. The fixtures are WALs plus
transcripts with matching `tool_use_id`s.

**Contract**: Cases:
- `min_tok` / `max_tok`, with and without `notok`.
- `sort=tokens` paged with `pageAll` against one full sorted list, with ties and no-data rows last.
- `sort=tokens` combined with `tool` and `q`.
- Time order unchanged without `sort`.
- Live: a call row arrives without numbers, then a `tokens` frame follows once the next request lands.
- With `min_tok`, the row arrives only after its `tok`, and only if it matches.
- A reconnect with `Last-Event-ID` before a `tok` still gets it.
- A late call row arrives with a `t` older than rows already sent.
- A `sort=tokens` stream gets 400.

#### 5. Bench

**Files**: `scripts/bench.ts`, `scripts/bench-sessions.ts`

**Intent**: The fixtures add transcripts with usage and matching `tool_use_id`s. The bench waits for
`/observer` to report `built === total` before it times queries, and it reports the build time.

**Contract**:
- Existing limits stay: first / next page ≤ 300 ms, `q` ≤ 3 s, RSS ≤ 300 MB.
- New checks:
  - Build of the 5 × 20 MB fixture ≤ 30 s.
  - `min_tok` first page ≤ 300 ms.
  - `sort=tokens` first and next page ≤ 300 ms.
  - `sort=tokens` with `q`: first page ≤ 3 s, next page ≤ 300 ms.
- `total` counts rows only (the `ev` and `call` records), and `seq` checks use the row seqs.

### Success Criteria:

#### Automated Verification:

- Query and live-tail tests pass: `node --test scripts/query.test.ts scripts/live-tail.test.ts`
- All tests pass: `npm test`
- Bench passes within its limits: `npm run bench`
- Type check and lint pass: `npm run check && npm run lint`

---

## Phase 8: Web — columns, filter, Order, pipeline UI, README

### Overview

The Events tab shows the numbers, filters by them and offers Tokens order while Live is off. The page shows
the pipeline state.

### Changes Required:

#### 1. Columns

**Files**: `web/src/components/EventTable.tsx`, `web/src/components/EventRow.tsx`

**Intent**: Add Output, Result and Total after Duration. Total uses the same rule as the server.

**Contract**:
- Values use `fmtTokens` (`web/src/lib/tokens.ts:13`), with the exact number in `title`. A row without data
  shows —.
- `colSpan` becomes 9.
- An expanded call row shows its request, response and timespan.

#### 2. Filter

**Files**: `web/src/lib/params.ts`, `web/src/components/FilterPanel.tsx`, `web/src/lib/params.test.ts`

**Intent**: A Tokens section below Duration, the same as Duration: ≥ and ≤ inputs, and a "no tokens: include
/ exclude" switch that is disabled until a bound is set.

**Contract**:
- `Filters` gains `min_tok`, `max_tok` and `notok`, with empty values in `EMPTY_FILTERS`. `FIELDS` maps them,
  and `notok` is sent only when on.
- `filterSummary` adds `tok: 5k–` in the style of `ms:`.
- Tests sit next to the `min_ms` cases.

#### 3. Order and stream

**Files**: `web/src/components/EventsTab.tsx`, `web/src/useEvents.ts`, `web/src/App.tsx`

**Intent**: An **Order: Time / Tokens** button beside View. Order is React state in `App.tsx` beside
`follow`, and it is not stored. Choosing Tokens turns Live off. Turning Live on sets Order back to Time.

**Contract**:
- In Tokens order, `useEvents` sends `sort=tokens`, opens no `EventSource`, and lists rows top-down in server
  order in both views. `loadOlder` uses the same `before`.
- On `event: tokens`, it patches the matching rows by `sess` + `seq`.
- It drops a stream row that it already has. It puts a late row in `cmp` order in both views.
- An order change re-queries. Reset does not change the order.

#### 4. Pipeline state

**Files**: `web/src/components/StatsHeader.tsx` (or the Events head), `web/src/components/Sidebar.tsx`,
`web/src/components/SessionsTab.tsx`, a new `web/src/useObserver.ts`

**Intent**:
- A header chip shows "Indexing <built>/<total>" while the backlog runs. `useObserver` polls `/observer` every
  2 s until `built === total`, then every 10 s.
- A picked session with `pipe.done < pipe.total` shows "building N%" in the Events head.
- A stale session shows a "source changed — rebuild" badge with a Rebuild action that POSTs `/rebuild`. The
  badge comes from `pipe.stale` or an `event: stale` frame.
- In read-only mode, the chip says "read-only — another viewer owns the cache", and Rebuild is hidden.

**Contract**: The Rebuild action uses `ConfirmDialog`, like trash.

#### 5. README

**File**: `README.md`

**Intent**: Document the pipeline and the token features.

**Contract**:
- A new "Pipeline" section: the cache dir, what a target holds, the backlog and progress, stale and rebuild
  (page and `wal rebuild`), read-only mode, and that a session without a WAL gets call and turn rows from
  its transcripts.
- The Events bullet in "The page": call rows, the three columns (split over parallel calls, — when unknown or
  for other rows), the Tokens filter, and Order with its link to Live. Say that a call row can land after
  newer rows, and that its tokens come after the agent's next API call.
- One bullet in "What the numbers mean" for Output / Result / Total.

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Type check and lint pass: `npm run check && npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- First start on real data: the chip counts up to done, and a session opened mid-build shows "building N%"
  and then fills
- On a live session, a new call row appears at its start time, then its numbers fill after the next call
- Tokens filter `≥ 5000` with Live on shows only large calls; new large calls appear once their tokens land
- Order: Tokens turns Live off and lists the largest MCP calls first; scrolling loads more in order
- Turning Live on returns to Time order and the stream resumes
- A session without a WAL shows call and turn rows and its stats; a shrunk WAL copy shows the stale badge, and Rebuild fixes it
- Table header, expanded call rows and the chip look right at narrow and wide widths, in both themes

**Implementation Note**: After this phase passes automated verification, pause for the human's manual
confirmation.

---

## Testing Strategy

### Unit Tests:

- `scripts/target.test.ts`: append, the torn tail, incremental read, shrink, lock.
- `scripts/observer.test.ts`: WAL → `ev` / `call`, resume, stale, budget.
- `scripts/session-view.test.ts`: the golden equality with today's `SessionView` and `usage`.
- `scripts/tokens.test.ts`: the join rules and edge cases.
- `web/src/lib/params.test.ts`: the token params and summary.

### Integration Tests:

- `scripts/observer-server.test.ts`: backlog, loop, stale, rebuild, read-only, CLI.
- `scripts/query.test.ts` and `scripts/live-tail.test.ts`: the filter, the order, frames, late rows.
- The existing `sessions`, `usage`, `trash` and `discovery` tests act as regression guards over the switch.

### Manual Testing Steps:

1. Start `scripts/wal` on real data and watch the Indexing chip finish.
2. Open a session with a WAL and compare its Sessions stats with the old build.
3. Run a live session that calls an MCP tool with a large result. Watch its call row land, then fill.
4. Set Tokens ≥ 5000, then Order: Tokens. Check that the large MCP call is near the top.
5. Copy a WAL, shrink the copy, check the stale badge, then Rebuild.

## Performance Considerations

- A target is about the WAL size plus the call records (request and response again) plus small transcript
  records. Real WALs are at most 7.3 MB.
- A pass reads only new bytes. A restart replays every source once up to its `ck`: about 2 s on today's data,
  in the background.
- Requests sync at most 150 ms. Background slices are at most 50 ms per tick.
- Tokens order scans the whole pick on every page. With `q`, only the first page reads every matching line.
- The bench guards build time, query time and RSS.

## Migration Notes

The first start after this change builds every target from the sources. Until a session's target is built,
the page shows partial rows with progress. No source file changes. Deleting `<config-dir>/wal-viewer/` is a safe full reset.

## References

- Plan review that caused the re-plan: `.ai/changes/wal-observer-pipeline/superseded/plan-review-v1.md`
- Superseded plan v1: `.ai/changes/wal-observer-pipeline/superseded/plan-v1.md`
- Index and paging: `scripts/wal-index.ts:42-260`, `:471-632`
- Parser and store: `scripts/transcripts.ts:115-308`, `scripts/sessions.ts:32-202`
- Server routes and ticks: `scripts/wal-server.ts:101-416`
- POST pattern and trash: `scripts/wal-server.ts:213-283`, `scripts/trash.ts:37-146`
- Append in batches: `scripts/legacy.ts:24`
- Duration filter UI: `web/src/components/FilterPanel.tsx:147-161`, `web/src/lib/params.ts:7-74`
- Data probes: `/tmp/tok-probe/`, `/tmp/prv-script/` (temporary)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Target format, writer, reader, lock

#### Automated

- [x] 1.1 Target tests pass: `node --test scripts/target.test.ts` — 516b183 · verified
- [x] 1.2 Type check passes: `npm run check` — 516b183 · verified
- [x] 1.3 Lint passes: `npm run lint` — 516b183 · verified

### Phase 2: Observer — WAL to target

#### Automated

- [x] 2.1 Observer tests pass: `node --test scripts/observer.test.ts` — bafbfc1 · verified
- [x] 2.2 Type check passes: `npm run check` — bafbfc1 · verified
- [x] 2.3 Lint passes: `npm run lint` — bafbfc1 · verified

### Phase 3: Observer — transcripts to target

#### Automated

- [x] 3.1 Golden test passes: `node --test scripts/session-view.test.ts` — d8689e0 · verified
- [x] 3.2 Observer tests still pass: `node --test scripts/observer.test.ts` — d8689e0 · verified
- [x] 3.3 Type check and lint pass: `npm run check && npm run lint` — d8689e0 · verified

### Phase 4: Readers switch to targets

#### Automated

- [x] 4.1 All tests pass: `npm test` — 90f90bd · verified
- [x] 4.2 Type check and lint pass: `npm run check && npm run lint` — 90f90bd · verified
- [x] 4.3 No raw WAL or transcript read remains outside `observer.ts`, `discovery.ts`, `trash.ts` and `legacy.ts` — 90f90bd · verified

#### Manual

- [ ] 4.4 With the viewer on real data, Events and Sessions show the same numbers as before the change for a session with a WAL

### Phase 5: Background loop, progress, stale and rebuild

#### Automated

- [x] 5.1 Server observer tests pass: `node --test scripts/observer-server.test.ts` — 5e1900b · verified
- [x] 5.2 All tests pass: `npm test` — 5e1900b · verified
- [x] 5.3 Type check and lint pass: `npm run check && npm run lint` — 5e1900b · verified

### Phase 6: Token join

#### Automated

- [x] 6.1 Token tests pass: `node --test scripts/tokens.test.ts` — 083ea1e · verified
- [x] 6.2 All tests pass: `npm test` — 083ea1e · verified
- [x] 6.3 Type check and lint pass: `npm run check && npm run lint` — 083ea1e · verified

#### Manual

- [ ] 6.4 On a real session, the Output / Result of a few large calls are checked by hand against the transcript's usage lines

### Phase 7: Server — token filter, Tokens order, live frames, bench

#### Automated

- [x] 7.1 Query and live-tail tests pass: `node --test scripts/query.test.ts scripts/live-tail.test.ts` — d56004e · verified
- [x] 7.2 All tests pass: `npm test` — d56004e · verified
- [x] 7.3 Bench passes within its limits: `npm run bench` — d56004e · verified
- [x] 7.4 Type check and lint pass: `npm run check && npm run lint` — d56004e · verified

### Phase 8: Web — columns, filter, Order, pipeline UI, README

#### Automated

- [x] 8.1 All tests pass: `npm test` — dee6327 · verified
- [x] 8.2 Type check and lint pass: `npm run check && npm run lint` — dee6327 · verified
- [x] 8.3 Build passes: `npm run build` — dee6327 · verified

#### Manual

- [ ] 8.4 First start on real data: the chip counts up to done, and a session opened mid-build shows "building N%" and then fills
- [ ] 8.5 On a live session, a new call row appears at its start time, then its numbers fill after the next call
- [ ] 8.6 Tokens filter `≥ 5000` with Live on shows only large calls; new large calls appear once their tokens land
- [ ] 8.7 Order: Tokens turns Live off and lists the largest MCP calls first; scrolling loads more in order
- [ ] 8.8 Turning Live on returns to Time order and the stream resumes
- [ ] 8.9 A session without a WAL shows call and turn rows and its stats; a shrunk WAL copy shows the stale badge, and Rebuild fixes it
- [ ] 8.10 Table header, expanded call rows and the chip look right at narrow and wide widths, in both themes
