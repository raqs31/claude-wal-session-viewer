#!/usr/bin/env node

// session-view.test.ts — golden test: for every fixture session, the view built from the target the
// observer writes deep-equals the store's view for scopes `all`, `main` and each agent, and the usage
// totals match. The fixtures are copied to a temp HOME as they are, with no WAL. No server.

import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { Scope } from '../shared/api.ts'
import { createDiscovery } from './discovery.ts'
import { createObserver } from './observer.ts'
import { absorb, createSessionData, type SessionData, usage, view } from './session-view.ts'
import { createStore } from './sessions.ts'
import { createTargetReader, targetPath } from './target.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'projects')
const home = mkdtempSync(join(tmpdir(), 'walview.'))
after(() => rmSync(home, { recursive: true, force: true }))
const projects = join(home, '.claude', 'projects')
cpSync(FIXTURES, projects, { recursive: true })
process.env.HOME = home

const ids = readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
  .map((p) => /^[^/]+\/([0-9a-f-]{36})\.jsonl$/.exec(p)?.[1])
  .filter((id): id is string => id !== undefined)
  .sort()

const discovery = createDiscovery([])
const store = createStore(discovery, () => false)
const observer = createObserver({ discovery, write: true })
const source = discovery.sources()[0]

const fromTarget = (id: string): SessionData => {
  assert.equal(observer.sync(id, 1000).stale, null)
  assert.ok(source)
  const d = createSessionData()
  absorb(
    d,
    createTargetReader(targetPath(source, id))
      .read()
      .items.map((i) => i.rec),
  )
  return d
}

test('the fixtures hold four sessions and a subagent', () => {
  assert.equal(ids.length, 4)
  assert.ok(ids.some((id) => (store.get(id)?.agents.size ?? 0) > 0))
})

for (const id of ids) {
  test(`${id}: the target view equals the store view for every scope`, () => {
    const s = store.get(id)
    assert.ok(s)
    const d = fromTarget(id)
    const head = { id: s.id, gen: s.gen, version: s.version }
    const scopes: Scope[] = ['all', 'main', ...[...s.agents.keys()].map((a): Scope => `agent:${a}`)]
    for (const scope of scopes) assert.deepEqual(view(d, head, scope), store.view(s, scope), scope)
    assert.deepEqual(usage([d], []), store.usage([s], []))
  })
}

test('usage over the whole pick matches the store', () => {
  const ss = ids.map((id) => store.get(id))
  assert.ok(ss.every((s) => s !== null))
  assert.deepEqual(
    usage(
      ids.map((id) => fromTarget(id)),
      ['x'],
    ),
    store.usage(ss, ['x']),
  )
})

test('a cost record followed by one with usd null gives a null cost', () => {
  const d = createSessionData()
  absorb(d, [
    { k: 'cost', usd: 2, byModel: { 'claude-x': 2 } },
    { k: 'cost', usd: null, byModel: {} },
  ])
  assert.equal(view(d, { id: 'x', gen: 1, version: 1 }, 'all')?.recordedCostUsd, null)
  const u = usage([d], [])
  assert.equal(u.recorded, null)
  assert.equal(u.missing, 1)
})
