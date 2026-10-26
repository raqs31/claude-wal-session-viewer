# Token columns, token filter and Tokens order in the Events view — Plan Brief

> Full plan: `.ai/changes/wal-events-token-columns/plan.md`

## What & Why

The Events tab lists WAL rows but shows no token numbers, so you cannot find the calls that use
the most context, for example a large MCP response. This change adds Result / Output / Total
columns per tool call, a ≥ / ≤ token filter, and an Order: Tokens view that lists the largest
calls first.

## Starting Point

The `wal-hook` already writes `context` (the firing agent's last API call: prompt and output
tokens) on Post, PostFailure, Stop and SubagentStop lines. The viewer ignores it. The WAL index
pages rows only in time order, and the live stream never re-sends a row.

## Desired End State

Each tool-call and Stop row shows its tokens. A live row shows `…` until the next API call makes
its result size known, then fills in place. You can filter by Total and, with Live off, list the
largest calls first across the picked sessions. Sessions recorded before the hook wrote `context`
show —.

## Key Decisions Made

| Decision          | Choice                                                     | Why (1 sentence)                                                              |
| ----------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Meaning of tokens | Result (tokens added to context) + Output                  | Result is what makes a call "large" in context; Output covers big inputs.     |
| Data source       | WAL `context` only, no transcript fallback                 | Cheap and live; the user accepts — for old sessions.                          |
| Parallel calls    | Split by size (result size, input size)                    | Lets a large sibling stand out instead of sharing one number.                 |
| Rows with numbers | Post, PostFailure, MCP call, Stop / SubagentStop           | One number per call, plus large final replies; Pre rows show —.               |
| Stop rows         | Output only                                                | Each column keeps one meaning.                                                |
| Filter / sort key | Total = Result + Output                                    | One number answers "largest call".                                            |
| No data           | Like duration: — , excluded unless `notok=include`, sorted last | Matches the existing `nodur` switch.                                     |
| Hook change       | Add `message.id` to `context`                              | Exact grouping of parallel calls; older records group by equal `tokens`.      |
| Pending result    | Show `…`, fill via a `tokens` stream frame                 | Live rows end correct without a refresh.                                      |
| Sort and Live     | Tokens order only while Live is off                        | User decision: no sorting in live mode.                                       |
| Testing           | Unit + query + live-tail + bench                           | Covers attribution, paging, live frames and perf limits.                      |

## Scope

**In scope:**
- Hook `context.id`
- Attribution in the WAL index
- `min_tok` / `max_tok` / `notok` and `sort=tokens` on `/events`
- `event: tokens` frames and a hold-back for a token filter on `/events-stream`
- Three columns, a Tokens filter section and an Order control in the web
- README, tests, bench

**Out of scope:**
- Transcript joins
- Sorting in Live
- Input / cache columns
- A choice of sort key
- Cost per row
- Version bumps

## Architecture / Approach

The index walks each WAL in file order. It keeps one open "message group" per agent, keyed by
`context.id` (or an equal `context.tokens`). The next different `context` in that agent, or its
Stop, closes the group:
- `growth = next prompt − prompt − output` is split over the calls by result size.
- `output` is split by input size.
- A negative growth (compaction) gives Result —.

Closed rows go to a resolved log. The stream turns the log into `tokens` patch frames, and the
query uses the numbers to filter and to sort with a `(total, t, sess, seq)` cursor.

## Phases at a Glance

| Phase                          | What it delivers                                     | Key risk                                                   |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| 1. Hook: message id            | `context.id` on new records                          | Hook test fixtures need `message.id`                       |
| 2. Index: attribution          | `out` / `res` / `pend` per row, resolved log         | Virtual MCP rows are copies and must be updated too        |
| 3. Server: filter and sort     | `min_tok` / `max_tok` / `notok`, `sort=tokens` paging | Full scan per sorted page against the 300 ms limit        |
| 4. Server: live frames, bench  | `tokens` frames, hold-back, `rafter`, bench checks   | Losing a held row when the stream position advances        |
| 5. Web                         | Columns, Tokens filter, Order control, README        | Order / Live coupling and patching rows in both lists      |

**Prerequisites:** Node 24. The updated hook installed, for manual checks on real sessions.
**Estimated effort:** ~3–4 sessions across 5 phases.

## Open Risks & Assumptions

- The hook's `context` at `PostToolUse` is the issuing message. This holds while Claude Code runs
  Post hooks before the next request.
- An interrupted turn (no Stop) closes its last group at the next turn's first call, so the
  user's next prompt inflates that Result.
- Size-based splits are estimates. Clamped payloads and dropped lines fall back to an even split.
- A sorted page scans the whole pick. Large histories with `q` may be slow, like `q` today.

## Success Criteria (Summary)

- The largest MCP calls of a session can be found in one step: Order: Tokens, or a Tokens ≥ filter.
- Live rows fill in their numbers without a refresh, and a live token filter never drops a call.
- All tests, lint, type check and bench pass within the existing limits.
