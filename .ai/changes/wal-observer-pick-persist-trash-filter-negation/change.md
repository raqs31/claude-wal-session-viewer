---
change_id: wal-observer-pick-persist-trash-filter-negation
title: Persist session pick, trash sessions from the sidebar, All/None/Not filters
status: plan_reviewed
created: 2026-10-22
updated: 2026-10-22
archived_at: null
---

## Notes

— Enrich WAL observer with: (1) persist session pick in localStorage (wal.pick), restored on refresh, pruned of vanished ids, fallback to newest when nothing stored or all gone, deliberately empty pick restored as empty, synced across tabs (useStoredJson pattern); (2) move sessions to trash from the sidebar: 'Delete picked' and 'Delete N filtered' (sidebar source/workspace/project/text filter); moves <id>.jsonl, <id>.wal.jsonl and <id>/ dir to <config>/wal-trash/<YYYY-MM-DD>/<project-slug>/ via atomic rename in the same source; live sessions always skipped and reported; confirm dialog listing count/names; POST-only JSON endpoint with same-origin check (Origin / Sec-Fetch-Site), server re-validates ids against discovery; plus a Trash view in the UI with Restore (handle conflicts) and Empty (hard delete); README documents layout; (3) filters: per-section All / None / Not (invert: selected chips are excluded) for Events filter panel sections (category, tool, event, agent) with new server params (e.g. cat_not/tool_not/...), summary shows e.g. 'tool: ≠2'; and the same All/None/Not on the sidebar's source/workspace chips.
