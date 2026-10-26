#!/usr/bin/env node

// target.test.ts — the target file contract over a temp dir: append, the torn tail, incremental
// reads, shrink and new-inode detection, and the observer lock. No server.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { acquireLock, appendRecords, createTargetReader, releaseLock, TARGET_VERSION, type TargetRecord, targetDir, targetPath } from './target.ts'

const root = mkdtempSync(join(tmpdir(), 'waltarget.'))
after(() => rmSync(root, { recursive: true, force: true }))

const ID = 'aaaaaaaa-0000-4000-8000-000000000001'
let n = 0
const fresh = (): string => join(root, `t${++n}`, `${ID}.jsonl`)
const lines = (file: string): string[] => readFileSync(file, 'utf8').split('\n')

const head: TargetRecord = { k: 'head', v: TARGET_VERSION, id: ID, wal: true }
type Ev = Extract<TargetRecord, { k: 'ev' }>
// The source comes first, so it is the caller's key order that `appendRecords` has to fix.
const ev = (t: number, src: { rec: unknown } | { raw: string } = { rec: {} }): Ev =>
  ({
    ...src,
    k: 'ev',
    t,
    event: 'Stop',
    cat: 'session',
    tool: null,
    dur: null,
    tuid: null,
    agent: null,
    agentType: null,
    mcp: null,
    err: false,
    woff: t,
  }) as Ev

test('paths: the target sits in wal-viewer beside the projects dir', () => {
  const src = { label: 'default', projectsDir: join(root, '.claude', 'projects') }
  assert.equal(targetDir(src), join(root, '.claude', 'wal-viewer'))
  assert.equal(targetPath(src, ID), join(root, '.claude', 'wal-viewer', `${ID}.jsonl`))
})

test('append: one line per record, k first, search keys last', () => {
  const file = fresh()
  appendRecords(file, [
    head,
    ev(1, { rec: { event: 'Stop' } }),
    { k: 'call', response: 'out', input: { a: 1 }, tuid: 'toolu_1', t: 1, end: 2, dur: 1, tool: 'Bash', mcp: false, err: false, agent: null, agentType: null },
  ])
  const ls = lines(file)
  assert.equal(ls.length, 4)
  assert.equal(ls[3], '')
  for (const l of ls.slice(0, 3)) assert.ok(l.startsWith('{"k":'))
  const evLine = ls[1] ?? ''
  assert.ok(evLine.endsWith('"rec":{"event":"Stop"}}'))
  const callLine = ls[2] ?? ''
  assert.ok(callLine.endsWith('"input":{"a":1},"response":"out"}'))
})

test('append: a large batch is written whole', () => {
  const file = fresh()
  const big = Array.from({ length: 300 }, (_, i) => ev(i, { raw: 'x'.repeat(1000) }))
  appendRecords(file, big)
  const { items, reset } = createTargetReader(file).read()
  assert.equal(reset, false)
  assert.equal(items.length, 300)
  assert.deepEqual(
    items.map((i) => (i.rec.k === 'ev' ? i.rec.t : -1)),
    big.map((r) => (r.k === 'ev' ? r.t : -2)),
  )
})

test('torn tail: the next append starts a new line and the reader skips the torn one', () => {
  const file = fresh()
  appendRecords(file, [head])
  appendFileSync(file, '{"k":"ev","t":')
  appendRecords(file, [ev(5)])
  const { items } = createTargetReader(file).read()
  assert.deepEqual(
    items.map((i) => i.rec.k),
    ['head', 'ev'],
  )
  const text = readFileSync(file, 'utf8')
  assert.ok(text.endsWith('\n'))
  assert.ok(text.includes('{"k":"ev","t":\n{"k":"ev"'))
})

test('read: off and len point at each line; a partial line waits for its newline', () => {
  const file = fresh()
  appendRecords(file, [head, ev(1, { raw: 'é' })])
  const reader = createTargetReader(file)
  const first = reader.read()
  assert.equal(first.items.length, 2)
  const text = readFileSync(file)
  for (const i of first.items) assert.deepEqual(JSON.parse(text.subarray(i.off, i.off + i.len).toString('utf8')), i.rec)
  assert.equal(first.items[1]?.off, (first.items[0]?.len ?? 0) + 1)

  const next = `${JSON.stringify(ev(2))}\n`
  appendFileSync(file, next.slice(0, 10))
  assert.deepEqual(reader.read(), { items: [], reset: false })
  appendFileSync(file, next.slice(10))
  const done = reader.read()
  assert.equal(done.items.length, 1)
  assert.equal(done.items[0]?.off, text.length)
  assert.equal(done.items[0]?.len, next.length - 1)
  assert.deepEqual(reader.read(), { items: [], reset: false })
})

test('read: unparseable lines are skipped', () => {
  const file = fresh()
  mkdirSync(dirname(file))
  writeFileSync(file, `not json\n${JSON.stringify(head)}\n{"no":"k"}\n[1]\n${JSON.stringify(ev(1))}\n`)
  const { items } = createTargetReader(file).read()
  assert.deepEqual(
    items.map((i) => i.rec.k),
    ['head', 'ev'],
  )
})

test('read: a shrink restarts from byte 0 and reports reset', () => {
  const file = fresh()
  appendRecords(file, [head, ev(1), ev(2)])
  const reader = createTargetReader(file)
  assert.equal(reader.read().items.length, 3)
  truncateSync(file, 0)
  appendRecords(file, [head])
  const after = reader.read()
  assert.equal(after.reset, true)
  assert.equal(after.items.length, 1)
  assert.equal(after.items[0]?.off, 0)
})

test('read: a new inode of the same size reports reset', () => {
  const file = fresh()
  appendRecords(file, [head, ev(1)])
  const reader = createTargetReader(file)
  assert.equal(reader.read().items.length, 2)
  const other = `${file}.new`
  appendRecords(other, [head, ev(1)])
  renameSync(other, file)
  const after = reader.read()
  assert.equal(after.reset, true)
  assert.equal(after.items.length, 2)
})

test('lock: held by a live pid, replaced when the pid is dead, gone once released', () => {
  const dir = join(root, 'lock')
  const lock = join(dir, 'observer.lock')
  assert.equal(acquireLock(dir), true)
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid))
  assert.equal(acquireLock(dir), false)
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid))

  releaseLock(dir)
  assert.equal(existsSync(lock), false)

  const dead = spawnSync(process.execPath, ['-e', '']).pid
  writeFileSync(lock, String(dead))
  assert.equal(acquireLock(dir), true)
  assert.equal(readFileSync(lock, 'utf8'), String(process.pid))
  assert.deepEqual(readdirSync(dir), ['observer.lock'])
  releaseLock(dir)
})

test('lock: release leaves a lock that another pid holds', () => {
  const dir = join(root, 'lock-other')
  const lock = join(dir, 'observer.lock')
  mkdirSync(dir)
  writeFileSync(lock, String(process.ppid))
  releaseLock(dir)
  assert.equal(readFileSync(lock, 'utf8'), String(process.ppid))
})
