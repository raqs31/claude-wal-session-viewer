import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fmtBytes, fmtDuration, fmtTokens, fmtUsd } from './tokens.ts'

test('tokens are compact with one decimal below 100 of a unit', () => {
  assert.deepEqual([0, 999, 1000, 1234, 12_345, 123_456, 1_234_567].map(fmtTokens), ['0', '999', '1k', '1.2k', '12.3k', '123k', '1.2M'])
})

test('a value that rounds up to the next unit switches unit', () => {
  assert.equal(fmtTokens(999_950), '1M')
  assert.equal(fmtTokens(99_960), '100k')
})

test('sizes use binary units', () => {
  assert.deepEqual([512, 1024, 734_003, 10_590_617].map(fmtBytes), ['512 B', '1 KB', '717 KB', '10.1 MB'])
})

test('USD: unknown is a dash, tiny is flagged, thousands are grouped', () => {
  assert.deepEqual([null, 0, 0.004, 0.43, 1234.5].map(fmtUsd), ['—', '$0.00', '<$0.01', '$0.43', '$1,234.50'])
})

test('durations scale from ms to hours', () => {
  assert.deepEqual([250, 12_340, 245_000, 7_380_000].map(fmtDuration), ['250 ms', '12.3 s', '4m 05s', '2h 03m'])
})

test('a duration that rounds up to the next unit switches unit', () => {
  assert.deepEqual([999.6, 59_960].map(fmtDuration), ['1 s', '1m 00s'])
})
