import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionView, StatRow } from '../../../shared/api.ts'
import { agentDetail } from './agentStats.ts'

const row = (o: Partial<StatRow>): StatRow => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0, ...o })

const view = {
  id: 's',
  gen: 0,
  version: 1,
  scope: 'all',
  stats: {
    totals: row({}),
    models: {},
    turns: 7,
    duration: 0,
    agents: { main: row({ input: 1234, requests: 9, cost: 0.5 }), a1: row({ output: 2_500_000, requests: 3, cost: null, cacheWrite1h: 10 }) },
  },
  series: { t: [], cumulative: {}, perTurn: {}, turnStarts: [] },
  agents: [
    { id: 'a1', type: 'Explore', description: 'find x', model: 'claude-haiku' },
    { id: 'a2', type: '', description: '', model: '' },
  ],
  agentStats: { main: { tools: 12, duration: 65_000 }, a1: { tools: 1234, duration: 900 }, a2: { tools: 0, duration: 0 } },
  recordedCostUsd: null,
} as unknown as SessionView

const asMap = (id: string) => Object.fromEntries(agentDetail(view, id).map((d) => [d.k, d.v]))

test('main shows turns, no model, its own tokens, cost, duration and tool calls', () => {
  const m = asMap('main')
  assert.equal(m.Type, 'main')
  assert.equal(m.Model, '—')
  assert.equal(m.Turns, '7')
  assert.equal(m.Requests, undefined)
  assert.equal(m.Input, '1.2k')
  assert.equal(m['Cost (estimated)'], '$0.50')
  assert.equal(m.Duration, '1m 05s')
  assert.equal(m['Tool calls'], '12')
})

test('main names the model only when the session used exactly one', () => {
  const withModels = (models: string[]) => ({ ...view, stats: { ...view.stats, models: Object.fromEntries(models.map((m) => [m, row({})])) } }) as SessionView
  const model = (v: SessionView) => agentDetail(v, 'main').find((d) => d.k === 'Model')!.v
  assert.equal(model(withModels(['claude-opus'])), 'claude-opus')
  assert.equal(model(withModels(['claude-opus', 'claude-haiku'])), 'mixed (see By model)')
  assert.equal(model(withModels([])), '—')
})

test('a subagent shows type, model, requests, an unpriced cost and its full token classes', () => {
  const d = agentDetail(view, 'a1')
  assert.deepEqual(
    d.map((x) => x.k),
    [
      'Type',
      'Model',
      'Requests',
      'Input',
      'Output',
      'Thinking (in output)',
      'Cache read',
      'Cache write 5m',
      'Cache write 1h',
      'Cost (estimated)',
      'Duration',
      'Tool calls',
    ],
  )
  const m = asMap('a1')
  assert.equal(m.Type, 'Explore')
  assert.equal(m.Model, 'claude-haiku')
  assert.equal(m.Requests, '3')
  assert.equal(m.Output, '2.5M')
  assert.equal(d.find((x) => x.k === 'Output')!.title, '2,500,000')
  assert.equal(m['Cost (estimated)'], '—')
  assert.equal(m['Tool calls'], '1,234')
})

test('an agent with no request yet reads as zero requests and dashes', () => {
  const m = asMap('a2')
  assert.equal(m.Type, '—')
  assert.equal(m.Model, '—')
  assert.equal(m.Requests, '0')
  assert.equal(m.Input, '—')
  assert.equal(m['Cost (estimated)'], '—')
  assert.equal(m.Duration, '0 ms')
})
