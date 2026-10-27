# Token columns, token filter and Tokens order in the Events view — Implementation Plan

## Overview

Each tool-call row on the Events tab gets three token numbers: **Result** (the tokens the call's
result added to context), **Output** (the issuing message's output tokens, split over its
parallel calls) and **Total** (Result + Output). The filter panel gets a ≥ / ≤ token filter with a
"no tokens" switch, like Duration. The head gets an **Order: Time / Tokens** control that lists the
largest calls first. Main use: find the largest calls, for example MCP calls.

All numbers come from the `context` field that the `wal-hook` writes on `PostToolUse`,
`PostToolUseFailure`, `Stop` and `SubagentStop`. The viewer reads no transcripts for this.

## Current State Analysis

- The hook writes `context: {tokens, output, model}`: the firing agent's last API call, where
  `tokens = input + cache_read + cache_creation` (`plugins/wal-hook/hooks/wal-hook.mjs:107-130`).
  At `PostToolUse` that last call is the message that issued the tool call. It has no message id.
- The WAL index does not read `context`. `IndexEntry` (`scripts/wal-index.ts:42-59`) has `dur`,
  `tuid` and `agent`, but no tokens. `WalLine` (`:20-29`) lists the fields `indexLine` reads.
- Virtual "MCP call" rows are a copy of the Post entry (`scripts/wal-index.ts:201`), made when the
  Post arrives. A later change to the Post entry does not reach the copy.
- The filters are in `matcher` (`scripts/wal-index.ts:471-509`). The duration filter is
  `min_ms` / `max_ms` / `nodur=include`.
- Paging is a k-way merge on `(t, sess, seq)` with a `before` cursor `<t>.<sess>.<seq>`
  (`scripts/wal-index.ts:520-632`). There is no other order.
- `/events-stream` sends new rows per 250 ms tick, from a per-client position vector
  (`scripts/wal-server.ts:143-190`). It never re-sends a row.
- The web table has 6 fixed columns (`web/src/components/EventTable.tsx:97-104`,
  `EventRow.tsx:51-83`, `colSpan={6}`). The filters are in `web/src/lib/params.ts`
  (`Filters`, `EMPTY_FILTERS`, `FIELDS`, `buildParams`, `filterSummary`). Live is the `follow`
  state in `web/src/App.tsx:34`. `fmtTokens` is in `web/src/lib/tokens.ts:13`.
- The bench (`scripts/bench.ts`) checks first page ≤ 300 ms, next page ≤ 300 ms, `q` ≤ 3 s and
  RSS ≤ 300 MB, on 5 × 20 MB WALs without `context`.

## Desired End State

- Post, PostFailure, MCP call, Stop and SubagentStop rows show Result / Output / Total once known.
  A row that waits for the next API call shows `…`, and it fills in place on a live stream.
  Every other row shows —.
- `min_tok` / `max_tok` filter on Total. `notok=include` keeps the rows without numbers.
- `sort=tokens` lists the matching rows by Total, largest first, with paging. It is offered only
  while Live is off.
- `npm run check`, `npm run lint`, `npm test` and `npm run bench` pass.

### Key Discoveries:

- `context` is written at `PostToolUse` time, before the next request. So a Post's `context` is
  the issuing message, and the next different `context` in the same agent is the next request
  (`plugins/wal-hook/hooks/wal-hook.mjs:21-25`).
- One message with N parallel tool calls gives N Posts with the same `context`. Output and prompt
  growth are per message, not per call.
- The hook clamps strings to 2000 chars with a `…[+N chars]` marker, and arrays to 50 items with
  `…[+N items]` (`wal-hook.mjs:47-60`). A line over 96 000 chars loses its `payload` but keeps
  `context` (`wal-hook.mjs:199-203`).
- `summary()` (`scripts/wal-index.ts:511-518`) is the only place that builds a `Row`.
- Stream rows are not re-sent, so late numbers need their own frame.

## What We're NOT Doing

- No transcript reads or joins. Sessions recorded before the hook wrote `context` show — and
  take no part in the token filter or Tokens order.
- No Tokens order while Live is on, and no live insertion of rows into a sorted list.
- No input / cache-read / cache-write columns, and no cost per row.
- No selector for which column the filter and sort use: they always use Total.
- No version bumps: the release commit does them.

## Implementation Approach

The attribution runs in the WAL index, in file order, as each line is indexed:

1. Each agent (`agent_id`, null for main) has at most one **open group**. A group is the message
   key, its `prompt` (`context.tokens`), its `output`, and its member rows.
2. A Post / PostFailure with `context` joins the open group when its key matches. Otherwise it
   first **closes** the open group, then opens a new one. The key is `context.id`. A record
   without `id` (older hook) matches by an equal `context.tokens`.
3. A Stop / SubagentStop with `context` closes the agent's open group, using its own `context` as
   the next request. Then it gets `out = context.output` and `res = null` at once.
4. Closing a group, with `next` = the next request's prompt:
   - `growth = next − prompt − output`. When `growth < 0` (a compaction), every member gets
     `res = null`.
   - `res` is `growth` split by each member's result size.
   - `out` is `output` split by each member's input size.
   - A member with an unknown size makes the split of that group even.
   - The split rounds so that the parts add up to the whole.
5. A closed group writes `out` / `res` to each member entry and to its virtual MCP call entry. It
   then appends their seqs to a per-index **resolved log**.

The token filter and Tokens order run in the server query. The stream sends `event: tokens`
frames from the resolved log. The web table shows the columns and applies the frames.

## Critical Implementation Details

**Total and "no data".** Total is `out + (res ?? 0)` when `out` is set. A row with `out === null`
has no data: the filter removes it unless `notok=include`, and Tokens order puts it last. A
pending row (open group) counts as no data in a query.

**Virtual rows.** The MCP call entry is a copy, so a group member records both seqs (Post and
virtual). Closing a group writes both.

**Stream hold-back.** With a token filter set, the stream cannot judge a pending row. It holds
the row and checks it again when its seq enters the resolved log. It must not advance past the
row and lose it. A truncation (new `gen`) clears the held rows with everything else.
- The frame `id:` vector gives, per index, min(first held seq, `entries.length`). A reconnect
  then rescans from the oldest held row, so no held row is lost.
- A rescan can send a row again. The page drops a row whose `sess` + `seq` it already has.
- A held row can arrive after newer rows. The page puts it in `cmp` order, not at the end.
- A row can stay held for a long time: until the agent's next API call, which can come after a
  whole subagent run or the next user turn.

**Sorted pages with `q`.** On a page after the first, the scan applies the filter without `q`,
sorts the rows below the cursor, and then tests `q` in that order until `limit + 1` hits. Only
the first page runs `q` on every row, because it returns `total` and `counts`.

**Payload sizes.** A member's size is the length of `JSON.stringify` of the value
(`payload.tool_input` for input; `payload.tool_response`, else `payload.error`, for result), plus
every N in `…[+N chars]` markers inside it. Item markers (`…[+N items]`) count as unknown, so
that group splits evenly.

**Sort cursor.** In Tokens order, `before` is `<total>.<t>.<sess>.<seq>`, with `total = -1` for
no data. Rows order by `(total, t, sess, seq)` descending. Each page is one scan of the pick that
keeps the top `limit` rows below the cursor. No second order is kept in the index.

## Phase 1: Hook — message id in `context`

### Overview

The hook records the issuing message's id, so the index can group parallel calls exactly.

### Changes Required:

#### 1. Hook

**File**: `plugins/wal-hook/hooks/wal-hook.mjs`

**Intent**: `lastUsage` also returns the `message.id` of the line it found, when that is a string.

**Contract**: `context` becomes `{tokens, output, model, id?}`. `id` is omitted when the line has
no `message.id`. The header comment at `:21-23` names the new field.

#### 2. Hook tests

**File**: `plugins/wal-hook/hooks/wal-hook.test.sh`

**Intent**: The `context` checks expect `id` where the fixture lines have a `message.id`. Add one
case for a line without `message.id`, which has no `id`.

**Contract**: Same `check` helper, same `context_of` shape.

#### 3. README

**File**: `README.md` (the `context` paragraph in "What the hook captures")

**Intent**: Name `id` as the message id of that last call.

**Contract**: The prose of that paragraph only.

### Success Criteria:

#### Automated Verification:

- Hook tests pass: `bash plugins/wal-hook/hooks/wal-hook.test.sh`
- Lint passes: `npm run lint`

#### Manual Verification:

- A new session recorded with the updated hook has `context.id` on its PostToolUse lines

---

## Phase 2: Index — token attribution

### Overview

The WAL index gives each tool-call and Stop row its `out` / `res` numbers.

### Changes Required:

#### 1. Index entry and parsing

**File**: `scripts/wal-index.ts`

**Intent**: Read `context` and the payload sizes. Keep the open group per agent. Close groups as
described in "Implementation Approach". Write `out` / `res` to members and their virtual rows,
and append to the resolved log. A truncation or a new file resets the groups and the log with the
rest of the index.

**Contract**:
- `WalLine` gains `context?: {tokens?: unknown; output?: unknown; id?: unknown}` and
  `payload.tool_input` / `tool_response` / `error` as `unknown`.
- `IndexEntry` gains `out: number | null`, `res: number | null` and `pend: boolean`. `pend` is
  true while the row's group is open. Every entry sets all three, to keep one hidden class.
- `WalIndex` gains `resolved: number[]`: the seqs that left `pend`, in order.
- A `context` whose `tokens` or `output` is not a finite number ≥ 0 counts as no `context`.

#### 2. Row

**Files**: `shared/api.ts`, `scripts/wal-index.ts` (`summary`)

**Intent**: Rows carry the numbers to the page.

**Contract**: `Row` gains `out?: number`, `res?: number` and `pend?: true`, each set only when
present (like `mcp` / `err`). The `Row` comment says what each one means.

#### 3. Unit tests

**File**: `scripts/wal-tokens.test.ts` (new; matches the `node --test scripts/*.test.ts` glob)

**Intent**: Build an index over a temp WAL with `createWalIndex` and `tail()`, and check the
attribution.

**Contract**: Cases:
- One call, closed by a later call.
- One call, closed by Stop.
- Three parallel calls, split by result and input size; the parts add up to the whole.
- Grouping by `id`, and by an equal `tokens` value without `id`.
- A dropped payload, and an `…[+N items]` marker, both giving an even split.
- Compaction (negative growth) giving `res: null`.
- An open group staying `pend`.
- MCP Pre/Post getting its virtual row's numbers.
- Subagent and main groups kept apart.
- Old records without `context` giving no data.
- Stop / SubagentStop rows with `out` only.
- `resolved` order.
- Truncation resetting the state.

### Success Criteria:

#### Automated Verification:

- New unit tests pass: `node --test scripts/wal-tokens.test.ts`
- Type check passes: `npm run check`
- All tests pass: `npm test`
- Lint passes: `npm run lint`

---

## Phase 3: Server — token filter and Tokens order

### Overview

`/events` filters by Total and can order the rows by Total, largest first.

### Changes Required:

#### 1. Filter

**File**: `scripts/wal-index.ts` (`matcher`)

**Intent**: Add a Total filter next to the duration filter, with the same rules.

**Contract**: Params `min_tok`, `max_tok` and `notok=include`, parsed with `num()`. It applies only
when a bound is set. A no-data row (including `pend`) passes only with `notok=include`. The check
goes before `q`, so `q` still reads the disk last.

#### 2. Tokens order

**File**: `scripts/wal-index.ts` (`query`)

**Intent**: With `sort=tokens`, return the matching rows by `(total, t, sess, seq)` descending,
paged with the sort cursor. Without it, nothing changes.

**Contract**:
- `before` in this mode matches `^(-?\d+)\.(-?\d+)\.([0-9a-f-]{36})\.(\d+)$`, and `next` is built
  in the same form.
- The first page still returns `total`, `counts`, `spans` and the facets of the whole match.
- `head` and `gens` are unchanged.
- A `before` in the wrong form for the mode reads as no cursor, as today.

#### 3. Query tests

**File**: `scripts/query.test.ts`

**Intent**: Cover the filter and Tokens order through the server.

**Contract**: Fixtures with `context` on Post / Stop lines, including one MCP pair and one old
session without `context`. Cases:
- `min_tok` / `max_tok`, with and without `notok`.
- `sort=tokens`, checked page by page with `pageAll` against one full sorted list, with ties and
  no-data rows last.
- `sort=tokens` combined with `tool` and `q`.
- Time order unchanged when `sort` is absent.

### Success Criteria:

#### Automated Verification:

- Query tests pass: `node --test scripts/query.test.ts`
- All tests pass: `npm test`
- Type check and lint pass: `npm run check && npm run lint`

---

## Phase 4: Server — live token frames and bench

### Overview

A live stream fills `…` rows when their numbers arrive, and the bench guards the new work.

### Changes Required:

#### 1. Token frames

**File**: `scripts/wal-server.ts` (`walTick`, the `/events-stream` handler, `Client`)

**Intent**: Each tick, send the rows that left `pend` since the client's last resolved position,
for rows the client already has. Hold back pending rows while a token filter is set. Send them
once they resolve and match, and drop them if they do not match.

**Contract**:
- New SSE frame `event: tokens`. Its data is `[{sess, seq, out?, res?}]`. It has no `id:` line,
  so `Last-Event-ID` stays the row vector.
- The client's start position in each `resolved` log comes from a new param `rafter` (a position
  vector like `after`), else the current log length.
- A frame may repeat on reconnect. Patches are idempotent.
- Held rows are sent as normal row frames, in `cmp` order with the tick's other new rows.
- The frame `id:` vector uses min(first held seq, `entries.length`) per index (see "Stream
  hold-back").
- A `sort=tokens` stream is refused with 400 (the page never opens one).

#### 2. First page

**Files**: `scripts/wal-index.ts` (`query`), `shared/api.ts` (`Page`)

**Intent**: The page learns where the resolved logs stand at query time, so no resolution between
the query and the stream is missed.

**Contract**: `Page` gains `rhead: string`, a `vector` of `resolved.length` per index.

#### 3. Live-tail tests

**File**: `scripts/live-tail.test.ts`

**Intent**: Cover the frames and the hold-back.

**Contract**: Cases:
- A Post appended while streaming arrives with `pend`, then a `tokens` frame follows when the
  next call lands.
- With `min_tok`, the row arrives only after it resolves, and only if it matches.
- `rafter` from the first page catches a resolution that happened before the stream opened.
- A reconnect with `Last-Event-ID` while a row is held still delivers that row.
- A truncation still resets.

#### 4. Bench

**File**: `scripts/bench.ts`

**Intent**: The bench fixture writes `context` (with `id`, and parallel groups) on Post / Stop
lines. It adds checks for a `min_tok` first page and for `sort=tokens` first and next pages.

**Contract**: Existing limits stay. New checks: `sort=tokens` first page ≤ 300 ms, next page
≤ 300 ms, `min_tok` first page ≤ 300 ms, `sort=tokens` with `q` first page ≤ 3 s and next page
≤ 300 ms. RSS ≤ 300 MB with the new fields.

### Success Criteria:

#### Automated Verification:

- Live-tail tests pass: `node --test scripts/live-tail.test.ts`
- All tests pass: `npm test`
- Bench passes within its limits: `npm run bench`
- Type check and lint pass: `npm run check && npm run lint`

---

## Phase 5: Web — columns, filter, Order control, README

### Overview

The Events tab shows the numbers, filters by them and offers Tokens order while Live is off.

### Changes Required:

#### 1. Columns

**Files**: `web/src/components/EventTable.tsx`, `web/src/components/EventRow.tsx`

**Intent**: Add Result, Output and Total after Duration. Total is computed from the row with the
same rule as the server.

**Contract**:
- Values use `fmtTokens`, with the exact number on hover (`title`).
- A row with `pend` shows `…`, and a row with no data shows —.
- `colSpan` becomes 9.

#### 2. Filter

**Files**: `web/src/lib/params.ts`, `web/src/components/FilterPanel.tsx`, `web/src/lib/params.test.ts`

**Intent**: A Tokens section below Duration, the same as Duration: ≥ and ≤ inputs, and a
"no tokens: include / exclude" switch that is disabled until a bound is set.

**Contract**:
- `Filters` gains `min_tok`, `max_tok` and `notok`, with empty values in `EMPTY_FILTERS`.
- `FIELDS` maps them, and `notok` is sent only when on.
- `filterSummary` adds `tok: 5k–` in the same style as `ms:`.
- Add tests next to the `min_ms` cases.

#### 3. Order control and stream

**Files**: `web/src/components/EventsTab.tsx`, `web/src/useEvents.ts`, `web/src/App.tsx`

**Intent**: An **Order: Time / Tokens** button beside View. Order is React state held in
`App.tsx` beside `follow`, and it is not stored. Choosing Tokens turns Live off. Turning Live on
sets Order back to Time.

**Contract**:
- In Tokens order, `useEvents` sends `sort=tokens`, opens no `EventSource`, and lists the rows
  top-down in server order in both views. `loadOlder` uses the same `before` cursor.
- In Time order, it passes `rafter` from the first page to the stream.
- On `event: tokens`, it patches matching rows in `rows` and `pending` by `sess` + `seq`.
- It drops a stream row whose `sess` + `seq` it already has. It puts a late row in `cmp` order
  in both views.
- An order change re-queries, as a view change does. Reset does not change the order.

#### 4. README

**File**: `README.md` ("The page", the Events bullet)

**Intent**: Describe the three columns and what they mean (split over parallel calls, `…` while
pending, — for older sessions), the Tokens filter, and Order with its link to Live. Say that
with a token filter in Live, a row can wait until the agent's next API call.

**Contract**: The Events bullet in "The page", plus one bullet in "What the numbers mean".

### Success Criteria:

#### Automated Verification:

- All tests pass: `npm test`
- Type check and lint pass: `npm run check && npm run lint`
- Build passes: `npm run build`

#### Manual Verification:

- On a live session, a new tool row shows `…`, then fills after the next call
- Tokens filter `≥ 5000` with Live on shows only large calls; new large calls appear once resolved
- Order: Tokens turns Live off and lists the largest MCP calls first; scrolling loads more in order
- Turning Live on returns to Time order and the stream resumes
- An old session (no `context`) shows — and is hidden by a token filter unless "no tokens: include"
- Table header and expanded rows look right at narrow and wide widths, in both themes

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- Attribution in `scripts/wal-tokens.test.ts`: groups, splits, rounding, compaction, Stop rows,
  virtual rows, old records, truncation.
- `web/src/lib/params.test.ts`: the token params and summary.

### Integration Tests:

- `scripts/query.test.ts`: the filter and Tokens order, paged through the real server.
- `scripts/live-tail.test.ts`: `tokens` frames, hold-back, `rafter`, reset.
- `plugins/wal-hook/hooks/wal-hook.test.sh`: `context.id`.

### Manual Testing Steps:

1. Install the updated hook. Start a session that calls an MCP tool with a large result.
2. Run `scripts/wal`, pick the session, and watch the row go from `…` to numbers.
3. Set Tokens ≥ 5000, then Order: Tokens. Check that the large MCP call is near the top.
4. Pick an old session and check for — and the "no tokens" switch.

## Performance Considerations

- Three fields per entry and one open group per agent. Bench RSS must stay ≤ 300 MB.
- `JSON.stringify` of the input and result per Post line runs once at index time, on lines of at
  most 96 000 chars.
- Tokens order scans the whole pick on every page. With `q`, that is a disk read of every matching
  row per page, the same cost as a first page with `q` today.

## Migration Notes

No data migration. Old WAL lines have no `context` and show —. Lines from the hook before Phase 1
have `context` without `id`, and they group by an equal `tokens` value.

## References

- Hook `context`: `plugins/wal-hook/hooks/wal-hook.mjs:107-196`
- Index and paging: `scripts/wal-index.ts:42-202`, `:471-632`
- Stream tick: `scripts/wal-server.ts:143-190`, `:300-330`
- Duration filter UI: `web/src/components/FilterPanel.tsx:147-161`, `web/src/lib/params.ts:7-74`
- Prior change with filter patterns: `.ai/archive/2026-10-09-wal-filter-panel/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Hook — message id in `context`

#### Automated

- [ ] 1.1 Hook tests pass: `bash plugins/wal-hook/hooks/wal-hook.test.sh`
- [ ] 1.2 Lint passes: `npm run lint`

#### Manual

- [ ] 1.3 A new session recorded with the updated hook has `context.id` on its PostToolUse lines

### Phase 2: Index — token attribution

#### Automated

- [ ] 2.1 New unit tests pass: `node --test scripts/wal-tokens.test.ts`
- [ ] 2.2 Type check passes: `npm run check`
- [ ] 2.3 All tests pass: `npm test`
- [ ] 2.4 Lint passes: `npm run lint`

### Phase 3: Server — token filter and Tokens order

#### Automated

- [ ] 3.1 Query tests pass: `node --test scripts/query.test.ts`
- [ ] 3.2 All tests pass: `npm test`
- [ ] 3.3 Type check and lint pass: `npm run check && npm run lint`

### Phase 4: Server — live token frames and bench

#### Automated

- [ ] 4.1 Live-tail tests pass: `node --test scripts/live-tail.test.ts`
- [ ] 4.2 All tests pass: `npm test`
- [ ] 4.3 Bench passes within its limits: `npm run bench`
- [ ] 4.4 Type check and lint pass: `npm run check && npm run lint`

### Phase 5: Web — columns, filter, Order control, README

#### Automated

- [ ] 5.1 All tests pass: `npm test`
- [ ] 5.2 Type check and lint pass: `npm run check && npm run lint`
- [ ] 5.3 Build passes: `npm run build`

#### Manual

- [ ] 5.4 On a live session, a new tool row shows `…`, then fills after the next call
- [ ] 5.5 Tokens filter `≥ 5000` with Live on shows only large calls; new large calls appear once resolved
- [ ] 5.6 Order: Tokens turns Live off and lists the largest MCP calls first; scrolling loads more in order
- [ ] 5.7 Turning Live on returns to Time order and the stream resumes
- [ ] 5.8 An old session (no `context`) shows — and is hidden by a token filter unless "no tokens: include"
- [ ] 5.9 Table header and expanded rows look right at narrow and wide widths, in both themes
