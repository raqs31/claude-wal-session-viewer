import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { StatRow, UsageTotals } from '../../../shared/api.ts'
import { usageTiles } from './usage.ts'

const totals: StatRow = { input: 1200, output: 3400, cacheRead: 2_000_000, cacheWrite5m: 500, cacheWrite1h: 1500, thinking: 100, requests: 7, cost: 1.5 }
const of = (u: UsageTotals | null) => Object.fromEntries(usageTiles(u).map((t) => [t.key, t]))

test('no usage renders every tile as a dash', () => {
  assert.deepEqual(
    usageTiles(null).map((t) => t.value),
    ['—', '—', '—', '—', '—', '—'],
  )
})

test('cache write sums 5m and 1h; tokens are compact', () => {
  const t = of({ totals, recorded: 2, missing: 0, unknown: [] })
  assert.equal(t.input?.value, '1.2k')
  assert.equal(t.cacheRead?.value, '2M')
  assert.equal(t.cacheWrite?.value, '2k')
  assert.equal(t.estimated?.value, '$1.50')
  assert.equal(t.recorded?.value, '$2.00')
  assert.equal(t.recorded?.title, undefined)
})

test('recorded cost is a dash when no session recorded one, with the missing count as tooltip', () => {
  const t = of({ totals: { ...totals, cost: null }, recorded: null, missing: 2, unknown: [] })
  assert.equal(t.recorded?.value, '—')
  assert.equal(t.recorded?.title, '2 sessions without recorded cost')
  assert.equal(t.estimated?.value, '—')
})

test('a partial recorded sum names the one missing session', () => {
  assert.equal(of({ totals, recorded: 1, missing: 1, unknown: [] }).recorded?.title, '1 session without recorded cost')
})
