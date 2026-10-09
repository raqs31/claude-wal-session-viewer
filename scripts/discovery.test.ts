#!/usr/bin/env node
// discovery.test.ts — /sessions across config dirs, against a fake HOME: realpath dedupe of a
// workspace symlinked to the default projects, an isolated workspace, a --source, and the
// per-row fields read from each session's WAL.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { SessionList, SessionMeta } from '../shared/api.ts'
import { PROMPT_MAX, cleanPrompt } from './discovery.ts'
import { startServer } from './test-server.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, 'fixtures', 'projects')
const dir = mkdtempSync(join(tmpdir(), 'waldisc.'))
const claude = join(dir, '.claude')
const projects = join(claude, 'projects')
const iso = join(claude, 'workspaces', 'iso', 'projects')
const other = join(dir, 'other')
const repo = join(dir, 'repo')

const MAIN = 'd01c2dfc-0a01-4e1f-825a-5b0462780f18'
const TREE = '301167f7-f843-4c79-965b-ae99c2d50f5e'
const CLEAR = '149b4f57-914a-4248-b3b7-5f6f35ab44d1'
const ISO = '7f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b'

const put = (path: string, lines: unknown[]): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, lines.map((l) => JSON.stringify(l) + '\n').join(''))
}
const touch = (path: string, ms: number): void => utimesSync(path, new Date(ms), new Date(ms))
const wal = (ws: string, event: string) => ({ ts: new Date().toISOString(), workspace: ws, event, session_id: 'x' })

const now = Date.now()
const OLD = Date.UTC(2026, 8, 30, 12)

mkdirSync(join(projects, '-tmp-proj'), { recursive: true })
mkdirSync(join(projects, '-tmp-proj--ai-worktrees-demo'), { recursive: true })
copyFileSync(join(FIX, '-tmp-proj', `${MAIN}.jsonl`), join(projects, '-tmp-proj', `${MAIN}.jsonl`))
copyFileSync(join(FIX, '-tmp-proj--ai-worktrees-demo', `${TREE}.jsonl`), join(projects, '-tmp-proj--ai-worktrees-demo', `${TREE}.jsonl`))
// Resumed under a second workspace: both names must show.
const mainWal = join(projects, '-tmp-proj', `${MAIN}.wal.jsonl`)
put(mainWal, [wal('default', 'SessionStart'), wal('priv', 'UserPromptSubmit'), wal('default', 'Stop')])
touch(join(projects, '-tmp-proj', `${MAIN}.jsonl`), OLD)
touch(mainWal, now - 10_000)
touch(join(projects, '-tmp-proj--ai-worktrees-demo', `${TREE}.jsonl`), OLD)

// Default-style workspace: its projects/ is the default one, so its sessions must not repeat.
mkdirSync(join(claude, 'workspaces', 'priv'), { recursive: true })
symlinkSync(projects, join(claude, 'workspaces', 'priv', 'projects'))

const isoFile = join(iso, '-repo', `${ISO}.jsonl`)
put(isoFile, [{ type: 'user', uuid: 'u1', parentUuid: null, isSidechain: false, timestamp: '2026-10-01T10:00:00.000Z', cwd: repo, sessionId: ISO, message: { role: 'user', content: 'hello iso' } }])
const isoWal = join(iso, '-repo', `${ISO}.wal.jsonl`)
put(isoWal, [wal('iso', 'SessionStart'), wal('iso', 'SessionEnd')])
touch(isoFile, OLD)
touch(isoWal, now - 20_000)
put(join(repo, '.ai', 'logs', 'wal.jsonl'), [wal('default', 'Stop')])

const clearFile = join(other, 'projects', '-tmp-proj', `${CLEAR}.jsonl`)
mkdirSync(dirname(clearFile), { recursive: true })
copyFileSync(join(FIX, '-tmp-proj', `${CLEAR}.jsonl`), clearFile)
touch(clearFile, now - 30_000)

const { server, base } = await startServer([`--source=${other}`], { HOME: dir })
after(() => {
  server.kill()
  rmSync(dir, { recursive: true, force: true })
})

const list = async (): Promise<SessionList> => (await (await fetch(`${base}/sessions`)).json()) as SessionList
const row = (l: SessionList, id: string): SessionMeta => {
  const r = l.sessions.find((s) => s.id === id)
  assert.ok(r, `${id} listed`)
  return r
}

test('sources: default, the isolated workspace and --source; the symlinked workspace collapses', async () => {
  const l = await list()
  assert.deepEqual(l.sources.map((s) => s.label), ['default', 'iso', 'other'])
  assert.equal(l.sources[0]!.projectsDir, realpathSync(projects))
})

test('every session once, newest activity first, WAL files not listed as sessions', async () => {
  assert.deepEqual((await list()).sessions.map((s) => s.id), [MAIN, ISO, CLEAR, TREE])
})

test('source label and project slug + cwd per row', async () => {
  const l = await list()
  assert.equal(row(l, MAIN).source, 'default')
  assert.equal(row(l, ISO).source, 'iso')
  assert.equal(row(l, CLEAR).source, 'other')
  assert.deepEqual(row(l, MAIN).project, { slug: '-tmp-proj', cwd: '/tmp/proj' })
  assert.deepEqual(row(l, ISO).project, { slug: '-repo', cwd: repo })
  assert.equal(row(l, ISO).title, 'hello iso')
})

test('worktree badge: the slug suffix, its project the parent slug', async () => {
  const l = await list()
  assert.equal(row(l, TREE).worktree, 'demo')
  assert.equal(row(l, TREE).project.slug, '-tmp-proj')
  assert.equal(row(l, MAIN).worktree, null)
})

test('workspaces[] from the whole WAL, unknown without one', async () => {
  const l = await list()
  assert.deepEqual(row(l, MAIN).workspaces, ['default', 'priv'])
  assert.deepEqual(row(l, ISO).workspaces, ['iso'])
  assert.deepEqual(row(l, TREE).workspaces, ['unknown'])
})

test('sizes and walLines, last = newest of both mtimes', async () => {
  const l = await list()
  const m = row(l, MAIN)
  assert.equal(m.transcriptSize, statSync(join(projects, '-tmp-proj', `${MAIN}.jsonl`)).size)
  assert.equal(m.walSize, statSync(mainWal).size)
  assert.equal(m.walLines, 3)
  assert.equal(m.last, statSync(mainWal).mtimeMs)
  assert.equal(row(l, TREE).walSize, 0)
  assert.equal(row(l, TREE).walLines, 0)
})

test('live: recent activity and no SessionEnd', async () => {
  const l = await list()
  assert.equal(row(l, MAIN).live, true, 'recent WAL')
  assert.equal(row(l, CLEAR).live, true, 'recent transcript, no WAL')
  assert.equal(row(l, ISO).live, false, 'ended')
  assert.equal(row(l, TREE).live, false, 'stale')
})

test('legacy counts distinct cwds holding .ai/logs/wal.jsonl', async () => {
  assert.equal((await list()).legacy, 1)
})

test('walLines and workspaces follow appends; a partial line waits for its newline', async () => {
  appendFileSync(mainWal, JSON.stringify(wal('iso', 'PreToolUse')) + '\n' + '{"ts":"x","workspace":"half')
  let m = row(await list(), MAIN)
  assert.equal(m.walLines, 4)
  assert.deepEqual(m.workspaces, ['default', 'priv', 'iso'])
  assert.equal(m.walSize, statSync(mainWal).size)
  appendFileSync(mainWal, '","event":"Stop"}\n')
  m = row(await list(), MAIN)
  assert.equal(m.walLines, 5)
  assert.deepEqual(m.workspaces, ['default', 'priv', 'iso', 'half'])
})

test('a session found under a --source or workspace opens via /session', async () => {
  assert.equal((await fetch(`${base}/session?id=${CLEAR}&scope=all`)).status, 200)
  assert.equal((await fetch(`${base}/session?id=${ISO}&scope=all`)).status, 200)
})

test('a WAL replaced by rename with a longer file is rescanned from its first byte', async () => {
  const tmp = join(projects, '-tmp-proj', 'rotate.tmp')
  put(tmp, Array.from({ length: 6 }, () => wal('rotated', 'Stop')))
  renameSync(tmp, mainWal)
  const m = row(await list(), MAIN)
  assert.equal(m.walLines, 6)
  assert.deepEqual(m.workspaces, ['rotated'])
})

test('a WAL line longer than one read chunk does not stall the scan', async () => {
  const BIG = 'b16b16b1-0000-4000-8000-000000000001'
  writeFileSync(join(projects, '-tmp-proj', `${BIG}.jsonl`), '')
  const bigWal = join(projects, '-tmp-proj', `${BIG}.wal.jsonl`)
  put(bigWal, [{ ...wal('huge', 'PreToolUse'), payload: 'x'.repeat(9 * 1024 * 1024) }, wal('after', 'Stop')])
  let b = row(await list(), BIG)
  assert.equal(b.walLines, 2)
  assert.deepEqual(b.workspaces, ['huge', 'after'])
  appendFileSync(bigWal, JSON.stringify(wal('later', 'Stop')) + '\n')
  b = row(await list(), BIG)
  assert.equal(b.walLines, 3)
  assert.deepEqual(b.workspaces, ['huge', 'after', 'later'])
})

test('an unreadable source or transcript is skipped, not a 500', async () => {
  const UNREAD = 'deadbeef-0000-4000-8000-000000000001'
  const file = join(projects, '-tmp-proj', `${UNREAD}.jsonl`)
  writeFileSync(file, '{}\n')
  chmodSync(file, 0o000)
  chmodSync(join(other, 'projects'), 0o000)
  try {
    const r = await fetch(`${base}/sessions`)
    assert.equal(r.status, 200)
    const ids = ((await r.json()) as SessionList).sessions.map((s) => s.id)
    assert.ok(ids.includes(MAIN) && !ids.includes(UNREAD) && !ids.includes(CLEAR), ids.join())
  } finally {
    chmodSync(join(other, 'projects'), 0o755)
    rmSync(file)
  }
})

test('title: the last ai-title in the tail, else one in the head; started is the earliest head timestamp', async () => {
  const LONG = 'a11ea11e-0000-4000-8000-000000000001'
  const HEADONLY = 'a11ea11e-0000-4000-8000-000000000002'
  const at = (s: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString()
  const prompt = { type: 'user', uuid: 'p1', timestamp: at(5), cwd: repo, message: { role: 'user', content: 'first prompt' } }
  // Earlier than the prompt, as an attachment logged after it can be.
  const attachment = { type: 'attachment', uuid: 'a1', timestamp: at(0), cwd: repo }
  // Mentions the type in a nested object, which must not count as a title entry.
  const pad = Array.from({ length: 80 }, (_, i) => ({ type: 'assistant', uuid: `x${i}`, timestamp: at(10), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { type: 'ai-title', aiTitle: 'nested', pad: 'y'.repeat(4000) } }] } }))
  const longFile = join(projects, '-tmp-proj', `${LONG}.jsonl`)
  put(longFile, [prompt, attachment, { type: 'ai-title', aiTitle: 'early' }, ...pad, { type: 'ai-title', aiTitle: 'late' }, { type: 'ai-title' }])
  appendFileSync(longFile, '{"type":"ai-title","aiTitle":"half')
  put(join(projects, '-tmp-proj', `${HEADONLY}.jsonl`), [prompt, { type: 'ai-title', aiTitle: 'head title' }, ...pad])
  assert.ok(statSync(longFile).size > 256 * 1024)
  const l = await list()
  assert.equal(row(l, LONG).title, 'late')
  assert.equal(row(l, LONG).started, Date.parse(at(0)))
  assert.equal(row(l, LONG).project.cwd, repo)
  assert.equal(row(l, HEADONLY).title, 'head title')
})

test('cleanPrompt: a command becomes ⚡ /name args, args keep their newlines', () => {
  const cmd = (args: string) => `<command-message>mario:orchestrate</command-message>\n<command-name>/mario:orchestrate</command-name>\n${args}`
  assert.equal(cleanPrompt(cmd('<command-args>ive seen strange\nthings</command-args>')), '⚡ /mario:orchestrate ive seen strange\nthings')
  assert.equal(cleanPrompt('<command-name>/goal</command-name><command-args></command-args>'), '⚡ /goal')
  assert.equal(cleanPrompt('<command-name>/goal</command-name>'), '⚡ /goal')
})

test('cleanPrompt: reminders and command output are dropped, other tags stripped', () => {
  assert.equal(cleanPrompt('fix it<system-reminder>noise</system-reminder>'), 'fix it')
  assert.equal(cleanPrompt('<local-command-caveat>c</local-command-caveat>hi<local-command-stdout>out</local-command-stdout>'), 'hi')
  assert.equal(cleanPrompt('use <b>bold</b> here'), 'use bold here')
  assert.equal(cleanPrompt('<bash-input>ls</bash-input>'), 'ls')
  assert.equal(cleanPrompt('a < b > c'), 'a < b > c')
})

test('cleanPrompt: nesting, unclosed tags, empties and whitespace', () => {
  assert.equal(cleanPrompt('<system-reminder>a<system-reminder>b</system-reminder>c</system-reminder>keep'), 'keep')
  assert.equal(cleanPrompt('<system-reminder>keep this'), 'keep this')
  assert.equal(cleanPrompt('text <b>unclosed'), 'text unclosed')
  assert.equal(cleanPrompt('<system-reminder>only</system-reminder>'), null)
  assert.equal(cleanPrompt(''), null)
  assert.equal(cleanPrompt('\n a\n\n\n\nb \n'), 'a\n\nb')
})

test('name: the latest custom-title beats ai-title, from the tail or else the head', async () => {
  const SMALL = 'a11ea11e-0000-4000-8000-000000000003'
  const BIG = 'a11ea11e-0000-4000-8000-000000000004'
  const AUTO = 'a11ea11e-0000-4000-8000-000000000005'
  const at = (s: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString()
  const prompt = { type: 'user', uuid: 'p1', timestamp: at(5), cwd: repo, message: { role: 'user', content: 'first prompt' } }
  const pad = Array.from({ length: 80 }, (_, i) => ({ type: 'assistant', uuid: `x${i}`, timestamp: at(10), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { type: 'custom-title', customTitle: 'nested', pad: 'y'.repeat(4000) } }] } }))
  put(join(projects, '-tmp-proj', `${SMALL}.jsonl`), [
    { type: 'custom-title', customTitle: 'old-name' }, prompt, { type: 'ai-title', aiTitle: 'auto' },
    { type: 'custom-title', customTitle: 'new-name' }, { type: 'ai-title', aiTitle: 'auto later' },
  ])
  const bigFile = join(projects, '-tmp-proj', `${BIG}.jsonl`)
  put(bigFile, [{ type: 'custom-title', customTitle: 'head name' }, prompt, ...pad, { type: 'ai-title', aiTitle: 'tail auto' }])
  put(join(projects, '-tmp-proj', `${AUTO}.jsonl`), [prompt, { type: 'ai-title', aiTitle: 'only auto' }])
  assert.ok(statSync(bigFile).size > 256 * 1024)
  const l = await list()
  assert.equal(row(l, SMALL).title, 'new-name')
  assert.equal(row(l, SMALL).prompt, 'first prompt')
  assert.equal(row(l, BIG).title, 'head name')
  assert.equal(row(l, AUTO).title, 'only auto')
})

test('prompt: the cleaned first message that opened a turn, meta skipped, capped', async () => {
  const RAW = 'a11ea11e-0000-4000-8000-000000000006'
  const CMD = 'a11ea11e-0000-4000-8000-000000000007'
  const BIG = 'a11ea11e-0000-4000-8000-000000000008'
  const at = (s: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString()
  const user = (uuid: string, content: string, extra: object = {}) => ({ type: 'user', uuid, timestamp: at(5), cwd: repo, message: { role: 'user', content }, ...extra })
  const raw = 'line one\n<b>two</b>\n  three'
  put(join(projects, '-tmp-proj', `${RAW}.jsonl`), [user('m1', '<system-reminder>meta</system-reminder>', { isMeta: true }), user('p1', raw)])
  const markup = '<command-message>goal</command-message>\n<command-name>/goal</command-name>\n<command-args>ship it</command-args>'
  put(join(projects, '-tmp-proj', `${CMD}.jsonl`), [
    user('c1', markup),
    { type: 'assistant', uuid: 'a1', timestamp: at(6), message: { role: 'assistant', model: 'claude-x', id: 'msg1', content: [{ type: 'text', text: 'ok' }] } },
  ])
  put(join(projects, '-tmp-proj', `${BIG}.jsonl`), [user('p1', 'x'.repeat(PROMPT_MAX + 500))])
  const l = await list()
  assert.equal(row(l, RAW).prompt, 'line one\ntwo\n  three')
  assert.equal(row(l, RAW).title, 'line one two three')
  assert.equal(row(l, CMD).prompt, '⚡ /goal ship it')
  assert.equal(row(l, BIG).prompt, 'x'.repeat(PROMPT_MAX) + '…')
})

test('name: a cleared rename falls through to the auto title', async () => {
  const CLEARED = 'a11ea11e-0000-4000-8000-00000000000a'
  const prompt = { type: 'user', uuid: 'p1', timestamp: new Date(Date.UTC(2026, 9, 1, 10)).toISOString(), cwd: repo, message: { role: 'user', content: 'first prompt' } }
  put(join(projects, '-tmp-proj', `${CLEARED}.jsonl`), [prompt, { type: 'ai-title', aiTitle: 'auto' }, { type: 'custom-title', customTitle: 'named' }, { type: 'custom-title', customTitle: '' }])
  assert.equal(row(await list(), CLEARED).title, 'auto')
})

test('prompt: a surrogate pair split by the cap drops the lone high surrogate', async () => {
  const PAIR = 'a11ea11e-0000-4000-8000-00000000000b'
  const content = 'x'.repeat(PROMPT_MAX - 1) + '😀' + 'tail'
  put(join(projects, '-tmp-proj', `${PAIR}.jsonl`), [{ type: 'user', uuid: 'p1', timestamp: new Date(Date.UTC(2026, 9, 1, 10)).toISOString(), cwd: repo, message: { role: 'user', content } }])
  const prompt = row(await list(), PAIR).prompt
  assert.equal(prompt, 'x'.repeat(PROMPT_MAX - 1) + '…')
  assert.ok(!/[\uD800-\uDBFF]$/.test(prompt.slice(0, -1)))
})

test('name: a half-written last line is ignored', async () => {
  const HALF = 'a11ea11e-0000-4000-8000-00000000000c'
  const file = join(projects, '-tmp-proj', `${HALF}.jsonl`)
  const prompt = { type: 'user', uuid: 'p1', timestamp: new Date(Date.UTC(2026, 9, 1, 10)).toISOString(), cwd: repo, message: { role: 'user', content: 'first prompt' } }
  put(file, [prompt, { type: 'custom-title', customTitle: 'done' }])
  appendFileSync(file, '{"type":"custom-title","customTitle":"half')
  assert.equal(row(await list(), HALF).title, 'done')
})

test('name: a slash-command session with no titles is named by its cleaned command', async () => {
  const SLASH = 'a11ea11e-0000-4000-8000-00000000000d'
  const at = (s: number): string => new Date(Date.UTC(2026, 9, 1, 10, 0, s)).toISOString()
  const markup = '<command-message>goal</command-message>\n<command-name>/goal</command-name>\n<command-args>ship it</command-args>'
  put(join(projects, '-tmp-proj', `${SLASH}.jsonl`), [
    { type: 'user', uuid: 'c1', timestamp: at(5), cwd: repo, message: { role: 'user', content: markup } },
    { type: 'assistant', uuid: 'a1', timestamp: at(6), message: { role: 'assistant', model: 'claude-x', id: 'msg1', content: [{ type: 'text', text: 'ok' }] } },
  ])
  const r = row(await list(), SLASH)
  assert.equal(r.title, '⚡ /goal ship it')
})

test('prompt: the cap applies after cleaning, and a message of only dropped blocks leaves no prompt', async () => {
  const LONG = 'a11ea11e-0000-4000-8000-00000000000e'
  const EMPTY = 'a11ea11e-0000-4000-8000-00000000000f'
  const user = (content: string) => ({ type: 'user', uuid: 'p1', timestamp: new Date(Date.UTC(2026, 9, 1, 10)).toISOString(), cwd: repo, message: { role: 'user', content } })
  put(join(projects, '-tmp-proj', `${LONG}.jsonl`), [user('<system-reminder>' + 'y'.repeat(PROMPT_MAX) + '</system-reminder>' + 'x'.repeat(PROMPT_MAX - 10))])
  put(join(projects, '-tmp-proj', `${EMPTY}.jsonl`), [user('<system-reminder>only noise</system-reminder>')])
  const l = await list()
  assert.equal(row(l, LONG).prompt, 'x'.repeat(PROMPT_MAX - 10))
  assert.equal(row(l, EMPTY).prompt, null)
  assert.equal(row(l, EMPTY).title, '')
})

test('a rename appended after a list shows on the next list', async () => {
  const LATE = 'a11ea11e-0000-4000-8000-000000000009'
  const file = join(projects, '-tmp-proj', `${LATE}.jsonl`)
  put(file, [{ type: 'user', uuid: 'p1', timestamp: new Date(Date.UTC(2026, 9, 1, 10)).toISOString(), cwd: repo, message: { role: 'user', content: 'before rename' } }])
  assert.equal(row(await list(), LATE).title, 'before rename')
  appendFileSync(file, JSON.stringify({ type: 'custom-title', customTitle: 'renamed later' }) + '\n')
  assert.equal(row(await list(), LATE).title, 'renamed later')
})
