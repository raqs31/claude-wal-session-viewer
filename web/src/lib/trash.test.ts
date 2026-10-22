import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionMeta, TrashResult } from '../../../shared/api.ts'
import { splitBusy, summarizeResults } from './trash.ts'

const row = (id: string, o: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  project: { slug: 'p', cwd: '/w/p' },
  worktree: null,
  source: 'default',
  workspaces: ['default'],
  title: `title ${id}`,
  prompt: null,
  started: null,
  last: 0,
  live: false,
  busy: false,
  walSize: 0,
  walLines: 0,
  transcriptSize: 0,
  ...o,
})
const res = (status: TrashResult['status'], n: number): TrashResult[] => Array.from({ length: n }, (_, i) => ({ id: `${status}${i}`, status }))

test('split puts non-busy sessions in movable', () => {
  const { movable } = splitBusy([row('a'), row('b', { busy: true }), row('c')])
  assert.deepEqual(
    movable.map((s) => s.id),
    ['a', 'c'],
  )
})

test('split skips a live session as live', () => {
  const { skipped } = splitBusy([row('a', { live: true, busy: true })])
  assert.deepEqual(
    skipped.map((s) => [s.session.id, s.why]),
    [['a', 'live']],
  )
})

test('split skips a busy session that is not live as not ended', () => {
  const { skipped } = splitBusy([row('a', { busy: true })])
  assert.deepEqual(
    skipped.map((s) => [s.session.id, s.why]),
    [['a', 'not ended']],
  )
})

test('summary of mixed results has one segment per non-zero status in a fixed order', () => {
  const mixed = [...res('conflict', 1), ...res('ok', 3), ...res('live', 1)]
  assert.equal(summarizeResults(mixed), '3 moved · 1 live skipped · 1 conflict')
})

test('summary labels unknown as not found and failed as failed', () => {
  assert.equal(summarizeResults([...res('failed', 2), ...res('unknown', 1)]), '1 not found · 2 failed')
})

test('summary of no results reads 0 moved', () => {
  assert.equal(summarizeResults([]), '0 moved')
})

test('summary uses a custom label for ok', () => {
  assert.equal(summarizeResults([...res('ok', 2), ...res('conflict', 1)], 'restored'), '2 restored · 1 conflict')
})

test('summary of no results with a label reads 0 and the label', () => {
  assert.equal(summarizeResults([], 'deleted'), '0 deleted')
})
