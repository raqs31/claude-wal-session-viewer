#!/usr/bin/env node
// bench-sessions.ts — proves the Sessions endpoints stay within budget on a ~16 MB transcript with
// subagents, beside 299 smaller sessions for the list.
//
// A prompt puts a multibyte character across the first 8 MB read chunk, so a miscounted turn in
// /session is the only sign of a mishandled partial line; a 650 KB tool result stands in for the
// largest real lines. The 300 sessions are split across a symlinked workspace and a --source.

import { appendFileSync, closeSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SessionList, SessionView } from '../shared/api.ts'
import { createStore } from './sessions.ts'
import { startServer } from './test-server.ts'

const dir = mkdtempSync(join(tmpdir(), 'walsessbench.'))
// A workspace whose `projects/` is a symlink to a real directory, plus a second dir for --source.
const wsRoot = join(dir, 'ws-real', 'projects')
const srcRoot = join(dir, 'extra-src', 'projects')
const roots = [wsRoot, srcRoot]
const PROJECT = '/tmp/benchproj'
const SLUG = '-tmp-benchproj'
const CHUNK = 8 * 1024 * 1024
const MAIN_BYTES = 16 * 1024 * 1024
const AGENTS = 8
const FILES = 300
const T0 = Date.parse('2026-09-01T00:00:00Z')
let fail = 0

const sid = (n: number): string => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`
const MAIN = sid(0)
const filler = 'lorem ipsum dolor sit amet zażółć gęślą jaźń — '
const text = (n: number): string => filler.repeat(Math.ceil(n / filler.length)).slice(0, n)

// Writes one transcript: turns of prompt → thinking/text/tool call → result → closing text.
const transcript = (path: string, session: string, bytes: number, opts: { agent?: string; spawns?: number[]; big?: number } = {}) => {
  let offset = 0
  let n = 0
  let parent: string | null = null
  let boundaryHit = false
  let requests = 0
  let prompts = 0
  const spawns: string[] = []
  const fd = openSync(path, 'w')
  const put = (e: Record<string, unknown>): string => {
    const uuid = `${(opts.agent ?? 'm000').slice(-4)}0000-0000-4000-8000-${String(n++).padStart(12, '0')}`
    const buf = Buffer.from(
      `${JSON.stringify({
        parentUuid: parent,
        isSidechain: !!opts.agent,
        uuid,
        timestamp: new Date(T0 + n * 1000).toISOString(),
        sessionId: session,
        cwd: PROJECT,
        ...e,
      })}\n`,
    )
    writeSync(fd, buf)
    offset += buf.length
    parent = uuid
    return uuid
  }
  const model = opts.agent ? 'claude-sonnet-5' : 'claude-opus-5-5'
  const reply = (id: string, content: unknown[]) => {
    const usage = {
      input_tokens: 3,
      cache_creation_input_tokens: 900,
      cache_read_input_tokens: 40_000 + n * 10,
      output_tokens: 350,
      output_tokens_details: { thinking_tokens: 120 },
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 900 },
    }
    requests++
    for (const b of content) put({ type: 'assistant', message: { model, id, type: 'message', role: 'assistant', content: [b], usage } })
  }
  for (let turn = 0; offset < bytes; turn++) {
    if (opts.agent && turn === 0) put({ type: 'user', message: { role: 'user', content: `task for ${opts.agent}` } })
    else if (!opts.agent) {
      let prompt = `prompt ${turn} ${text(200)}`
      // The window is wider than any turn below the boundary, so the line always starts short of it.
      prompts++
      if (!boundaryHit && offset >= CHUNK - 64 * 1024) {
        // 'ż' is two bytes: start it on the last byte before the chunk boundary.
        const probe = JSON.stringify({
          parentUuid: parent,
          isSidechain: false,
          uuid: 'm0000000-0000-4000-8000-000000000000',
          timestamp: new Date(T0 + (n + 1) * 1000).toISOString(),
          sessionId: session,
          cwd: PROJECT,
          type: 'user',
          message: { role: 'user', content: 'MARK' },
        })
        const pad = CHUNK - 1 - offset - probe.indexOf('MARK')
        if (pad < 0) throw new Error(`boundary prompt starts past the chunk (${-pad} bytes)`)
        prompt = `${'x'.repeat(pad)}żboundary`
        boundaryHit = true
        put({ type: 'user', message: { role: 'user', content: prompt } })
      } else put({ type: 'user', message: { role: 'user', content: prompt } })
    }
    const tool = `toolu_${opts.agent ?? 'm'}_${turn}`
    reply(`msg_${opts.agent ?? 'm'}_${turn}a`, [
      { type: 'thinking', thinking: text(600), signature: 'sig' },
      { type: 'text', text: text(400) },
      { type: 'tool_use', id: tool, name: 'Bash', input: { command: `echo ${turn}` } },
    ])
    const size = turn === opts.big ? 650 * 1024 : 2000 + (turn % 7) * 700
    put({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tool, content: text(size) }] } })
    if (opts.spawns?.includes(turn)) {
      const id = `a${String(spawns.length).padStart(16, '0')}`
      const call = `toolu_agent_${turn}`
      reply(`msg_m_${turn}s`, [{ type: 'tool_use', id: call, name: 'Agent', input: { subagent_type: 'general-purpose', description: `agent ${id}` } }])
      put({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: 'done' }] }, toolUseResult: { agentId: id } })
      spawns.push(`${id}\t${call}`)
    }
    reply(`msg_${opts.agent ?? 'm'}_${turn}b`, [{ type: 'text', text: text(300) }])
  }
  if (!opts.agent) put({ type: 'ai-title', aiTitle: `bench ${session.slice(0, 8)}` })
  closeSync(fd)
  return { bytes: offset, boundaryHit, requests, prompts, spawns }
}

try {
  mkdirSync(join(dir, '.claude', 'workspaces', 'ws1'), { recursive: true })
  mkdirSync(wsRoot, { recursive: true })
  symlinkSync(wsRoot, join(dir, '.claude', 'workspaces', 'ws1', 'projects'))
  const mainDir = join(wsRoot, SLUG)
  mkdirSync(join(mainDir, MAIN, 'subagents'), { recursive: true })
  const big = transcript(join(mainDir, `${MAIN}.jsonl`), MAIN, MAIN_BYTES, { spawns: Array.from({ length: AGENTS }, (_, i) => 50 + i * 150), big: 40 })
  if (!big.boundaryHit) throw new Error('generator never reached the chunk boundary')
  let agentBytes = 0
  let agentRequests = 0
  for (const s of big.spawns) {
    const [id, call] = s.split('\t') as [string, string]
    const base = join(mainDir, MAIN, 'subagents', `agent-${id}`)
    const a = transcript(`${base}.jsonl`, MAIN, 512 * 1024, { agent: id })
    agentBytes += a.bytes
    agentRequests += a.requests
    writeFileSync(`${base}.meta.json`, JSON.stringify({ agentType: 'general-purpose', description: `agent ${id}`, toolUseId: call, model: 'sonnet' }))
  }
  const walLine = (session: string): string =>
    `${JSON.stringify({ ts: new Date(T0).toISOString(), workspace: PROJECT, event: 'SessionStart', session_id: session })}\n`
  writeFileSync(join(mainDir, `${MAIN}.wal.jsonl`), walLine(MAIN))
  const listed = [join(mainDir, `${MAIN}.jsonl`)]
  // Odd files go to the workspace, even ones to --source. Sizes cycle 10 KB – 600 KB, so some tails
  // are the list's full 256 KB window.
  for (let i = 1; i < FILES; i++) {
    const d = i % 30 === 0 ? `${SLUG}--ai-worktrees-demo` : SLUG
    const folder = join(roots[i % 2]!, d)
    mkdirSync(folder, { recursive: true })
    listed.push(join(folder, `${sid(i)}.jsonl`))
    transcript(listed[i]!, sid(i), 10 * 1024 + ((i * 37) % 60) * 10 * 1024)
    writeFileSync(join(folder, `${sid(i)}.wal.jsonl`), walLine(sid(i)))
  }

  const check = (label: string, ok: boolean, detail = ''): void => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — ${detail}`}`)
    if (!ok) fail = 1
  }
  const timed = async <T>(path: string): Promise<{ ms: number; body: T }> => {
    const t = performance.now()
    const r = await fetch(`${BASE}${path}`)
    const body = (await r.json()) as T
    return { ms: Math.round(performance.now() - t), body }
  }

  console.log(
    `bench-sessions: main ${(big.bytes / 1048576).toFixed(1)} MB + ${AGENTS} subagents ${(agentBytes / 1048576).toFixed(1)} MB, ${FILES} session files`,
  )
  const { server, base: BASE } = await startServer([`--source=${join(dir, 'extra-src')}`], { HOME: dir })
  try {
    // Best of three cold listings: a single one is at the mercy of whatever else loads the host.
    // A new mtime on every file misses the list's size+mtime cache, so each run rereads all tails.
    let list: { ms: number; body: SessionList } | undefined
    for (let run = 1; run <= 3; run++) {
      const at = Date.now() / 1000 + run
      for (const f of listed) utimesSync(f, at, at)
      const r = await timed<SessionList>('/sessions')
      if (!list || r.ms < list.ms) list = r
    }
    console.log(`/sessions cold    ${list!.ms} ms (best of 3)`)
    check('/sessions ≤ 500 ms', list!.ms <= 500)
    check(
      'lists every session incl. the worktree',
      list!.body.sessions.length === FILES && list!.body.sessions.some((m) => m.worktree === 'demo'),
      `got ${list!.body.sessions.length}`,
    )

    const cold = await timed<SessionView>(`/session?id=${MAIN}`)
    console.log(`/session cold     ${cold.ms} ms`)
    check('/session cold ≤ 1.5 s', cold.ms <= 1500)
    // A dropped or doubled boundary prompt would shift the count.
    check(
      '/session stats match the 16 MB transcript',
      cold.body.stats.totals.requests === big.requests + agentRequests && cold.body.stats.turns === big.prompts,
      `requests ${cold.body.stats.totals.requests}/${big.requests + agentRequests}, turns ${cold.body.stats.turns}/${big.prompts}`,
    )
    check('all subagents listed', cold.body.agents.length === AGENTS, String(cold.body.agents.length))

    const cached = await timed<SessionView>(`/session?id=${MAIN}`)
    console.log(`/session cached   ${cached.ms} ms`)
    check('/session cached ≤ 100 ms', cached.ms <= 100)
  } catch (err) {
    console.log(`  FAIL ${(err as Error).message}`)
    fail = 1
  } finally {
    server.kill()
  }

  try {
    // In-process, so the numbers are the store's own work without HTTP or JSON on top.
    const store = createStore({ locate: () => join(wsRoot, SLUG) }, () => false)
    const s = store.get(MAIN)!
    const requests = store.view(s, 'all')!.stats.totals.requests
    const lines: string[] = []
    let bytes = 0
    for (let i = 0; bytes < 1024 * 1024; i++) {
      const l = `${JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        uuid: `f0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        timestamp: new Date(T0 + 9e8 + i).toISOString(),
        sessionId: MAIN,
        type: 'assistant',
        message: {
          model: 'claude-opus-5-5',
          id: `msg_append_${i}`,
          role: 'assistant',
          content: [{ type: 'text', text: text(2000) }],
          usage: { input_tokens: 1, output_tokens: 10 },
        },
      })}\n`
      lines.push(l)
      bytes += Buffer.byteLength(l)
    }
    appendFileSync(s.main.path, lines.join(''))
    const t = performance.now()
    const after = store.get(MAIN)!
    const v = store.view(after, 'all')!
    const tickMs = Math.round(performance.now() - t)
    console.log(`tick, 1 MB append ${tickMs} ms (advance + view, ${lines.length} new requests)`)
    check('append reaches the view', v.stats.totals.requests === requests + lines.length, `got ${v.stats.totals.requests - requests}`)
  } catch (err) {
    console.log(`  FAIL ${(err as Error).message}`)
    fail = 1
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(fail)
