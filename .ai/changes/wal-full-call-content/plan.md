# Full call content in the record viewer Implementation Plan

## Overview

The wal-hook clamps each string to 2000 chars, so call rows hold cut values: JSON in an MCP text block fails to parse, and Copy copies the cut text. `/record` restores the full input and response from the transcript by tool_use_id, and the record viewer gets a full-screen view with MCP sections and a badge for values that stay clamped.

## What We're NOT Doing

- No change to the hook caps (`plugins/wal-hook/hooks/wal-hook.mjs`).
- No perf test for large trees.
- No new display cap in the viewer.
- No change to the stored target rows: the restore is on demand in `/record`.

## Decisions

- Full content comes from the transcript by tool_use_id, on demand in /record, with the WAL value as fallback.
- Restore applies to every call row (MCP and all other tools) and every Pre/Post event with a tool_use_id, main and subagent transcripts, dropped lines included.
- /record adds `restored: {input?: true, response?: true}`; the "truncated by hook" badge shows only when not restored and a clamp marker is present.
- Per-pane Expand opens a full-screen dialog with format switch and full Copy; Escape closes. An MCP response shows Structured / Text / Metadata; empty sections are hidden.
- The inline pane also parses the restored JSON. Copy always takes the full value.
- S7 runs in a headless browser after a `free -m` check; if it cannot run, the final report says "S7 not run".
- One commit at the end.

## Phase 1: Full call content

### Changes Required:

#### 1. Restore in /record

**File**: `scripts/full-call.ts` (new), `scripts/wal-server.ts`, `shared/api.ts`, `scripts/record-full.test.ts` (new)

**Intent**: Find the tool_use and tool_result lines of a tool_use_id in the session's transcripts and put their full values into the `/record` response.

**Contract**: `fullCall(dir: string, id: string, agent: string | null, tuid: string): { input?: unknown; response?: unknown; error?: boolean }` reads `<dir>/<id>.jsonl`, or `<dir>/<id>/subagents/agent-<agent>.jsonl` for a subagent (falling back to the main file and the other subagent files when not found). `input` is the tool_use block's `input`. `response` is the result line's `toolUseResult`, or the tool_result `content` when `is_error` is true or `toolUseResult` is absent. A missing file or tuid gives `{}`; it never throws. `/record` (`scripts/wal-server.ts:629`) uses `discovery.locate(id)` for `dir`, overwrites `call.input` / `pre.payload.tool_input` and `call.response` / `post.payload.tool_response` (or `post.payload.error` on failure) with the found values, creates a missing `payload`, and adds `restored` to the response body. A plain Pre/Post event record with a tool_use_id gets the same restore of its own side. `RecordResponse` types in `shared/api.ts` gain `restored?: { input?: true; response?: true }`.

#### 2. Page helpers for sections and the badge

**File**: `web/src/lib/sections.ts` (new), `web/src/lib/sections.test.ts` (new)

**Intent**: Split an MCP response into Structured, Text and Metadata, and decide the "truncated by hook" badge.

**Contract**: `mcpSections(v: unknown): { structured?: unknown[]; text?: string[]; meta?: Record<string, unknown> }`: text blocks whose text parses as JSON (via `normalize`) go to `structured`, other text blocks to `text`, every non-text block and every other key (`isError`, `_meta`, `structuredContent` goes to `structured`) to `meta`; an empty section is absent. `clampBadge(v: unknown, restored: boolean): boolean` is false when `restored`; else true when any string in `v` ends with `…[+N chars]`, equals `…[+N items]` or `…[depth limit]`, or `v` has a top-level `dropped` key.

#### 3. Full-screen viewer

**File**: `web/src/components/RecordViewer.tsx`, `web/src/styles.css`, `README.md`

**Intent**: Each pane gets an Expand button that opens a full-screen `<dialog>`; the MCP response shows its sections; a clamped pane shows a badge.

**Contract**: Expand opens a native `<dialog>` (as `web/src/components/charts/UPlot.tsx:142` does) holding the pane value with the JSON/YAML/Raw switch and a Copy of the full value in the active format (`copyText`); Escape closes it through the cancel event. For an MCP call's Response the dialog shows the non-empty sections of `mcpSections`, each with its own Copy. The Pane shows a "truncated by hook" badge when `clampBadge(v, restored side)` is true. README names the Expand view and the badge in the viewer section.

### Success Criteria:

#### Automated Verification:

- S1 (RED first): call.input and pre.payload.tool_input equal the transcript input, call.response and post.payload.tool_response equal the transcript toolUseResult, its text parses as JSON, `restored` has input and response, and copyText of call.response holds the full text — `node --test scripts/record-full.test.ts`
- S2 (RED first): call.input and call.response equal the subagent transcript values — `node --test scripts/record-full.test.ts`
- S3 (RED first): call.response and post.payload.tool_response equal the transcript value — `node --test scripts/record-full.test.ts`
- S4 (RED first): each response is 200 with the WAL values unchanged and no `restored` key — `node --test scripts/record-full.test.ts`
- S5 (RED first): Structured holds both parsed JSON values, Text holds the plain text, Metadata holds isError and the image block, and an empty section is absent — `node --test web/src/lib/sections.test.ts`
- S6 (RED first): it is true for each marker value that is not restored, and false for the full value and for the restored value — `node --test web/src/lib/sections.test.ts`
- S8 (RED first): call.response and post.payload.error equal the full tool_result content — `node --test scripts/record-full.test.ts`
- /record restores full values from the transcript: `node --test scripts/record-full.test.ts`
- Section and badge helpers work: `node --test web/src/lib/sections.test.ts`
- The viewer compiles and lints: `npm run check && npx biome ci web/src/components/RecordViewer.tsx web/src/styles.css`
- The required checks of the project pass: `npm test && npm run check && npm run lint`

#### Manual Verification:

- S7 (Manual): the dialog shows the value formatted as JSON and YAML, Copy holds the full value, Escape closes the dialog, and the page stays responsive — Open the record. Click Expand on Response. Switch JSON/YAML and click Copy; compare the length. Press Escape.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Full call content

#### Automated

- [x] 1.1 /record restores full values from the transcript
- [x] 1.2 Section and badge helpers work
- [x] 1.3 The viewer compiles and lints
- [x] 1.4 S1 (RED first): call.input and pre.payload.tool_input equal the transcript input, call.response and post.payload.tool_response equal the transcript toolUseResult, its text parses as JSON, `restored` has input and response, and copyText of call.response holds the full text
- [x] 1.5 S2 (RED first): call.input and call.response equal the subagent transcript values
- [x] 1.6 S3 (RED first): call.response and post.payload.tool_response equal the transcript value
- [x] 1.7 S4 (RED first): each response is 200 with the WAL values unchanged and no `restored` key
- [x] 1.8 S5 (RED first): Structured holds both parsed JSON values, Text holds the plain text, Metadata holds isError and the image block, and an empty section is absent
- [x] 1.9 S6 (RED first): it is true for each marker value that is not restored, and false for the full value and for the restored value
- [x] 1.10 S8 (RED first): call.response and post.payload.error equal the full tool_result content
- [x] 1.11 The required checks of the project pass

#### Manual

- [x] 1.12 S7 (Manual): the dialog shows the value formatted as JSON and YAML, Copy holds the full value, Escape closes the dialog, and the page stays responsive
