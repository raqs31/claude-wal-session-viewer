---
change_id: wal-sessions-tab
title: WAL viewer — Sessions tab with conversation timeline and usage/model statistics
status: archived
created: 2026-09-30
updated: 2026-10-22
archived_at: 2026-10-22T08:25:02Z
---

## Notes

— Built on the TS + React stack (`wal-observer-ts-react`, archived 2026-09-30). Plan: `plan.md` (brief: `plan-brief.md`). Brainstorm decisions:

- Feasibility (checked 2026-09-30): hook payloads carry no usage; only SessionStart has `model`. Every event has
  `transcript_path` (+ `agent_transcript_path` on SubagentStop). Transcript JSONL: assistant entries carry
  `message.model` + `message.usage` (input, output, cache_creation (5m/1h), cache_read, output_tokens_details.thinking_tokens);
  usage repeats across entries of one API message → dedupe by `message.id` (53 entries / 30 ids observed). Subagents:
  `<session>/subagents/agent-<id>.jsonl` + `.meta.json` (agentType, description, toolUseId). Entries link by `parentUuid`.
- Timeline: full conversation, collapsible (prompts, text, thinking, tool calls/results, subagents nested at spawn point);
  thinking/tool payloads folded, reuse the JSON/YAML/Raw viewer; per-reply model + tokens.
- Sessions listed from `~/.claude/projects/<slug>/` plus `<slug>--ai-worktrees-*` (not from the WAL); list rows are metadata only.
- Stats: per-session totals (input, output, cache read/write, thinking, requests, turns, duration); main vs each subagent;
  per model; estimated USD cost from `scripts/pricing.json` (unknown model → cost "—").
- Charts: cumulative tokens over time (stacked types, turn markers); per-turn stacked bars; share by agent/model.
- Live: tail the open session's transcript + subagent files (250 ms tail + SSE, "N new" pill).
- Scope selector: Whole session / Main only / one subagent — stats, charts, conversation follow it.
- Tabs: Events | Sessions, no cross-links.
- Approach A: server parses/aggregates (transcripts module, caching by size+mtime), endpoints for list, session
  (stats+series+first conversation page), item (full message on expand), stream. Browser holds only what is on screen.
