# WAL sort capabilities — Plan Brief

> Full plan: `.ai/changes/wal-sort-capabilities/plan.md`

## What & Why

Sortable table headers replace the `Order: Time/Tokens` button. Date and Time become one stable Datetime column. A new Input column shows the fresh input tokens of each action. The goal is to find the actions that use the most tokens.

## Starting Point

A toggle switches between Time order and Tokens order. Tokens order sorts by Total (Out + Res) only. The server knows only `sort=tokens`, and rows carry only `out` and `res`. The table headers are static, and Date and Time are separate cells.

## Desired End State

With Live off and View = Table, a header click sorts by Duration, Input, Output, Result, Total or Total+In. The cycle is largest first, then smallest first, then back to datetime order. Paging keeps the order. Under Live or Tail, these headers are inert, and turning either mode on resets the sort.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Input meaning | Fresh input = `input + cache writes` of the reply, from transcript usage | It is exact and shows the real new cost of each action. |
| Parallel calls / Stop | Split like Output; a Stop gets the full value | This matches the existing token rules, and the column sums stay correct. |
| Total | Keep Out + Res; add a new Total+In column (In + Out + Res) | The token filter and existing tests keep their meaning. |
| Sortable columns | Duration, Input, Output, Result, Total, Total+In | These cover both "top consumed" and "slow" actions. |
| Click cycle | desc → asc → reset; the Datetime header resets | This is the standard table behaviour, with an easy way back. |
| Live / Tail | Headers inert with a tooltip; turning Live or Tail on resets the sort | This follows the user's rule and avoids hidden mode jumps. |
| Old indexes | Input shows `—` until Rebuild | Upgrade does not force a re-index on this small host. |
| Datetime format | `YYYY-MM-DD HH:MM:SS.mmm` | It is stable and has no ambiguity across days. |
| API | `sort=inp\|out\|res\|tot\|all\|dur`, `dir=asc\|desc`; field name `inp` | `in` is a JS reserved word. |
| Missing values | Last in both directions | Rows without data never hide the top results. |

## Scope

**In scope:**
- Input tokens in the observer join, `tok` records, the index, `Row` and the `tokens` frames.
- A generic server sort with direction and a cursor.
- Sortable headers.
- The Datetime column.
- The Input and Total+In columns.
- An update to the README.

**Out of scope:**
- Sort by Event, Tool or Session, and ascending datetime order.
- Sort under Live or Tail.
- A change to the token filter.
- A forced re-index.
- Saving the sort.
- Cache-read or cost columns.
- A precomputed sort index.

## Architecture / Approach

The work goes bottom up through three layers.
1. **Data.** The observer `callTok` and `stopOut` compute `inp` from `UsageRecord` with the existing `share()` split. `inp` flows through `TargetRecord`, `IndexEntry`, `summary()`/`Row` and the `TokensFrame`.
2. **Query.** `byTokens` becomes a generic `byKey(keyFn, dir)` with a cursor `<v|n>.<t>.<sess>.<seq>`.
3. **UI.** A pure `web/src/lib/sort.ts` holds the click cycle, the params and the `canSort` rule. `App`, `useEvents`, `EventsTab` and `EventTable` use the `Sort` state in place of `Order`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Input tokens (server) | `inp` on rows and in stream frames | Split rounding: the parts must add up to the reply total |
| 2. Generic sort keys (server) | `sort=<key>&dir=` with paging; streams reject a sort | A cursor that crosses from rows with values into rows with none |
| 3. Headers and columns (web) | Sortable headers, Datetime, Input, Total+In; no Order button | Order of state changes: a sort that is still active when Live turns on gives a 400 |

**Prerequisites:** none. The current `main` has the token pipeline from `wal-observer-pipeline`.
**Estimated effort:** about 2 to 3 sessions over 3 phases.

## Open Risks & Assumptions

- Fresh input of a reply mostly contains the previous call's result tokens. Total+In therefore counts those tokens twice, in Res and in the next Input. Read Total+In as a ranking signal, not as a billing sum.
- Old sessions sort last by Input until the user runs Rebuild.
- Each sorted page scans the whole pick. This is the cost that is known today, and the bench guards it at 300 ms.

## Success Criteria (Summary)

- With Live off and View = Table, a click on Input or Total+In shows the most expensive actions first. Paging keeps that order.
- Under Live or Tail, nothing can be sorted. Turning either mode on returns to datetime order with no stream error.
- `npm test`, `npm run check`, `npm run lint` and `npm run bench` pass.
