---
change_id: wal-observer-pipeline
title: WAL observer pipeline with token columns in the Events view
status: plan_reviewed
created: 2026-10-26
updated: 2026-10-26
archived_at: null
---

## Notes

An in-process observer reads each session's raw sources (WAL, transcripts, subagent meta) and writes one
append-only, self-contained target file per session. The Events index and the Sessions stats read only
targets; discovery and trash stay on the raw files. The WAL is never written.

On this pipeline, the Events view gets a call row per tool call and token columns (Output, Result, Total)
joined from the transcript by `tool_use_id`, a ≥ / ≤ token filter with a no-tokens switch, and an
Order: Tokens view across the picked sessions. Main use: find the largest calls, for example MCP calls.

## History

- Was `wal-events-token-columns`. Plan v1 took tokens from the WAL `context` field. Plan review F1 showed
  that `context` is stale on 25% of Posts (`superseded/plan-review-v1.md`). Re-planned on 2026-10-26: the transcript
  is the token source, and all raw reads move into the observer pipeline. Plan v1 and its brief are in
  `superseded/`.
