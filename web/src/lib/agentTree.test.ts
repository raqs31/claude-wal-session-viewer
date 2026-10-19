import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentRows } from './agentTree.ts'

const parents: Record<string, string | null> = { c: null, w1: 'c', w2: 'c', n: 'w1', g: null, o: 'gone' }
const of = (id: string) => parents[id] ?? null
const ids = ['main', 'c', 'w1', 'n', 'w2', 'g', 'o']

test('main leads, its spawns are roots and nested agents sit under their spawner', () => {
  assert.deepEqual(
    agentRows(ids, of, new Set()).map((r) => [r.id, r.depth, r.kids]),
    [
      ['main', 0, false],
      ['c', 0, true],
      ['w1', 1, true],
      ['n', 2, false],
      ['w2', 1, false],
      ['g', 0, false],
      ['o', 0, false],
    ],
  )
})

test('a collapsed agent hides its whole subtree', () => {
  assert.deepEqual(
    agentRows(ids, of, new Set(['c'])).map((r) => r.id),
    ['main', 'c', 'g', 'o'],
  )
})
