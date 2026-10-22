import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionMeta } from '../../../shared/api.ts'
import { effective, newest, prune, revive, storedPick, toggle } from './pick.ts'

const row = (id: string, last: number): SessionMeta => ({
  id,
  project: { slug: 'p', cwd: null },
  worktree: null,
  source: 'default',
  workspaces: ['default'],
  title: id,
  prompt: null,
  started: null,
  last,
  live: false,
  busy: false,
  walSize: 0,
  walLines: 0,
  transcriptSize: 0,
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

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'

test('storedPick accepts an array of session ids', () => {
  assert.deepEqual(storedPick([A, B]), [A, B])
})

test('storedPick rejects a non-array', () => {
  assert.equal(storedPick({ 0: A }), null)
})

test('storedPick rejects a non-string member', () => {
  assert.equal(storedPick([A, 7]), null)
})

test('storedPick dedupes', () => {
  assert.deepEqual(storedPick([A, B, A]), [A, B])
})

test('effective of a null wanted pick is the newest session', () => {
  assert.deepEqual(effective(null, rows, [], null), ['b'])
})

test('regression: with nothing stored the fallback stays frozen when another session is newer', () => {
  assert.deepEqual(effective(null, rows, [], 'c'), ['c'])
})

test('effective of a null wanted pick skips gone ids', () => {
  assert.deepEqual(effective(null, rows, ['b'], null), ['c'])
})

test('effective of a null wanted pick with no sessions is empty', () => {
  assert.deepEqual(effective(null, [], [], null), [])
})

test('effective of an empty wanted pick is all sessions', () => {
  assert.deepEqual(effective([], rows, [], 'c'), [])
})

test('effective keeps the listed ids of a partially pruned pick', () => {
  assert.deepEqual(effective(['c', 'x', 'a'], rows, ['a'], null), ['c'])
})

test('regression: a wanted pick pruned to empty shows the fallback, not all sessions', () => {
  assert.deepEqual(effective(['x'], rows, [], null), ['b'])
})

test('the fallback stays frozen while last moves', () => {
  assert.deepEqual(effective(['x'], [row('a', 99), row('b', 30), row('c', 20)], [], 'b'), ['b'])
})

test('regression: unpicking the last shown session with a dead id wanted gives all sessions', () => {
  assert.deepEqual(toggle(effective(['a', 'x'], rows, [], null), 'a'), [])
})

test('an adopted id not yet listed shows once it is listed', () => {
  assert.deepEqual(effective(['a', 'd'], [...rows, row('d', 5)], [], null), ['a', 'd'])
})

test('revive drops a gone id listed by a list requested after its stamp', () => {
  assert.deepEqual([...revive(new Map([['a', 100]]), rows, 101).keys()], [])
})

test('revive keeps a gone id when the list was requested before or at its stamp', () => {
  assert.deepEqual([...revive(new Map([['a', 100]]), rows, 99).keys()], ['a'])
  assert.deepEqual([...revive(new Map([['a', 100]]), rows, 100).keys()], ['a'])
})

test('revive keeps a gone id the list does not hold', () => {
  assert.deepEqual([...revive(new Map([['x', 100]]), rows, 101).keys()], ['x'])
})

test('revive leaves ids that are not gone alone', () => {
  const gone = new Map([['x', 100]])
  assert.equal(revive(gone, rows, 101), gone)
})

test('regression: a revived id shows alone, not all sessions', () => {
  const both = [row(A, 10), row(B, 20)]
  assert.deepEqual(effective([A], both, [], null), [A])
})
