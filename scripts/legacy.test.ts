#!/usr/bin/env node
// legacy.test.ts — `wal legacy` against a fake HOME: migrate splits by session, keeps what has no
// transcript, reruns as a no-op; delete needs a literal yes. Never touches the real ~/.claude.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { createDiscovery } from './discovery.ts'
import { runLegacy } from './legacy.ts'

const dir = mkdtempSync(join(tmpdir(), 'wallegacy.'))
process.env.HOME = dir
const projects = join(dir, '.claude', 'projects', '-repo')
const repo = join(dir, 'repo')
const legacyPath = join(repo, '.ai', 'logs', 'wal.jsonl')

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const GONE = 'cccccccc-0000-4000-8000-000000000003'

const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const rec = (id: string, n: number): string => JSON.stringify({ ts: `2026-09-30T08:00:0${n}.000Z`, event: 'Stop', session_id: id, cwd: repo })
const transcript = (id: string): string =>
  `${JSON.stringify({
    type: 'user',
    uuid: `u-${id}`,
    parentUuid: null,
    isSidechain: false,
    timestamp: '2026-09-30T08:00:00.000Z',
    cwd: repo,
    sessionId: id,
    message: { role: 'user', content: 'hi' },
  })}\n`

const LINES = [rec(A, 2), rec(B, 1), rec(GONE, 3), 'not json', rec(A, 1)]
const reset = (lines = LINES): void => {
  rmSync(join(projects, `${A}.wal.jsonl`), { force: true })
  rmSync(join(projects, `${B}.wal.jsonl`), { force: true })
  put(legacyPath, lines.map((l) => `${l}\n`).join(''))
}
put(join(projects, `${A}.jsonl`), transcript(A))
put(join(projects, `${B}.jsonl`), transcript(B))

const run = async (answers: string[]): Promise<string> => {
  const out: string[] = []
  const queue = [...answers]
  await runLegacy(
    createDiscovery([]),
    async (q) => {
      out.push(q)
      return queue.shift() ?? ''
    },
    (s) => out.push(s),
  )
  return out.join('\n')
}
const read = (p: string): string => readFileSync(p, 'utf8')
const target = (id: string): string => join(projects, `${id}.wal.jsonl`)

after(() => rmSync(dir, { recursive: true, force: true }))

test('migrate splits by session and keeps unmatched and unparseable lines', async () => {
  reset()
  const shown = await run(['m'])
  assert.match(shown, /wal\.jsonl {2}\d+ bytes {2}3 sessions/)
  assert.equal(read(target(A)), `${rec(A, 2)}\n${rec(A, 1)}\n`)
  assert.equal(read(target(B)), `${rec(B, 1)}\n`)
  assert.equal(read(legacyPath), `${rec(GONE, 3)}\nnot json\n`)
})

test('migrate rerun is a no-op', async () => {
  const before = [read(legacyPath), read(target(A)), read(target(B))]
  await run(['m'])
  assert.deepEqual([read(legacyPath), read(target(A)), read(target(B))], before)
})

test('migrate appends only lines absent from the target', async () => {
  reset()
  writeFileSync(target(A), `${rec(A, 1)}\n`)
  await run(['m'])
  assert.equal(read(target(A)), `${rec(A, 1)}\n${rec(A, 2)}\n`)
})

test('a fully matched legacy file is removed after migrate', async () => {
  reset([rec(A, 1), rec(B, 2)])
  await run(['m'])
  assert.equal(existsSync(legacyPath), false)
  assert.equal(read(target(B)), `${rec(B, 2)}\n`)
})

test('delete keeps the file unless the answer is yes', async () => {
  reset()
  await run(['d', 'no'])
  assert.equal(existsSync(legacyPath), true)
  await run(['d', ''])
  assert.equal(existsSync(legacyPath), true)
  await run(['d', 'yes'])
  assert.equal(existsSync(legacyPath), false)
})

test('skip and an empty answer touch nothing', async () => {
  reset()
  await run(['s'])
  await run([''])
  assert.equal(read(legacyPath), LINES.map((l) => `${l}\n`).join(''))
  assert.equal(existsSync(target(A)), false)
})

test('a line appended to the legacy file mid-migrate survives', async () => {
  reset()
  const hook = rec(GONE, 4)
  const out: string[] = []
  const queue = ['m']
  await runLegacy(
    createDiscovery([]),
    async () => queue.shift() ?? '',
    (s) => {
      out.push(s)
      if (s.startsWith('snapshot ')) appendFileSync(legacyPath, `${hook}\n`)
    },
  )
  assert.equal(read(legacyPath), `${hook}\n${rec(GONE, 3)}\nnot json\n`)
  assert.deepEqual(readdirSync(dirname(legacyPath)), ['wal.jsonl'])
})

test('a leftover snapshot is finished on the next run, even with no live log', async () => {
  reset()
  rmSync(legacyPath)
  put(`${legacyPath}.snap-1-1`, [rec(B, 1), rec(GONE, 3)].map((l) => `${l}\n`).join(''))
  await run(['m'])
  assert.equal(read(target(B)), `${rec(B, 1)}\n`)
  assert.equal(read(legacyPath), `${rec(GONE, 3)}\n`)
  assert.deepEqual(readdirSync(dirname(legacyPath)), ['wal.jsonl'])
})

test('a partial last line in the target is not glued to the append', async () => {
  reset([rec(A, 1)])
  writeFileSync(target(A), rec(B, 9).slice(0, 20))
  await run(['m'])
  assert.equal(read(target(A)), `${rec(B, 9).slice(0, 20)}\n${rec(A, 1)}\n`)
})

test('a large migrate is appended whole line by whole line', async () => {
  const pad = 'x'.repeat(10_000)
  const big = Array.from({ length: 40 }, (_, i) => JSON.stringify({ event: 'Stop', session_id: A, n: i, pad }))
  reset(big)
  await run(['m'])
  assert.equal(read(target(A)), big.map((l) => `${l}\n`).join(''))
})

test('the migrated count only counts lines actually written', async () => {
  reset([rec(A, 1), rec(A, 2)])
  writeFileSync(target(A), `${rec(A, 1)}\n`)
  assert.match(await run(['m']), /migrated 1 lines/)
})

test('a symlinked cwd does not list the same log twice, and a vanished log is skipped', async () => {
  reset()
  const link = join(dir, 'repo-link')
  symlinkSync(repo, link)
  const t = join(projects, 'dddddddd-0000-4000-8000-000000000004.jsonl')
  put(t, transcript(B).replace(JSON.stringify(repo).slice(1, -1), link))
  const files = createDiscovery([]).legacyFiles()
  assert.equal(files.length, 1)
  rmSync(legacyPath)
  assert.match(await run(['m']), /no legacy WAL files/)
  rmSync(t)
  rmSync(link)
})
