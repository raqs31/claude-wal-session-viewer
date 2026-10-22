import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionSeries, StatRow } from '../../../shared/api.ts'
import { compactMarks, contextPerCall, overTime, perCall, perTurn, shares, stack, turnMarkers } from './series.ts'

const cols = (input: number[], output: number[], cacheRead: number[], w5: number[], w1: number[]) => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: w5,
  cacheWrite1h: w1,
})

const S: SessionSeries = {
  t: [1000, 2000, 3000],
  cumulative: cols([1, 3, 4], [10, 20, 30], [100, 100, 300], [0, 5, 5], [0, 0, 2]),
  perTurn: cols([0, 3, 1], [0, 20, 10], [0, 100, 200], [0, 5, 0], [0, 0, 2]),
  turnStarts: [1500, 2500],
  compacts: [{ t: 2500, trigger: 'auto', pre: 167_000, post: 12_000 }],
}

test('stack is a running sum of layers', () => {
  assert.deepEqual(
    stack([
      [1, 2],
      [10, 20],
      [100, 200],
    ]),
    [
      [1, 2],
      [11, 22],
      [111, 222],
    ],
  )
  assert.deepEqual(stack([]), [])
})

test('over time: x is t, layers stack input/output/cache read/cache write (5m + 1h)', () => {
  const [x, ...ys] = overTime(S)
  assert.deepEqual(x, [1000, 2000, 3000])
  assert.deepEqual(ys, [
    [1, 3, 4],
    [11, 23, 34],
    [111, 123, 334],
    [111, 128, 341],
  ])
})

test('the top of the stack equals the additive total, thinking not added again', () => {
  const top = overTime(S).at(-1)?.at(-1)
  assert.equal(top, 4 + 30 + 300 + 5 + 2)
})

test('per turn: one bar per turn, turn 0 included', () => {
  const [x, ...ys] = perTurn(S)
  assert.deepEqual(x, [0, 1, 2])
  assert.deepEqual(ys, [
    [0, 3, 1],
    [0, 23, 11],
    [0, 123, 211],
    [0, 128, 213],
  ])
})

test('agent scope: only the turns it spent tokens in, x keeps the real turn number', () => {
  // Spent in turn 2 only (cache write alone in turn 3 still counts as work).
  const a: SessionSeries = {
    t: [2100, 2200],
    cumulative: cols([1, 2], [5, 9], [0, 0], [0, 0], [0, 4]),
    perTurn: cols([0, 0, 2, 0, 0], [0, 0, 9, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 4, 0]),
    turnStarts: [1000, 2000, 3000, 4000],
    compacts: [],
  }
  const [x, ...ys] = perTurn(a, true)
  assert.deepEqual(x, [2, 3])
  assert.deepEqual(ys, [
    [2, 0],
    [11, 0],
    [11, 0],
    [11, 4],
  ])
  assert.deepEqual(turnMarkers(a, true), [2000, 3000])
  // Whole and main scopes keep every turn and every marker.
  assert.deepEqual(perTurn(a)[0], [0, 1, 2, 3, 4])
  assert.deepEqual(turnMarkers(a), [1000, 2000, 3000, 4000])
})

test('empty series gives empty columns', () => {
  const e: SessionSeries = { t: [], cumulative: cols([], [], [], [], []), perTurn: cols([0], [0], [0], [0], [0]), turnStarts: [], compacts: [] }
  assert.deepEqual(overTime(e), [[], [], [], [], []])
  assert.deepEqual(perTurn(e), [[0], [0], [0], [0], [0]])
})

const row = (input: number, output: number): StatRow => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  thinking: output,
  requests: 1,
  cost: null,
})

test('shares: by total tokens, largest first, zero rows dropped, sums to 100', () => {
  const s = shares({ main: row(10, 20), a: row(60, 10), idle: row(0, 0) })
  assert.deepEqual(
    s.map((x) => [x.key, x.tokens]),
    [
      ['a', 70],
      ['main', 30],
    ],
  )
  assert.deepEqual(
    s.map((x) => x.pct),
    [70, 30],
  )
  assert.deepEqual(shares({}), [])
})

test("per call: x counts calls from 1, layers are each call's own usage", () => {
  assert.deepEqual(perCall(S), [
    [1, 2, 3],
    [1, 2, 1],
    [11, 12, 11],
    [111, 12, 211],
    [111, 17, 213],
  ])
  const empty: SessionSeries = { ...S, t: [], cumulative: cols([], [], [], [], []), turnStarts: [], compacts: [] }
  assert.deepEqual(perCall(empty), [[], [], [], [], []])
})

test('a compaction marks its time, or the gap before the first call after it', () => {
  assert.deepEqual(compactMarks(S, 'time'), [{ x: 2500, label: 'auto 167k → 12k' }])
  assert.deepEqual(compactMarks(S, 'call'), [{ x: 1.5, label: 'auto 167k → 12k' }])
})

test('context per call: a smaller third call (a compaction) drops, output is excluded', () => {
  const dip: SessionSeries = {
    ...S,
    cumulative: cols([1, 2, 3], [10, 20, 30], [100, 190, 200], [0, 0, 4], [0, 0, 1]),
  }
  assert.deepEqual(contextPerCall(dip), [
    [1000, 2000, 3000],
    [101, 91, 16],
  ])
})

test('context per call: an empty series gives empty columns', () => {
  const empty: SessionSeries = { ...S, t: [], cumulative: cols([], [], [], [], []), perTurn: cols([], [], [], [], []), turnStarts: [], compacts: [] }
  assert.deepEqual(contextPerCall(empty), [[], []])
})
