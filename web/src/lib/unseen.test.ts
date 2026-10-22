import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionMeta } from '../../../shared/api.ts'
import { advance, isBaselines, unseen } from './unseen.ts'

const row = (id: string, walLines: number, transcriptSize = 100): SessionMeta => ({
  id,
  project: { slug: 'p', cwd: null },
  worktree: null,
  source: 'default',
  workspaces: ['default'],
  title: id,
  prompt: null,
  started: null,
  last: 0,
  live: false,
  busy: false,
  walSize: walLines * 10,
  walLines,
  transcriptSize,
})

test('first sight sets the baseline, so nothing shows as unseen', () => {
  const b = advance({}, [], [row('a', 50), row('b', 7)])
  assert.deepEqual(b, { a: { walLines: 50, transcriptSize: 100 }, b: { walLines: 7, transcriptSize: 100 } })
  assert.equal(unseen(row('a', 50), b.a), 0)
})

test('+N is the walLines delta over the baseline; a shrink shows 0; no baseline shows 0', () => {
  const base = { walLines: 10, transcriptSize: 100 }
  assert.equal(unseen(row('a', 14), base), 4)
  assert.equal(unseen(row('a', 3), base), 0)
  assert.equal(unseen(row('a', 14), undefined), 0)
})

test('only viewed ids advance; the others keep counting', () => {
  const b0 = advance({}, [], [row('a', 1), row('b', 1)])
  const b1 = advance(b0, ['a'], [row('a', 5), row('b', 5)])
  assert.equal(unseen(row('a', 5), b1.a), 0)
  assert.equal(unseen(row('b', 5), b1.b), 4)
  assert.equal(b1.b, b0.b)
})

test('a transcript-only change moves a viewed baseline', () => {
  const b0 = advance({}, [], [row('a', 1, 100)])
  const b1 = advance(b0, ['a'], [row('a', 1, 200)])
  assert.notEqual(b1, b0)
  assert.equal(b1.a?.transcriptSize, 200)
})

test('nothing moved returns the same object; an unlisted session is pruned', () => {
  const b0 = advance({}, [], [row('a', 1), row('b', 1)])
  assert.equal(advance(b0, ['a'], [row('a', 1), row('b', 2)]), b0)
  assert.deepEqual(Object.keys(advance(b0, [], [row('a', 1)])), ['a'])
})

test('stored baselines are validated', () => {
  assert.equal(isBaselines({ a: { walLines: 1, transcriptSize: 2 } }), true)
  assert.equal(isBaselines({}), true)
  assert.equal(isBaselines({ a: { walLines: '1', transcriptSize: 2 } }), false)
  assert.equal(isBaselines({ a: null }), false)
  assert.equal(isBaselines([]), false)
  assert.equal(isBaselines(null), false)
})
