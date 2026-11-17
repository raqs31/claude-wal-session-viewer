---
change_id: wal-full-call-content
state: complete
created: 2026-11-17
updated: 2026-11-17
alignment: null
---

# Test plan: Full call content in the record viewer

## Critical paths

### CP-01: Full call content from /record

- Declared: a call whose WAL value is clamped returns its full input and response from /record
- Why: Copy and the JSON/YAML views are wrong whenever this path fails, and that is the whole bug.
- Business case: the operator cannot read, format or copy the input and output of large tool calls.
- Entry: GET /record?id=&seq=&gen= and the record viewer in the Events tab
- Origin: new

## Test approach

Integration tests start the server with `scripts/test-server.ts` under a temp HOME, as `scripts/query.test.ts` does. They write a crafted WAL and transcript whose shapes come from one real WAL line and its transcript line, and fetch `/record`. Unit tests cover the page helpers in `web/src/lib/` with `node --test`. The manual check runs the built page in a headless browser. `npm test` runs all automated tests.

## Scenarios

### CP-01: Full call content from /record

#### S1 · integration · RED first

- Given: a main-agent MCP call whose WAL input and response text block are clamped by the hook, and whose transcript holds the full input and a full 5 000-char JSON response
- When: /record of the call row is fetched
- Then: call.input and pre.payload.tool_input equal the transcript input, call.response and post.payload.tool_response equal the transcript toolUseResult, its text parses as JSON, `restored` has input and response, and copyText of call.response holds the full text
- Check: `node --test scripts/record-full.test.ts`
- Protects: the operator reads, formats and copies the full input and output of a large call
- Why: Copy and the JSON/YAML views are wrong whenever this path fails, and that is the whole bug.
- Case: critical
- Test: scripts/record-full.test.ts
- Flaky risk: none

#### S2 · integration · RED first

- Given: a clamped call made by a subagent, whose full values are in subagents/agent-<id>.jsonl
- When: /record of the call row is fetched
- Then: call.input and call.response equal the subagent transcript values
- Check: `node --test scripts/record-full.test.ts`
- Protects: full content of subagent calls
- Why: Subagent calls are a separate lookup path, and a miss there fails silently.
- Case: critical
- Test: scripts/record-full.test.ts
- Flaky risk: none

#### S3 · integration · RED first

- Given: a Post WAL line that the hook dropped (only a `dropped` key, no payload) and a transcript with the full result
- When: /record of the call row is fetched
- Then: call.response and post.payload.tool_response equal the transcript value
- Check: `node --test scripts/record-full.test.ts`
- Protects: full content of the largest calls
- Why: The largest calls are the ones the operator reported, and they are the ones the hook drops.
- Case: critical
- Test: scripts/record-full.test.ts
- Flaky risk: none

#### S4 · integration · RED first

- Given: one call whose tool_use_id is in no transcript line, and one session whose transcript file does not exist
- When: /record of each call row is fetched
- Then: each response is 200 with the WAL values unchanged and no `restored` key
- Check: `node --test scripts/record-full.test.ts`
- Protects: the viewer keeps working when the full value is not available
- Why: A live session can hit this before the first transcript write, and it must not return a 500.
- Case: non-critical
- Test: scripts/record-full.test.ts
- Flaky risk: none

#### S5 · unit · RED first

- Given: an MCP content-block response with two JSON text blocks, one plain text block, an image block and isError
- When: mcpSections() splits it
- Then: Structured holds both parsed JSON values, Text holds the plain text, Metadata holds isError and the image block, and an empty section is absent
- Check: `node --test web/src/lib/sections.test.ts`
- Protects: the operator sees MCP structured content, free text and metadata apart
- Why: The three sections are the operator's explicit request for MCP.
- Case: critical
- Test: web/src/lib/sections.test.ts
- Flaky risk: none

#### S6 · unit · RED first

- Given: values with each clamp marker (`…[+N chars]`, `…[+N items]`, `…[depth limit]`, a `dropped` key), a full value, and a restored value that contains `…[+12 chars]`
- When: clampBadge() is called with each value and its restored flag
- Then: it is true for each marker value that is not restored, and false for the full value and for the restored value
- Check: `node --test web/src/lib/sections.test.ts`
- Protects: the operator knows when Copy is not the full value, with no false alarm
- Why: A silent clamp is how this bug stayed hidden, and a full value that contains the marker text must get no false badge.
- Case: non-critical
- Test: web/src/lib/sections.test.ts
- Flaky risk: none

#### S7 · e2e · Manual

- Given: the built page and a real record of 100 kB or more
- When: Expand on its Response pane is clicked
- Then: the dialog shows the value formatted as JSON and YAML, Copy holds the full value, Escape closes the dialog, and the page stays responsive
- Check: Open the record. Click Expand on Response. Switch JSON/YAML and click Copy; compare the length. Press Escape.
- Protects: Copy, Escape and responsiveness in a real browser
- Why: Only a real browser proves Copy, Escape and responsiveness.
- Case: critical
- Flaky risk: none

#### S8 · integration · RED first

- Given: a call whose tool_result has is_error and a clamped WAL error
- When: /record of the call row is fetched
- Then: call.response and post.payload.error equal the full tool_result content
- Check: `node --test scripts/record-full.test.ts`
- Protects: full content of failed calls
- Why: The design has a separate branch for errors, and no other scenario covers it.
- Case: non-critical
- Test: scripts/record-full.test.ts
- Flaky risk: none

## Not tested

- Rendering speed of very large trees — a perf test costs more than this local tool justifies; S7 checks it by hand.
- The browser Clipboard API call — node tests cannot reach it; S1 proves the value given to Copy is the full one.
- Hook caps — out of scope by decision; the hook keeps its caps.

## Current tests

- Scope: none
