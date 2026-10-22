---
change_id: current-context-monitoring-with-compaction
title: wal-hook — current context-window usage per agent on each WAL record, plus a per-agent context chart
status: archived
created: 2026-10-22
updated: 2026-10-22
archived_at: 2026-10-22T09:09:29Z
---

## Notes

- Target repo: the wal observer project (`raqs31/claude-wal-session-viewer`), based on `main`. Planned from
  agentic-toys; move this folder into that repo's `.ai/changes/` before implementing.
- Consumer: neula-evals vendors `plugins/wal-hook/hooks/wal-hook.mjs` as `scripts/wal-hook.mjs` plus its settings
  registrations, and watches eval runs live.
