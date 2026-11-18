#!/usr/bin/env node

// record-full.test.ts — proves /record restores the full input and response of a call from the
// session's transcript, where the WAL holds only the values the wal-hook clamped or dropped.
//
// Fixture shapes follow real lines: an MCP response is a content-block array in both the WAL and the
// transcript's `toolUseResult`; a Bash result is `{stdout, stderr, interrupted, isImage, noOutputExpected}`.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CallRecord, FirstPage, Row, WalRecord } from '../shared/api.ts'
import { paneBadge } from '../web/src/lib/sections.ts'
import { copyText } from '../web/src/lib/tree.ts'
import { fullCall } from './full-call.ts'
import { startServer } from './test-server.ts'

const dir = mkdtempSync(join(tmpdir(), 'walfull.'))
const proj = join(dir, '.claude', 'projects', '-tmp-r')
mkdirSync(proj, { recursive: true })
const sid = (n: number): string => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`

// The hook's string and line caps (plugins/wal-hook/hooks/wal-hook.mjs).
const MAX_STRING = 2000
const clampStr = (s: string): string => (s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…[+${s.length - MAX_STRING} chars]` : s)
const DROPPED = 'line exceeded 96000 chars'

const lines = (recs: unknown[]): string => `${recs.map((r) => JSON.stringify(r)).join('\n')}\n`
let clock = 0
const ts = (): string => new Date(Date.UTC(2026, 10, 17, 10, 0, clock++)).toISOString()
const wal = (id: string, event: string, tool: string, tuid: string, extra: Record<string, unknown> = {}) => ({
  ts: ts(),
  workspace: 'default',
  event,
  session_id: id,
  tool_name: tool,
  tool_use_id: tuid,
  ...extra,
})
const use = (tuid: string, name: string, input: unknown, sidechain = false) => ({
  type: 'assistant',
  uuid: `u-${tuid}`,
  isSidechain: sidechain,
  timestamp: ts(),
  message: { id: `msg-${tuid}`, role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: tuid, name, input }] },
})
const result = (tuid: string, content: unknown, toolUseResult: unknown, isError = false, sidechain = false) => ({
  type: 'user',
  uuid: `r-${tuid}`,
  isSidechain: sidechain,
  timestamp: ts(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tuid, content, ...(isError ? { is_error: true } : {}) }] },
  toolUseResult,
})

const A = sid(1)
const B = sid(2)
const AGENT = 'a1b2c3d4e5f6a7b8c'

// S1: a main-agent MCP call; input string and response text both over the string cap.
const S1_TOOL = 'mcp__claude_ai_Linear__get_issue'
const s1Input = { id: 'GKA-257', note: 'n'.repeat(3000) }
const s1Text = JSON.stringify({ id: 'GKA-257', title: 'Full call content', description: 'd'.repeat(4900) })
const s1Response = [{ type: 'text', text: s1Text }]
const s1WalInput = { id: 'GKA-257', note: clampStr(s1Input.note) }
const s1WalResponse = [{ type: 'text', text: clampStr(s1Text) }]

// S2: a subagent's Bash call, present only in its subagent transcript.
const s2Input = { command: `echo ${'z'.repeat(3000)}`, description: 'long echo' }
const s2Response = { stdout: 'o'.repeat(4000), stderr: '', interrupted: false, isImage: false, noOutputExpected: false }
const s2WalInput = { command: clampStr(s2Input.command), description: 'long echo' }
const s2WalResponse = { ...s2Response, stdout: clampStr(s2Response.stdout) }

// S3: a Read whose Post line the hook dropped for its size.
const s3Input = { file_path: '/tmp/big.txt' }
const s3Response = { type: 'text', file: { filePath: '/tmp/big.txt', content: 'c'.repeat(120_000), numLines: 1, startLine: 1, totalLines: 1 } }

// S8: a failed MCP call; the transcript's tool_result content is the full error, its toolUseResult a short one.
const S8_TOOL = 'mcp__claude_ai_Linear__save_issue'
const s8Input = { title: 'x' }
const s8Content = `Error: ${'e'.repeat(4000)}`
const s8WalError = clampStr(s8Content)

// S5, S6 and S7: subagent calls whose result lines have no `toolUseResult` (Claude Code 2.1.325), so the
// transcript holds only the short tool_result content. S5's WAL Post is whole, S6's Post line was dropped and
// S7's Post response is clamped.
const s5Input = { file_path: '/tmp/w5.txt', content: 'five' }
const s5Response = { type: 'create', filePath: '/tmp/w5.txt', content: 'five', structuredPatch: [], originalFile: null }
const s5Content = 'File created successfully at: /tmp/w5.txt'
const s6Input = { file_path: '/tmp/w6.txt', content: 'six' }
const s6Content = 'File created successfully at: /tmp/w6.txt'
const s7Input = { file_path: '/tmp/w7.txt', content: 'seven' }
const s7WalResponse = { type: 'update', filePath: '/tmp/w7.txt', content: 'seven', originalFile: clampStr('o'.repeat(3000)) }
const s7Content = 'The file /tmp/w7.txt has been updated successfully.'

// S4: a Grep call that no transcript line holds.
const s4Input = { pattern: 'needle' }
const s4Response = { mode: 'files_with_matches', filenames: [], numFiles: 0 }

writeFileSync(
  join(proj, `${A}.wal.jsonl`),
  lines([
    wal(A, 'PreToolUse', S1_TOOL, 'toolu_s1', { payload: { tool_input: s1WalInput } }),
    wal(A, 'PostToolUse', S1_TOOL, 'toolu_s1', { duration_ms: 400, payload: { tool_input: s1WalInput, tool_response: s1WalResponse } }),
    wal(A, 'PreToolUse', 'Bash', 'toolu_s2', { agent_id: AGENT, agent_type: 'Explore', payload: { tool_input: s2WalInput } }),
    wal(A, 'PostToolUse', 'Bash', 'toolu_s2', {
      agent_id: AGENT,
      agent_type: 'Explore',
      duration_ms: 30,
      payload: { tool_input: s2WalInput, tool_response: s2WalResponse },
    }),
    wal(A, 'PreToolUse', 'Read', 'toolu_s3', { payload: { tool_input: s3Input } }),
    wal(A, 'PostToolUse', 'Read', 'toolu_s3', { duration_ms: 12, dropped: DROPPED }),
    wal(A, 'PreToolUse', S8_TOOL, 'toolu_s8', { payload: { tool_input: s8Input } }),
    wal(A, 'PostToolUseFailure', S8_TOOL, 'toolu_s8', { duration_ms: 50, payload: { tool_input: s8Input, error: s8WalError, is_interrupt: false } }),
    wal(A, 'PreToolUse', 'Write', 'toolu_s5', { agent_id: AGENT, agent_type: 'Explore', payload: { tool_input: s5Input } }),
    wal(A, 'PostToolUse', 'Write', 'toolu_s5', {
      agent_id: AGENT,
      agent_type: 'Explore',
      duration_ms: 5,
      payload: { tool_input: s5Input, tool_response: s5Response },
    }),
    wal(A, 'PreToolUse', 'Edit', 'toolu_s6', { agent_id: AGENT, agent_type: 'Explore', payload: { tool_input: s6Input } }),
    wal(A, 'PostToolUse', 'Edit', 'toolu_s6', { agent_id: AGENT, agent_type: 'Explore', duration_ms: 6, dropped: DROPPED }),
    wal(A, 'PreToolUse', 'MultiEdit', 'toolu_s7', { agent_id: AGENT, agent_type: 'Explore', payload: { tool_input: s7Input } }),
    wal(A, 'PostToolUse', 'MultiEdit', 'toolu_s7', {
      agent_id: AGENT,
      agent_type: 'Explore',
      duration_ms: 7,
      payload: { tool_input: s7Input, tool_response: s7WalResponse },
    }),
    wal(A, 'PreToolUse', 'Grep', 'toolu_s4', { payload: { tool_input: s4Input } }),
    wal(A, 'PostToolUse', 'Grep', 'toolu_s4', { duration_ms: 3, payload: { tool_input: s4Input, tool_response: s4Response } }),
  ]),
)
writeFileSync(
  join(proj, `${A}.jsonl`),
  lines([
    { type: 'user', uuid: 'p-1', timestamp: ts(), origin: { kind: 'human' }, message: { role: 'user', content: 'go' } },
    use('toolu_s1', S1_TOOL, s1Input),
    result('toolu_s1', s1Response, s1Response),
    use('toolu_s3', 'Read', s3Input),
    result('toolu_s3', 'c'.repeat(120_000), s3Response),
    use('toolu_s8', S8_TOOL, s8Input),
    result('toolu_s8', s8Content, 'Error: short', true),
  ]),
)
mkdirSync(join(proj, A, 'subagents'), { recursive: true })
writeFileSync(
  join(proj, A, 'subagents', `agent-${AGENT}.jsonl`),
  lines([
    { type: 'user', uuid: 'sp-1', isSidechain: true, timestamp: ts(), message: { role: 'user', content: 'explore' } },
    use('toolu_s2', 'Bash', s2Input, true),
    result('toolu_s2', s2Response.stdout, s2Response, false, true),
    use('toolu_s5', 'Write', s5Input, true),
    result('toolu_s5', s5Content, undefined, false, true),
    use('toolu_s6', 'Edit', s6Input, true),
    result('toolu_s6', s6Content, undefined, false, true),
    use('toolu_s7', 'MultiEdit', s7Input, true),
    result('toolu_s7', s7Content, undefined, false, true),
  ]),
)

// S4: a session whose transcript does not exist. Discovery lists `<id>.jsonl` by name, so a dangling
// symlink keeps the session found while any open of the transcript fails.
const sbInput = { pattern: '*.ts' }
const sbResponse = { filenames: ['a.ts'], numFiles: 1 }
writeFileSync(
  join(proj, `${B}.wal.jsonl`),
  lines([
    wal(B, 'PreToolUse', 'Glob', 'toolu_sb', { payload: { tool_input: sbInput } }),
    wal(B, 'PostToolUse', 'Glob', 'toolu_sb', { duration_ms: 2, payload: { tool_input: sbInput, tool_response: sbResponse } }),
  ]),
)
symlinkSync(join(proj, 'gone.jsonl'), join(proj, `${B}.jsonl`))

interface CallBody {
  virtual?: true
  pre?: WalRecord
  post?: WalRecord
  call: CallRecord
  restored?: { input?: true; response?: true }
}

const { server, base: BASE } = await startServer([], { HOME: dir })
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`)
  if (!ok) fail = 1
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const short = (v: unknown): string => JSON.stringify(v).slice(0, 300)

const events = async (id: string): Promise<FirstPage> => {
  const r = await fetch(`${BASE}/events?ids=${id}&limit=100`)
  if (!r.ok) throw new Error(`/events status ${r.status}`)
  return (await r.json()) as FirstPage
}
const recordOf = async <T>(id: string, tool: string, names: string[]): Promise<{ status: number; body: T }> => {
  const page = await events(id)
  const row = page.rows.find((r: Row) => r.tool === tool && names.includes(r.event ?? ''))
  if (!row) throw new Error(`no ${names} row for ${tool}: ${JSON.stringify(page.rows)}`)
  const r = await fetch(`${BASE}/record?id=${id}&seq=${row.seq}&gen=${page.gens[id]}`)
  return { status: r.status, body: (r.status === 200 ? await r.json() : {}) as T }
}
const callOf = (id: string, tool: string) => recordOf<CallBody>(id, tool, ['MCP call', 'Tool call'])
const evOf = async (tool: string, event: string): Promise<WalRecord> => (await recordOf<WalRecord>(A, tool, [event])).body

try {
  console.log('record-full.test.ts')

  {
    const { body } = await callOf(A, S1_TOOL)
    check('S1: call.input is the transcript input', same(body.call.input, s1Input), short(body.call.input))
    check('S1: pre.payload.tool_input is the transcript input', same(body.pre?.payload?.tool_input, s1Input), short(body.pre?.payload))
    check('S1: call.response is the transcript toolUseResult', same(body.call.response, s1Response), short(body.call.response))
    check('S1: post.payload.tool_response is the transcript toolUseResult', same(body.post?.payload?.tool_response, s1Response), short(body.post?.payload))
    const text = (body.call.response as { text?: string }[] | null)?.[0]?.text ?? ''
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {}
    check('S1: the response text parses as JSON', parsed !== null && same(parsed, JSON.parse(s1Text)), text.slice(-80))
    check('S1: restored has input and response', same(body.restored, { input: true, response: true }), JSON.stringify(body.restored))
    const copied = copyText(body.call.response, 'json')
    check(
      'S1: copyText of call.response holds the full text',
      copied.includes(`"description": "${'d'.repeat(4900)}"`) && same(JSON.parse(copied), JSON.parse(s1Text)),
      copied.slice(-80),
    )
  }

  {
    const { body } = await callOf(A, 'Bash')
    check('S2: call.input is the subagent transcript input', same(body.call.input, s2Input), short(body.call.input))
    check('S2: call.response is the subagent transcript toolUseResult', same(body.call.response, s2Response), short(body.call.response))
  }

  {
    const { body } = await callOf(A, 'Read')
    check('S3: call.response is the transcript value', same(body.call.response, s3Response), short(body.call.response))
    check('S3: post.payload.tool_response is the transcript value', same(body.post?.payload?.tool_response, s3Response), short(body.post))
  }

  {
    const { body } = await callOf(A, S8_TOOL)
    check('S8: call.response is the full tool_result content', same(body.call.response, s8Content), short(body.call.response))
    check('S8: post.payload.error is the full tool_result content', same(body.post?.payload?.error, s8Content), short(body.post?.payload))
  }

  {
    const pre = await evOf(S1_TOOL, 'PreToolUse')
    check('plain Pre: payload.tool_input is the transcript input', same(pre.payload?.tool_input, s1Input), short(pre.payload))
    check('plain Pre: restored has input only', same(pre.restored, { input: true }), JSON.stringify(pre.restored))
    const post = await evOf(S1_TOOL, 'PostToolUse')
    check('plain Post: payload.tool_input is the transcript input', same(post.payload?.tool_input, s1Input), short(post.payload))
    check('plain Post: payload.tool_response is the transcript toolUseResult', same(post.payload?.tool_response, s1Response), short(post.payload))
    check('plain Post: restored has input and response', same(post.restored, { input: true, response: true }), JSON.stringify(post.restored))
    const dropped = await evOf('Read', 'PostToolUse')
    check(
      'plain dropped Post: a payload with the transcript input and response',
      same(dropped.payload, { tool_input: s3Input, tool_response: s3Response }),
      short(dropped),
    )
    const failed = await evOf(S8_TOOL, 'PostToolUseFailure')
    check('plain failed Post: payload.error is the full tool_result content', same(failed.payload?.error, s8Content), short(failed.payload))
  }

  {
    const { body } = await callOf(A, 'Write')
    check('S5: fullCall flags the content fallback', same(fullCall(proj, A, AGENT, 'toolu_s5'), { input: s5Input, fallback: true, response: s5Content }))
    check(
      'S5: a fallback never replaces a whole WAL Post',
      same(body.call.response, s5Response) && same(body.post?.payload?.tool_response, s5Response),
      short(body),
    )
    check('S5: a whole WAL call has no restored key', !('restored' in body), JSON.stringify(body.restored))
  }

  {
    const { body } = await callOf(A, 'Edit')
    check(
      'S6: a dropped Post takes the fallback content',
      same(body.call.response, s6Content) && same(body.post?.payload?.tool_response, s6Content),
      short(body),
    )
    check('S6: a fallback sets no restored.response', body.restored?.response === undefined, JSON.stringify(body.restored))
    check('S6: the response pane keeps its badge', paneBadge(body.call.response, body.restored?.response, body.post))
  }

  {
    const { body } = await callOf(A, 'MultiEdit')
    check(
      'S7: a fallback never replaces a clamped WAL response',
      same(body.call.response, s7WalResponse) && same(body.post?.payload?.tool_response, s7WalResponse),
      short(body),
    )
    check('S7: a clamped response kept sets no restored.response', body.restored?.response === undefined, JSON.stringify(body.restored))
    check('S7: the response pane keeps its badge', paneBadge(body.call.response, body.restored?.response, body.post))
    const post = await evOf('MultiEdit', 'PostToolUse')
    check('S7: plain Post keeps the clamped WAL response', same(post.payload?.tool_response, s7WalResponse), short(post.payload))
  }

  {
    const { status, body } = await callOf(A, 'Grep')
    check('S4: a tuid in no transcript line answers 200', status === 200, String(status))
    check(
      'S4: a tuid in no transcript line keeps the WAL values',
      same(body.call.input, s4Input) &&
        same(body.call.response, s4Response) &&
        same(body.pre?.payload?.tool_input, s4Input) &&
        same(body.post?.payload?.tool_response, s4Response),
      short(body),
    )
    check('S4: a tuid in no transcript line has no restored key', !('restored' in body), JSON.stringify(body.restored))
  }

  {
    const { status, body } = await callOf(B, 'Glob')
    check('S4: a session without a transcript file answers 200', status === 200, String(status))
    check(
      'S4: a session without a transcript file keeps the WAL values',
      same(body.call.input, sbInput) &&
        same(body.call.response, sbResponse) &&
        same(body.pre?.payload?.tool_input, sbInput) &&
        same(body.post?.payload?.tool_response, sbResponse),
      short(body),
    )
    check('S4: a session without a transcript file has no restored key', !('restored' in body), JSON.stringify(body.restored))
    check('S4: fullCall of a missing transcript file is empty', same(fullCall(proj, B, null, 'toolu_sb'), {}), short(fullCall(proj, B, null, 'toolu_sb')))
    check('S4: fullCall of a tuid in no transcript line is empty', same(fullCall(proj, A, null, 'toolu_s4'), {}), short(fullCall(proj, A, null, 'toolu_s4')))
  }
} catch (err) {
  console.log(`  FAIL harness error — ${(err as Error).message}`)
  fail = 1
} finally {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
}

console.log(fail ? '\nFAILED' : '\nall checks passed')
process.exit(fail)
