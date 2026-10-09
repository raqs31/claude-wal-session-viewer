import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionMeta } from '../../../shared/api.ts'
import { newest, prune, settlePick, toggle } from './pick.ts'

const row = (id: string, last: number): SessionMeta => ({
  id, project: { slug: 'p', cwd: null }, worktree: null, source: 'default', workspaces: ['default'], title: id, prompt: null,
  started: null, last, live: false, walSize: 0, walLines: 0, transcriptSize: 0,
})
const rows = [row('a', 10), row('b', 30), row('c', 20)]

test('prune keeps stored order and dedupes', () => {
  assert.deepEqual(prune(['c', 'x', 'a', 'c'], rows), ['c', 'a'])
})

test('regression: prune never re-picks the newest session when the pick empties', () => {
  assert.deepEqual(prune([], rows), [])
  assert.deepEqual(prune(['x', 'y'], rows), [])
  assert.deepEqual(prune(['a'], []), [])
})

test('regression: ids reported unknown are dropped, not replaced by the newest session', () => {
  assert.deepEqual(prune(['a', 'b'], rows, ['b']), ['a'])
  assert.deepEqual(prune(['b'], rows, ['b']), [])
})

test('newest returns the most recently active session', () => {
  assert.equal(newest(rows), 'b')
})

test('a tie on last goes to the session listed first', () => {
  assert.equal(newest([row('a', 5), row('b', 9), row('c', 9)]), 'b')
})

test('newest honours the skip set', () => {
  assert.equal(newest(rows, new Set(['b'])), 'c')
})

test('newest of no sessions is null', () => {
  assert.equal(newest([]), null)
})

test('toggle adds and removes other sessions', () => {
  assert.deepEqual(toggle(['a'], 'b'), ['a', 'b'])
  assert.deepEqual(toggle(['a', 'b'], 'a'), ['b'])
})

test('regression: deselecting the last session empties the pick', () => {
  assert.deepEqual(toggle(['a'], 'a'), [])
})

test('settlePick preselects the newest session only while the pick is null', () => {
  assert.deepEqual(settlePick(null, rows), ['b'])
  assert.deepEqual(settlePick(null, []), [])
})

test('regression: settlePick never refills an emptied pick', () => {
  assert.deepEqual(settlePick([], rows), [])
})

test('settlePick prunes ids that are no longer listed', () => {
  assert.deepEqual(settlePick(['a', 'x'], rows), ['a'])
})
