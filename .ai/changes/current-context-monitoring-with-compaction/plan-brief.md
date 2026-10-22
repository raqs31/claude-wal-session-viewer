# wal-hook Context-Window Monitoring — Plan Brief

> Full plan: `.ai/changes/current-context-monitoring-with-compaction/plan.md`
> Target repo: wal observer (`raqs31/claude-wal-session-viewer`), base `main`.

## What & Why

Each WAL record on PostToolUse, PostToolUseFailure, Stop and SubagentStop gets
`context: { tokens, output, model }`, the size of the last API call made by the agent that fired the event.
neula-evals vendors this hook and needs to see, live, how full the context window is for the main agent and
each subagent; today the WAL has no usage numbers.

## Starting Point

The hook writes one clamped record per event and never reads the transcript. The viewer shows "Context at
end" per agent but no context over time, and on `main` the Main row has no charts.

## Desired End State

Subagent events report the subagent's own context; main events report main's. A missing transcript or no
usage yet means no field, never a broken record. In the viewer every agent's details show a "Context per
call" chart; Main is expanded on load. Released as 0.3.0 in one PR to `main`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Events | PostToolUse, PostToolUseFailure, Stop, SubagentStop | No gaps when tools fail; PreToolUse adds nothing new |
| Subagent transcript | `agent_transcript_path` on SubagentStop; else `<session>/subagents/agent-<agent_id>.jsonl` from `transcript_path` | Verified on real WALs: PostToolUse in a subagent carries only the main `transcript_path` + `agent_id` |
| Which line | Last `assistant` line with usage, skipping `<synthetic>` | Same-id lines are snapshots (last is final); synthetic lines have zero usage |
| Tail read | 64 KB, widen ×4 to a 4 MB cap, then omit | Bounded cost on huge transcripts |
| Chart data | Existing per-agent transcript series, not the WAL field | ~30 lines, live, works for old sessions |
| Chart place | Each agent's details; Main charts enabled; Main open by default | Operator's choice |
| Compaction markers | None in the new chart | Not on `main`; the drop shows it |
| Changelog | README field docs only | Operator's choice |
| Benchmark | One-off, numbers in the plan's Review | No extra repo code |
| Shipping | Branch off `main`, one PR to `main` | Work happens in the wal observer repo on main |

## Scope

**In scope:** hook context step + shell tests; one-off benchmark (+ guard if > 5 ms); per-agent context
chart, Main charts, Main open; version 0.3.0; README docs; PR.

**Out of scope:** other events, running max, window %, WAL-index/API changes, compaction markers,
CHANGELOG, committed benchmark, neula-evals changes.

## Architecture / Approach

The hook adds one isolated step before serialising: pick the agent's transcript, read a bounded tail,
scan lines from the end, set `record.context`. It has its own try/catch, so any failure only omits the
field and the single append still happens. The viewer computes per-call context from the series
`AgentCharts` already fetches and draws it with the existing uPlot wrapper.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Hook + tests | `context` on four events, 12 shell test cases | A throw in the new code skipping the append |
| 2. Benchmark | Overhead numbers on a 60 MB transcript; guard if needed | Worst-case widening cost |
| 3. Viewer chart | Context per call per agent; Main charts, Main open | Overlap with `feat/subagent-prompts` in `SessionStats.tsx` |
| 4. Version + README | 0.3.0, field and payload docs | — |
| 5. Ship | PR to `main` with benchmark and vendoring note | CI on Node 26 |

**Prerequisites:** this folder moved into the wal observer repo; `main` up to date.
**Estimated effort:** one session across 5 small phases.

## Open Risks & Assumptions

- Nested subagents are assumed to use the same flat `subagents/agent-<id>.jsonl` layout (not observed).
- At PostToolUse inside a subagent, the final snapshot of the reply may not be flushed yet; `tokens` is
  fixed at request start, only `output` could be low.
- `feat/subagent-prompts` also changes `ByAgent` and `useAgentSeries`; whichever lands second resolves a
  small conflict.

## Success Criteria (Summary)

- During an eval run, `jq '.context'` on the WAL shows the current context for main and each subagent.
- The hook stays within a few ms on a >50 MB transcript and never breaks a record.
- The viewer shows context over time for every agent, Main visible on load.
