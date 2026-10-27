# WAL observer pipeline with token columns — Plan Brief

> Full plan: `.ai/changes/wal-observer-pipeline/plan.md`
> Plan review that caused the re-plan: `.ai/changes/wal-observer-pipeline/superseded/plan-review-v1.md`

## What & Why

The Events tab shows no token numbers, so you cannot find the calls that use the most context, for example
a large MCP response. Plan v1 took the numbers from the hook's `context` field. The review found that field
stale on 25% of Posts. This plan takes the numbers from the transcript, joined by `tool_use_id`. It moves all
raw-file reads behind an observer pipeline that writes one derived file per session, and never writes to
the WAL.

## Starting Point

The Events index tails each WAL itself and makes MCP-only virtual "call" rows. The Sessions store parses the
transcripts itself. Discovery and trash read the raw files. No row has token numbers.

## Desired End State

A server-side observer keeps `<config-dir>/wal-viewer/<id>.jsonl` per discovered session. Events and
Sessions read only these targets. A session without a WAL gets call and turn rows from its transcripts. Every tool call has a call row with Output / Result / Total. You can filter
by Total and, with Live off, list the largest calls first. A backlog builds in the background with progress.
A changed source is marked stale until a manual rebuild.

## Key Decisions Made

| Decision           | Choice                                                      | Why (1 sentence)                                                   | Source |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| Token source       | Transcript usage, joined by `tool_use_id`                   | WAL `context` is stale on 25% of Posts.                            | Review |
| WAL                | Read-only; the observer writes a separate target            | The viewer must not change the hook's file.                        | Plan   |
| Pipeline scope     | Events index and Sessions stats; discovery stays on sources | Live / busy and trash safety must not wait on the observer.        | Plan   |
| Change cut         | One change, 8 phases; renamed `wal-observer-pipeline`       | User choice; the id names the real scope.                          | Plan   |
| Target location    | `<config-dir>/wal-viewer/`, self-contained records          | The viewer reads only targets; `~/.claude/projects` stays as is.   | Plan   |
| Observer process   | Inside `scripts/wal`, one writer guarded by a lock          | One process; a second server is read-only.                         | Plan   |
| Auto enrichment    | All live sessions, plus a background backlog with progress  | Rows are ready before you pick them.                               | Plan   |
| Partly built pick  | Show the partial rows with "building N%"                    | No wait on first open.                                             | Plan   |
| Rebuild            | Manual only: page button and `wal rebuild`                  | No surprise rework; stale targets freeze and say so.               | Plan   |
| Resume             | Replay sources to the last checkpoint, then append          | Reuses today's parsers; about 2 s on today's data.                 | Plan   |
| Call rows          | One per tool call, lands at Post, sorts at Pre time         | One carrier for request, response, timespan and tokens.            | Plan   |
| Late tokens        | `tok` patch records, applied by the reader                  | The call row is not delayed by the next API call.                  | Plan   |
| Raw rows           | Kept; tokens only on call and Stop rows                     | Nothing users rely on disappears.                                  | Plan   |
| Edge cases         | Result — on compaction, interrupt or ended with no next request | Never show a wrong Result.                                     | Plan   |
| No-WAL sessions    | Ingested: call and turn rows plus stats from transcripts; a WAL that appears later marks stale | Events and Sessions both cover every session. | Review |
| Filter / sort / UI | Total; `notok`; Order only while Live is off                | Carried over from plan v1.                                         | v1     |

## Scope

**In scope:**
- Target format, observer (WAL and transcripts), lock, checkpoints, stale detection
- Readers switched to targets, partial "building" info, `/observer`, `/rebuild`, `wal rebuild`
- Token join, `tok` patches, token filter, Tokens order, stream patch frames
- Web: token columns, filter, Order, progress chip, stale / rebuild UI; README; tests; bench

**Out of scope:**
- Changes to discovery, trash or `wal legacy`
- Automatic rebuild, hook changes, sorting in Live, cache columns, cost per row, version bumps

## Architecture / Approach

```
WAL + transcripts + meta ──observer (in scripts/wal, lock)──▶ <config-dir>/wal-viewer/<id>.jsonl
                                                                   │  head, ev, call, tok, use, turn,
                                                                   │  compact, agent, tools, cost, ck, stale
                                    Events index ◀─────────────────┤  (ev / call rows, tok hidden patches)
                                    Sessions store ◀───────────────┘  (transcript records, last-wins keys)
```

Each request first syncs its sessions within 150 ms. A 1 s loop follows everything else. `tok` records share
the rows' seq space, so the live stream meets them in its normal scan and resumes through the existing `id:`
vector.

## Phases at a Glance

| Phase                          | What it delivers                                       | Key risk                                                    |
| ------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| 1. Target format               | Records, append, tail reader, lock                     | Torn last line after a crash                                |
| 2. Observer: WAL               | `ev`, `call`, `ck`, resume, stale                      | Duplicate records after a restart                           |
| 3. Observer: transcripts       | Sessions-stats records, golden equality test           | Late amendments (streamed usage, parents) lost in an append-only file |
| 4. Readers switch              | Events and Sessions read targets, budgeted sync        | Tests that expect the next request to see new bytes         |
| 5. Loop, progress, rebuild     | Backlog, `/observer`, stale, `/rebuild`, CLI, read-only | Two writers on one cache                                   |
| 6. Token join                  | `tok` for call and Stop rows                           | Wrong split or a wrong next request on rare branches        |
| 7. Server filter, order, frames | `min_tok`, `sort=tokens`, `tokens` frames, bench      | Full scan per sorted page; build time                       |
| 8. Web and README              | Columns, filter, Order, pipeline UI                    | Late call rows and patches in both views                    |

**Prerequisites:** Node 24. Real sessions with the hook installed, for manual checks.
**Estimated effort:** ~6–8 sessions across 8 phases.

## Open Risks & Assumptions

- Sessions recorded before the hook was installed have no WAL. Their Events rows come from transcripts only,
  so they have no Pre / Post records or other hook events.
- 48 of 96 WALs have no transcript. Discovery does not list them, so they are not ingested (as today).
- Size-based splits of parallel calls are estimates.
- One file in the data has interleaved branches. There, the "next request" can be wrong for a few calls.
- The 30 s build limit for the 5 × 20 MB bench fixture is an estimate. Phase 7 checks it.

## Success Criteria (Summary)

- The largest calls of a session can be found in one step: Order: Tokens, or a Tokens ≥ filter.
- Events and Sessions show the same data as before for sessions with a WAL, read only from targets.
- All tests, lint, type check and bench pass. The WAL is never written.
