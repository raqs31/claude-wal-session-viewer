# WAL sort capabilities Implementation Plan

## Overview

Sortable table headers replace the `Order: Time/Tokens` button. The separate Date and Time columns become one Datetime column. The table gets two new token columns:
- **Input**: the fresh input tokens of the reply behind a call or Stop.
- **Total+In**: In + Out + Res.

When Live and Tail are both off, the user can sort by Duration, Input, Output, Result, Total or Total+In, in either direction. The goal is to find the actions that use the most tokens.

## Current State Analysis

- **Order toggle.** The web has one toggle, `button#order`, at `web/src/components/EventsTab.tsx:210-219`. Its state is `Order = 'time' | 'tokens'` (`web/src/useEvents.ts:8`, `web/src/App.tsx:37`).
  - Tokens adds `sort=tokens` (`useEvents.ts:64`), turns Live off and forces Table view (`EventsTab.tsx:233`).
  - Turning Live on sets the order back to Time (`EventsTab.tsx:197-199`).
- **Static headers.** The table header is static, with 9 columns (`web/src/components/EventTable.tsx:96-108`).
  - Date and Time are two cells that both read `r.t` (`web/src/components/EventRow.tsx:182-183`). The formatters are `fmtDate` and `fmtTime` in `web/src/lib/format.ts`.
  - Total is drawn as `out + (res ?? 0)` (`EventRow.tsx:213`).
- **Server sort.** The server knows only `sort=tokens` (`scripts/wal-index.ts:708`).
  - `byTokens` (`:634-698`) scans the whole pick on each page. It keeps the top `limit+1` rows by Total. A row with no Total sorts as -1, and ties break by `cmp`.
  - The cursor is `TOK_CURSOR` `<total>.<t>.<sess>.<seq>` (`:587`).
- **Token fields.** A row has only `out` and `res`, from hidden `tok` entries. They are applied at `wal-index.ts:266-298` and emitted by `summary()` (`:557`).
  - The observer computes them in `callTok` and `stopOut` (`scripts/observer.ts:728-768`).
  - The source is transcript `UsageRecord`s, with `input`, `cacheRead`, `cacheWrite5m` and `cacheWrite1h` (`scripts/transcripts.ts:106-111`).
  - Per-row input tokens are not stored anywhere.
- **Stream.** `/events-stream` returns 400 for `sort=tokens` (`scripts/wal-server.ts:580`).
  - `event: tokens` frames carry `{sess, seq, out, res}` patches (`wal-server.ts:280-282`, `shared/api.ts:61`).
- **Tests.** The tests use `node --test`.
  - Server tests: `scripts/query.test.ts` (sort at `:844-864`), `scripts/live-tail.test.ts` (tokens frames at `:405-416`, 400 at `:493`), `scripts/tokens.test.ts`.
  - Web tests are pure logic only: `web/src/lib/*.test.ts`.
  - Bench: `scripts/bench.ts:192-210` covers `sort=tokens`.

## Desired End State

- **Columns.** The table has these columns, in order: Datetime, Event, Tool, Duration, Input, Output, Result, Total, Total+In, Session. Datetime reads `YYYY-MM-DD HH:MM:SS.mmm`.
- **Header sort.** With Live off and View = Table, clicking the header of Duration, Input, Output, Result, Total or Total+In cycles the sort:
  1. Largest first.
  2. Smallest first.
  3. Back to the default datetime order.
  - Clicking the Datetime header also resets to the default.
  - The active header shows an arrow. Paging through all rows keeps the order.
- **Live or Tail on.** The sortable headers look inert and have a tooltip. Turning Live or Tail on resets the sort to the default.
- **No Order button.**
- **API.** The server accepts `sort=inp|out|res|tot|all|dur` and `dir=asc|desc`, where `desc` is the default. `sort=tokens` is gone. `/events-stream` returns 400 for any `sort`.
- **Input data.** New sessions get `inp` on call and Stop rows from the observer join. Old sessions show `—` in Input until the user runs Rebuild. `tokens` stream frames carry `inp`.
- **Verification.** `npm test`, `npm run check` and `npm run lint` all pass. The bench passes its sort timing checks.

### Key Discoveries:

- `in` is a JS reserved word. `const { in } = …` does not compile, so the field is named `inp` everywhere: the record, the index entry, `Row`, the frame and the sort key.
- `share(total, weights, i)` (`scripts/observer.ts:166`) already splits a reply's number over parallel calls. Its parts add up to the total. `inp` uses it with the same weights as `out`.
- `tok` records are parsed from target files. Old records with no `inp` parse as no data, so no format version bump is needed (`scripts/target.ts:63-64`).
- `/rebuild` deletes and rebuilds the targets (`scripts/observer.ts:954`). This is the path that fills `inp` for old sessions.

## What We're NOT Doing

- No sort by Event, Tool or Session, and no ascending datetime order. Time paging stays newest first.
- No sort under Live or Tail, and no live insertion of rows in a sorted view.
- No change to the `min_tok`, `max_tok` and `notok` filters. They still use Total (Out + Res).
- No forced re-index of existing sessions.
- The sort is not saved across reloads and not put in the URL.
- No cache-read column, no cost in money, and no tokenizer estimate from `tool_input`.
- No precomputed sort index. The per-page full scan stays, as in `byTokens`.

## Implementation Approach

The work is three vertical layers, done bottom up. Each layer has its own tests.

1. **Data.** Add `inp` to the token join and carry it through every structure that carries `out`.
2. **Query.** Make `byTokens` a generic `byKey` with a key function and a direction. The cursor carries the key value.
3. **UI.** Replace the Order state with a `{key, dir} | null` sort state. Headers drive it, and the existing guards drive the Live and Tail rules.

## Critical Implementation Details

- **Missing values sort last in both directions.** A row with no value for the key (no `tok` yet, or `dur` null) stays after every row with a value, for `asc` too. The cursor must encode "no value" so paging can pass from valued rows into valueless rows. Ties between rows keep the current time tie-break (`cmp`) in both directions.
- **Order of state changes in the web.** Turning Live on, or switching View to Tail, must reset the sort to `null` in the same handler. If it does not, one render opens an `EventSource` with a sort. The server rejects it with 400, which leaves the stream dot in an error state.

## Phase 1: Input tokens end to end (server)

### Overview

Compute fresh input per call and Stop row in the observer join. Store it in `tok` records and the index. Expose it on `Row` and in `tokens` stream frames.

### Changes Required:

#### 1. Token join

**File**: `scripts/observer.ts`

**Intent**: `callTok` sets `inp` from fresh input. Fresh input is `input + cacheWrite5m + cacheWrite1h` of the reply behind the call. `inp` is split over the reply's parallel calls with the same weights as `out`. `stopOut` returns the full fresh input of its reply together with `out`. `joinTokens` puts `inp` on the Stop `tok`.

**Contract**:
- Every `tok` the join emits carries `inp: number`.
- `stopOut` returns `{ out, inp } | null` instead of `number | null`.

#### 2. Target record

**File**: `scripts/target.ts`

**Intent**: Both `tok` variants of `TargetRecord` get an optional `inp`. Old target files stay readable.

**Contract**: `{ k: 'tok'; tuid; out; res?; inp? }` and `{ k: 'tok'; woff; out; inp? }`.

#### 3. Index entry and Row

**Files**: `scripts/wal-index.ts`, `shared/api.ts`

**Intent**:
- `IndexEntry` gets `inp: number | null`. When a `tok` entry is applied, it sets `target.inp`, and the hidden entry records the previous `inp` next to `out` and `res`.
- `summary()` emits `inp` when it is not null.
- `Row` gets `inp?: number`, with a comment: the fresh input tokens of the reply behind the row, split like `out`.
- `TokensFrame` adds `inp` to its `Pick`.

**Contract**: `Row.inp?: number`. `TokensFrame = Pick<Row, 'sess' | 'seq' | 'out' | 'res' | 'inp'>`.

#### 4. Stream patches

**File**: `scripts/wal-server.ts`

**Intent**: The `tokens` frame patch at `:280-282` includes `inp`.

**Contract**: The patch shape is `TokensFrame`.

### Success Criteria:

#### Automated Verification:

- `scripts/tokens.test.ts` has these cases, and they pass with `node --test scripts/tokens.test.ts`:
  - A single call gets `inp` = input + cache writes.
  - Two parallel calls split `inp` by input size, and the parts add up to the reply's fresh input.
  - A Stop gets the full `inp`.
- `scripts/query.test.ts` shows `inp` on rows after a `tok` lands, and no `inp` for a `tok` record that has none (an old target). Run: `node --test scripts/query.test.ts`.
- `scripts/live-tail.test.ts` shows `tokens` frames that carry `inp`. Run: `node --test scripts/live-tail.test.ts`.
- Type check passes: `npm run check`.

#### Manual Verification:

- After Rebuild of one real session, `/events?ids=<id>` returns rows with `inp`. Each value is near the reply's `input + cache_creation` in the transcript.

**Implementation Note**: When all automated checks pass, stop. Wait for the human to confirm the manual check before you start the next phase.

---

## Phase 2: Generic sort keys (server)

### Overview

`sort=tokens` becomes `sort=<key>&dir=<asc|desc>`, and the server sorts by any of six keys.

### Changes Required:

#### 1. Sort scan

**File**: `scripts/wal-index.ts`

**Intent**: Make `byTokens` a generic `byKey`. It takes a key function and a direction.
- The keys:
  - `inp`: `e.inp`
  - `out`: `e.out`
  - `res`: `e.res`
  - `tot`: `tokensOf(e)`, which is Out + Res
  - `all`: `inp + out + res`, null until `out` lands. A missing part counts as 0.
  - `dur`: `e.dur`
- Missing values go last in both directions.
- Ties use the existing `cmp` tie-break.
- The `lazy` `q` path and the `first` counts stay as they are.
- `query()` dispatches on a valid `sort` key. An unknown `sort`, or an unknown `dir`, falls back to time order. This matches today, where an unknown `sort` gives time order.
- Remove the `sort=tokens` branch.

**Contract**:
- Query params: `sort ∈ {inp,out,res,tot,all,dur}` and `dir ∈ {asc,desc}`. `desc` is the default.
- The cursor is `before=<v>.<t>.<sess>.<seq>`, where `<v>` is the key value, or `n` when the row has no value.
- The regex replaces `TOK_CURSOR`. `<v>` is the number as JS prints it (fraction and exponent allowed) or `n`: `-?\d+(?:\.\d+)?(?:e[+-]\d+)?|-?Infinity|n`. Clients URL-encode the cursor.
- `next` is null on the last page.

#### 2. Stream rejection

**File**: `scripts/wal-server.ts`

**Intent**: `/events-stream` returns 400 when any `sort` param is present, not only `sort=tokens`.

**Contract**: The 400 body says that a sorted view cannot stream.

#### 3. Bench

**File**: `scripts/bench.ts`

**Intent**: Use `sort=tot` instead of `sort=tokens`. Add one `sort=dur&dir=asc` page check with the same 300 ms limit.

**Contract**: The check names use the new param.

### Success Criteria:

#### Automated Verification:

- In `scripts/query.test.ts`, the sort cases from `:844-864` are rewritten for `sort=tot`. New cases check each key in both directions:
  - Paging over all rows gives the same order as a full sort.
  - Rows with no value come last, for `asc` too.
  - `q` with paging still gives full, ordered pages.
  - An unknown `sort` gives time order.
- In `scripts/live-tail.test.ts`, `/events-stream?sort=dur` returns 400.
- Full suite passes: `npm test`.
- Type check passes: `npm run check`.
- Lint passes: `npm run lint`.

#### Manual Verification:

- `npm run bench` passes all its checks on this host. Check `free -m` first, because the bench builds a large data set.

**Implementation Note**: When all automated checks pass, stop. Wait for the human to confirm the manual check before you start the next phase.

---

## Phase 3: Sortable headers and new columns (web)

### Overview

The Order button goes away, and the table headers drive the sort. Date and Time become one column. Input and Total+In are new columns.

### Changes Required:

#### 1. Sort state logic

**File**: `web/src/lib/sort.ts` (new), with `web/src/lib/sort.test.ts`

**Intent**: Put the sort rules in one place so `node --test` can test them without a DOM. There are three rules:
- The click cycle: `null`, then `{key, 'desc'}`, then `{key, 'asc'}`, then `null`. A click on a different key starts at `desc`.
- The query params a sort adds.
- Whether sort is allowed: Live is off and View = Table.

**Contract**:
- `type SortKey = 'inp' | 'out' | 'res' | 'tot' | 'all' | 'dur'`
- `type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null`
- `next(sort: Sort, key: SortKey): Sort`
- `sortParams(sort: Sort): [string, string][]`
- `canSort(follow: boolean, view: View): boolean`

#### 2. State wiring

**Files**: `web/src/App.tsx`, `web/src/useEvents.ts`

**Intent**: Replace `order` and `Order` with `sort: Sort`. `useEvents` adds `sortParams(sort)` to the query. It skips the `EventSource` while the sort is not null. It re-queries when the sort changes. Today's `order === 'time'` guards (`useEvents.ts:174-185, 289, 294`) become `sort === null`. The `tokens` frame handler applies `inp`.

**Contract**: `useEvents(filters, view, ids, sort)`. Remove the `Order` type.

#### 3. Toolbar

**File**: `web/src/components/EventsTab.tsx`

**Intent**: Remove `button#order`. Turning Live on, or switching View to Tail, sets the sort to `null` in the same handler. A non-null sort still forces the table branch (`:233`) and shows the stream as `paused`.

**Contract**: The `EventsTab` props trade `order`/`setOrder` for `sort`/`setSort`.

#### 4. Table header and rows

**Files**: `web/src/components/EventTable.tsx`, `web/src/components/EventRow.tsx`, `web/src/lib/format.ts`

**Intent**: The header gets these columns: Datetime (~200px), Event, Tool, Duration, Input, Output, Result, Total, Total+In, Session.
- The six sortable headers are buttons. Each shows `▼` or `▲` when it is active and sets `aria-sort` on the `<th>`.
  - They are inert and dimmed with a tooltip when `canSort` is false. The tooltip text: "Turn off Live and switch to Table to sort".
- The Datetime header resets the sort to null.
- `EventRow` renders one Datetime cell, from `fmtDate` and `fmtTime` joined by a space. It renders Input from `r.inp` with `fmtTokens`. It renders Total+In as `inp + out + res` when `out` is present, and `—` otherwise.

**Contract**: `EventTable` takes props `sort`, `setSort` and `canSort`. The datetime text format is `YYYY-MM-DD HH:MM:SS.mmm`.

#### 5. Docs

**File**: `README.md`

**Intent**: Replace the Order paragraph (`:190-191`) with header sorting. Explain the rules for Live and Tail, the Input and Total+In columns, and that old sessions need Rebuild to fill Input.

**Contract**: The same README section.

### Success Criteria:

#### Automated Verification:

- `web/src/lib/sort.test.ts` covers the click cycle, a click on a new key, `sortParams` for `null` and for a sort, and `canSort` for all 4 Live/View combinations. Run: `node --test web/src/lib/*.test.ts`.
- Full suite passes, including `vite build`: `npm test`.
- Type check passes: `npm run check`.
- Lint passes: `npm run lint`.
- `grep -rn "Order\b\|sort=tokens\|'tokens'" web/src` finds no leftover Order state or `sort=tokens`. The `tokens` SSE event name stays.

#### Manual Verification:

- With Live on or Tail on, the sortable headers are inert and the tooltip shows. Turning Live off and switching to Table enables them.
- Clicking Total gives largest first, then smallest first, then datetime order. The arrow follows each step, and scrolling loads further pages in the same order.
- With a sort active, turning Live on resets to datetime order and the stream resumes. There is no 400 in the console.
- The Datetime column shows `2026-10-27 14:03:21.123`. Input and Total+In show numbers on new or rebuilt sessions, and `—` on old ones.

**Implementation Note**: When all automated checks pass, stop. Wait for the human to confirm the manual check before you close the change.

---

## Testing Strategy

### Unit Tests:

- Token join: single-call `inp`, parallel split with an exact sum, and Stop `inp` (`scripts/tokens.test.ts`).
- Sort scan: every key in both directions, missing values last, cursor round trip with an `n` value, and `q` with paging (`scripts/query.test.ts`).
- Web sort state: the click cycle, `sortParams` and `canSort` (`web/src/lib/sort.test.ts`).

### Integration Tests:

- `tokens` stream frames carry `inp`. A stream with any `sort` returns 400 (`scripts/live-tail.test.ts`).
- Bench timing for `sort=tot` and `sort=dur&dir=asc`.

### Manual Testing Steps:

1. Rebuild one session. Turn Live off and switch to Table.
2. Sort by Input, then by Total+In. Check that the top rows look like large replies in the transcript.
3. Page down to the rows with no value. Check that they come last in both directions.
4. Turn Live on. Check that the sort resets and live rows arrive.

## Performance Considerations

Each sorted page is still one full scan of the pick, the same cost as `byTokens` today (archived plan `:842`). The key function runs once per row per page. Keep it a plain field read so the bench stays within its 300 ms limit.

## Migration Notes

Old target files have `tok` records with no `inp`. Their rows show `—` in Input, and they sort last by `inp`. By `all` they sort with `inp` counted as 0, so `all` equals `tot` for those rows. Rebuild of a session fills Input. No index format bump is needed.

## References

- Prior change: `.ai/archive/2026-10-26-wal-observer-pipeline/plan.md` (token rules `:155-170`, sort cursor `:191`, scan cost `:842`)
- Sort to generalize: `scripts/wal-index.ts:634-698`
- Token join: `scripts/observer.ts:728-768`
- Order toggle to remove: `web/src/components/EventsTab.tsx:191-233`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Input tokens end to end (server)

#### Automated

- [ ] 1.1 tokens.test.ts covers single-call, parallel-split and Stop inp
- [ ] 1.2 query.test.ts shows inp on rows and none for old tok records
- [ ] 1.3 live-tail.test.ts shows tokens frames carrying inp
- [ ] 1.4 Type check passes: npm run check

#### Manual

- [ ] 1.5 Rebuilt real session returns rows with plausible inp

### Phase 2: Generic sort keys (server)

#### Automated

- [ ] 2.1 query.test.ts covers every key, both directions, missing last, q paging, unknown sort
- [ ] 2.2 live-tail.test.ts: /events-stream?sort=dur returns 400
- [ ] 2.3 Full suite passes: npm test
- [ ] 2.4 Type check passes: npm run check
- [ ] 2.5 Lint passes: npm run lint

#### Manual

- [ ] 2.6 npm run bench passes on this host

### Phase 3: Sortable headers and new columns (web)

#### Automated

- [ ] 3.1 sort.test.ts covers click cycle, sortParams and canSort
- [ ] 3.2 Full suite passes: npm test
- [ ] 3.3 Type check passes: npm run check
- [ ] 3.4 Lint passes: npm run lint
- [ ] 3.5 No leftover Order state or sort=tokens in web/src

#### Manual

- [ ] 3.6 Headers inert with tooltip under Live or Tail, enabled otherwise
- [ ] 3.7 Header click cycles desc, asc, reset with arrow and paging
- [ ] 3.8 Turning Live on resets sort and the stream resumes without 400
- [ ] 3.9 Datetime format and Input / Total+In values shown as specified
