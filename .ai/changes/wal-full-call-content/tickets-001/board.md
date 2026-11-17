# Board — Full call content in the record viewer

change: wal-full-call-content · board: main · caps: soft 10000 · hard 20000 tokens · history: wal.md

## Goal

Big tool calls show in full, formatted, and Copy copies the full value; MCP responses open full-screen in Structured/Text/Metadata.

## Facts

- Root cause: wal-hook clamps strings to 2000 chars (plugins/wal-hook/hooks/wal-hook.mjs:54); clamped JSON fails JSON.parse in web/src/lib/normalize.ts.

## Decisions

- 2026-11-17 orchestrator: mode: light
- 2026-11-17 orchestrator: commit: one
- 2026-11-17 orchestrator: [auto] Interview delegated by the operator to a Fable product-owner subagent ("run unattended ... fable as a product owner").
- 2026-11-17 orchestrator: [auto] Test plan: yes; critical path CP-01: a clamped call returns its full input and response from /record.
- 2026-11-17 orchestrator: [auto] Full content comes from the transcript by tool_use_id, on demand in /record, with the WAL value as fallback. Hook caps stay.
- 2026-11-17 orchestrator: [auto] Restore applies to every call row (MCP and all other tools) and every Pre/Post event with a tool_use_id, main and subagent transcripts, dropped lines included.
- 2026-11-17 orchestrator: [auto] /record adds restored: {input?: true, response?: true}; the "truncated by hook" badge shows only when not restored and a clamp marker is present.
- 2026-11-17 orchestrator: [auto] Per-pane Expand opens a full-screen dialog with format switch and full Copy; Escape closes. MCP response shows Structured / Text / Metadata; empty sections hidden.
- 2026-11-17 orchestrator: [auto] The inline pane also parses the restored JSON; no new display cap; Copy always takes the full value.
- 2026-11-17 orchestrator: [auto] S7 (manual) runs in a headless browser after a free -m check (~2 GiB); if it cannot run, the final report says "S7 not run".
- 2026-11-17 orchestrator: [auto] Plan approved by the Fable PO with two edits: orchestrator runs S7 (1.12) after the review; T3 badge also covers an unrestored side whose pre/post WAL record has dropped.
- 2026-11-17 orchestrator: [auto] T4: call rows of a session with no WAL are restored too (decision: every call row); T1 owns scripts/query.test.ts:749 to assert only that there is no virtual key.
- 2026-11-17 orchestrator: [auto] T4 follow-ups: all 5 taken without asking (memory rule: fix every review finding and follow-up).
- 2026-11-17 orchestrator: [auto] Commit message approved by the Fable PO with its scope edit: fix(server,web).

## Tickets

<!-- tickets:start — rendered by board.py refresh -->
| id | status | phase | holder | needs | tags | title |
| -- | ------ | ----- | ------ | ----- | ---- | ----- |
| T4 (review) | blocked | 1 | aefb3b3d785273297 |  |  | Review |
Closed: T1 done · T2 done · T3 done
<!-- tickets:end -->

## Log

- 2026-11-17 21:33 orchestrator: T2 done: mcpSections and clampBadge in web/src/lib/sections.ts, S5/S6 green
- 2026-11-17 21:39 orchestrator: T1 done: fullCall in scripts/full-call.ts; /record restores input/response and adds restored; S1-S4,S8 green
- 2026-11-17 21:41 orchestrator: T3 done: Expand dialog with format switch and full Copy, MCP sections, truncated badge, README
- 2026-11-17 21:48 orchestrator: T4 changes: 3 major (T1 x2, T3 x1), 5 minor follow-ups; all go back to owners
- 2026-11-17 21:49 orchestrator: T3 done again: full Copy in MCP dialog, paneBadge helper + test, FORMAT_LABEL moved to tree.ts
- 2026-11-17 21:54 orchestrator: T1 done again: Post restores input too, bounded search, per-call buffer, restoreEv tests, query.test.ts:749 updated; npm test 303 pass
- 2026-11-17 21:57 orchestrator: T4 approve: all findings and follow-ups fixed; npm test 303 pass, check and lint clean
- 2026-11-17 22:05 orchestrator: S7 passed headless on skm GKA-257 extract_images (82 kB): JSON Copy 82426 chars parses, YAML Copy 82321, no marker, Escape closes, opens ~110 ms; s7-dialog.png
- 2026-11-17 22:07 orchestrator: Committed f9910d1; close-out
