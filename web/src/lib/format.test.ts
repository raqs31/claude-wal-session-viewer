import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fmtAgo } from './format.ts'

test('fmtAgo picks the coarsest whole unit', () => {
  const now = 10 * 86_400_000
  assert.equal(fmtAgo(now - 59_999, now), 'now')
  assert.equal(fmtAgo(now + 5000, now), 'now')
  assert.equal(fmtAgo(now - 60_000, now), '1m')
  assert.equal(fmtAgo(now - 59 * 60_000, now), '59m')
  assert.equal(fmtAgo(now - 60 * 60_000, now), '1h')
  assert.equal(fmtAgo(now - 24 * 3_600_000, now), '1d')
})
