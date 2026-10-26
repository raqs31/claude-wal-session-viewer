#!/usr/bin/env node

// session-view.test.ts — golden test: for every fixture session, the view built from the target the
// observer writes deep-equals GOLDEN, the old store's view for scopes `all`, `main` and each agent, and the
// usage totals match. GOLDEN was frozen once from the old parser store at commit d8689e0, without `gen` and
// `version`. The fixtures are copied to a temp HOME as they are, with no WAL. No server.

import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import type { Scope, SessionView, UsageTotals } from '../shared/api.ts'
import { createDiscovery } from './discovery.ts'
import { createObserver, targetFile } from './observer.ts'
import { absorb, createSessionData, type SessionData, usage, view } from './session-view.ts'
import { createStore } from './sessions.ts'
import { createTargetReader, targetPath } from './target.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'projects')
const home = mkdtempSync(join(tmpdir(), 'walview.'))
after(() => rmSync(home, { recursive: true, force: true }))
const projects = join(home, '.claude', 'projects')
cpSync(FIXTURES, projects, { recursive: true })
process.env.HOME = home

const ids = readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' })
  .map((p) => /^[^/]+\/([0-9a-f-]{36})\.jsonl$/.exec(p)?.[1])
  .filter((id): id is string => id !== undefined)
  .sort()

const discovery = createDiscovery([])
const observer = createObserver({ discovery, write: true })
const store = createStore({ target: (id) => targetFile(discovery, id), observer }, () => false)
const source = discovery.sources()[0]

interface Golden {
  sessions: Record<string, { views: Record<string, Omit<SessionView, 'gen' | 'version'>>; usage: UsageTotals }>
  usageAll: UsageTotals
}

const GOLDEN: Golden = {
  sessions: {
    '149b4f57-914a-4248-b3b7-5f6f35ab44d1': {
      views: {
        all: {
          id: '149b4f57-914a-4248-b3b7-5f6f35ab44d1',
          scope: 'all',
          stats: {
            totals: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 },
            agents: {},
            models: {},
            turns: 0,
            duration: 0,
          },
          series: {
            t: [],
            cumulative: { input: [], output: [], cacheRead: [], cacheWrite5m: [], cacheWrite1h: [] },
            perTurn: { input: [0], output: [0], cacheRead: [0], cacheWrite5m: [0], cacheWrite1h: [0] },
            turnStarts: [],
            compacts: [],
          },
          agents: [],
          agentStats: { main: { tools: 0, duration: 0, context: 0, compacts: [] } },
          recordedCostUsd: { total: 0, models: {} },
        },
        main: {
          id: '149b4f57-914a-4248-b3b7-5f6f35ab44d1',
          scope: 'main',
          stats: {
            totals: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 },
            agents: {},
            models: {},
            turns: 0,
            duration: 0,
          },
          series: {
            t: [],
            cumulative: { input: [], output: [], cacheRead: [], cacheWrite5m: [], cacheWrite1h: [] },
            perTurn: { input: [0], output: [0], cacheRead: [0], cacheWrite5m: [0], cacheWrite1h: [0] },
            turnStarts: [],
            compacts: [],
          },
          agents: [],
          agentStats: { main: { tools: 0, duration: 0, context: 0, compacts: [] } },
          recordedCostUsd: null,
        },
      },
      usage: {
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 },
        recorded: 0,
        missing: 0,
        unknown: [],
      },
    },
    '301167f7-f843-4c79-965b-ae99c2d50f5e': {
      views: {
        all: {
          id: '301167f7-f843-4c79-965b-ae99c2d50f5e',
          scope: 'all',
          stats: {
            totals: { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 },
            agents: { main: { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 } },
            models: {
              'claude-sonnet-5': { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 },
            },
            turns: 1,
            duration: 0,
          },
          series: {
            t: [1790585801252],
            cumulative: { input: [2], output: [409], cacheRead: [0], cacheWrite5m: [0], cacheWrite1h: [42429] },
            perTurn: { input: [0, 2], output: [0, 409], cacheRead: [0, 0], cacheWrite5m: [0, 0], cacheWrite1h: [0, 42429] },
            turnStarts: [1790585797737],
            compacts: [],
          },
          agents: [],
          agentStats: { main: { tools: 1, duration: 0, context: 42431, compacts: [] } },
          recordedCostUsd: { total: 0.175004, models: { 'claude-haiku-4-5-20251001': 0.001194, 'claude-sonnet-5': 0.17381 } },
        },
        main: {
          id: '301167f7-f843-4c79-965b-ae99c2d50f5e',
          scope: 'main',
          stats: {
            totals: { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 },
            agents: { main: { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 } },
            models: {
              'claude-sonnet-5': { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 },
            },
            turns: 1,
            duration: 0,
          },
          series: {
            t: [1790585801252],
            cumulative: { input: [2], output: [409], cacheRead: [0], cacheWrite5m: [0], cacheWrite1h: [42429] },
            perTurn: { input: [0, 2], output: [0, 409], cacheRead: [0, 0], cacheWrite5m: [0, 0], cacheWrite1h: [0, 42429] },
            turnStarts: [1790585797737],
            compacts: [],
          },
          agents: [],
          agentStats: { main: { tools: 1, duration: 0, context: 42431, compacts: [] } },
          recordedCostUsd: null,
        },
      },
      usage: {
        totals: { input: 2, output: 409, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 42429, thinking: 0, requests: 1, cost: 0.17381 },
        recorded: 0.175004,
        missing: 0,
        unknown: [],
      },
    },
    'c70f5199-e71d-4ffc-986e-125dbd885dc8': {
      views: {
        all: {
          id: 'c70f5199-e71d-4ffc-986e-125dbd885dc8',
          scope: 'all',
          stats: {
            totals: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 },
            agents: {},
            models: {},
            turns: 1,
            duration: 0,
          },
          series: {
            t: [],
            cumulative: { input: [], output: [], cacheRead: [], cacheWrite5m: [], cacheWrite1h: [] },
            perTurn: { input: [0, 0], output: [0, 0], cacheRead: [0, 0], cacheWrite5m: [0, 0], cacheWrite1h: [0, 0] },
            turnStarts: [1790585797736],
            compacts: [],
          },
          agents: [],
          agentStats: { main: { tools: 0, duration: 0, context: 0, compacts: [] } },
          recordedCostUsd: { total: 0.001194, models: { 'claude-haiku-4-5-20251001': 0.001194 } },
        },
        main: {
          id: 'c70f5199-e71d-4ffc-986e-125dbd885dc8',
          scope: 'main',
          stats: {
            totals: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 },
            agents: {},
            models: {},
            turns: 1,
            duration: 0,
          },
          series: {
            t: [],
            cumulative: { input: [], output: [], cacheRead: [], cacheWrite5m: [], cacheWrite1h: [] },
            perTurn: { input: [0, 0], output: [0, 0], cacheRead: [0, 0], cacheWrite5m: [0, 0], cacheWrite1h: [0, 0] },
            turnStarts: [1790585797736],
            compacts: [],
          },
          agents: [],
          agentStats: { main: { tools: 0, duration: 0, context: 0, compacts: [] } },
          recordedCostUsd: null,
        },
      },
      usage: {
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, thinking: 0, requests: 0, cost: 0 },
        recorded: 0.001194,
        missing: 0,
        unknown: [],
      },
    },
    'd01c2dfc-0a01-4e1f-825a-5b0462780f18': {
      views: {
        all: {
          id: 'd01c2dfc-0a01-4e1f-825a-5b0462780f18',
          scope: 'all',
          stats: {
            totals: {
              input: 36,
              output: 6975,
              cacheRead: 873068,
              cacheWrite5m: 38843,
              cacheWrite1h: 29721,
              thinking: 340,
              requests: 15,
              cost: 0.6106931000000001,
            },
            agents: {
              main: { input: 16, output: 3135, cacheRead: 543178, cacheWrite5m: 0, cacheWrite1h: 29721, thinking: 189, requests: 6, cost: 0.40916759999999996 },
              a6c7ff04911c76bce: {
                input: 20,
                output: 3840,
                cacheRead: 329890,
                cacheWrite5m: 38843,
                cacheWrite1h: 0,
                thinking: 151,
                requests: 9,
                cost: 0.2015255,
              },
            },
            models: {
              'claude-opus-5-5': {
                input: 16,
                output: 3135,
                cacheRead: 543178,
                cacheWrite5m: 0,
                cacheWrite1h: 29721,
                thinking: 189,
                requests: 6,
                cost: 0.40916759999999996,
              },
              'claude-sonnet-5-5': {
                input: 20,
                output: 3840,
                cacheRead: 329890,
                cacheWrite5m: 38843,
                cacheWrite1h: 0,
                thinking: 151,
                requests: 9,
                cost: 0.2015255,
              },
            },
            turns: 3,
            duration: 6710812,
          },
          series: {
            t: [
              1790761933268, 1790762149181, 1790762157883, 1790766283491, 1790766297767, 1790766299821, 1790766306658, 1790766324362, 1790766340115,
              1790766349359, 1790766472059, 1790766479920, 1790766485199, 1790766486884, 1790768644080,
            ],
            cumulative: {
              input: [2, 4, 6, 10, 12, 14, 16, 18, 20, 22, 24, 26, 30, 34, 36],
              output: [203, 1106, 1147, 2768, 2987, 3823, 4325, 4605, 5008, 5188, 5332, 6492, 6763, 6879, 6975],
              cacheRead: [0, 71007, 142386, 269082, 275583, 304306, 343777, 384469, 425924, 468367, 511616, 555204, 686127, 729895, 873068],
              cacheWrite5m: [0, 0, 0, 0, 22222, 32970, 34191, 34954, 35942, 36748, 37087, 37267, 37267, 38843, 38843],
              cacheWrite1h: [23709, 24081, 25385, 27586, 27586, 27586, 27586, 27586, 27586, 27586, 27586, 27586, 29327, 29327, 29721],
            },
            perTurn: {
              input: [0, 6, 28, 2],
              output: [0, 1147, 5732, 96],
              cacheRead: [0, 142386, 587509, 143173],
              cacheWrite5m: [0, 0, 38843, 0],
              cacheWrite1h: [0, 25385, 3942, 394],
            },
            turnStarts: [1790761928517, 1790762965849, 1790768640442],
            compacts: [{ t: 1790768457254, trigger: 'manual', pre: 132939, post: 13294 }],
          },
          agents: [
            {
              id: 'a6c7ff04911c76bce',
              type: 'general-purpose',
              description: 'xxxxxxxxxxxxxxxxxxxxxxxxx',
              model: 'sonnet',
              prompt: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              parent: null,
            },
          ],
          agentStats: {
            main: { tools: 5, duration: 6710812, context: 143569, compacts: [{ t: 1790768457254, trigger: 'manual', pre: 132939, post: 13294 }] },
            a6c7ff04911c76bce: { tools: 8, duration: 189117, context: 45348, compacts: [] },
          },
          recordedCostUsd: {
            total: 20.143822999999998,
            models: { 'claude-opus-5-5': 18.21341079999999, 'claude-sonnet-5-5': 1.8625657, 'claude-haiku-4-5-20251001': 0.0678465 },
          },
        },
        main: {
          id: 'd01c2dfc-0a01-4e1f-825a-5b0462780f18',
          scope: 'main',
          stats: {
            totals: { input: 16, output: 3135, cacheRead: 543178, cacheWrite5m: 0, cacheWrite1h: 29721, thinking: 189, requests: 6, cost: 0.40916759999999996 },
            agents: {
              main: { input: 16, output: 3135, cacheRead: 543178, cacheWrite5m: 0, cacheWrite1h: 29721, thinking: 189, requests: 6, cost: 0.40916759999999996 },
            },
            models: {
              'claude-opus-5-5': {
                input: 16,
                output: 3135,
                cacheRead: 543178,
                cacheWrite5m: 0,
                cacheWrite1h: 29721,
                thinking: 189,
                requests: 6,
                cost: 0.40916759999999996,
              },
            },
            turns: 3,
            duration: 6710812,
          },
          series: {
            t: [1790761933268, 1790762149181, 1790762157883, 1790766283491, 1790766485199, 1790768644080],
            cumulative: {
              input: [2, 4, 6, 10, 14, 16],
              output: [203, 1106, 1147, 2768, 3039, 3135],
              cacheRead: [0, 71007, 142386, 269082, 400005, 543178],
              cacheWrite5m: [0, 0, 0, 0, 0, 0],
              cacheWrite1h: [23709, 24081, 25385, 27586, 29327, 29721],
            },
            perTurn: {
              input: [0, 6, 8, 2],
              output: [0, 1147, 1892, 96],
              cacheRead: [0, 142386, 257619, 143173],
              cacheWrite5m: [0, 0, 0, 0],
              cacheWrite1h: [0, 25385, 3942, 394],
            },
            turnStarts: [1790761928517, 1790762965849, 1790768640442],
            compacts: [{ t: 1790768457254, trigger: 'manual', pre: 132939, post: 13294 }],
          },
          agents: [
            {
              id: 'a6c7ff04911c76bce',
              type: 'general-purpose',
              description: 'xxxxxxxxxxxxxxxxxxxxxxxxx',
              model: 'sonnet',
              prompt: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              parent: null,
            },
          ],
          agentStats: { main: { tools: 5, duration: 6710812, context: 143569, compacts: [{ t: 1790768457254, trigger: 'manual', pre: 132939, post: 13294 }] } },
          recordedCostUsd: null,
        },
        'agent:a6c7ff04911c76bce': {
          id: 'd01c2dfc-0a01-4e1f-825a-5b0462780f18',
          scope: 'agent:a6c7ff04911c76bce',
          stats: {
            totals: { input: 20, output: 3840, cacheRead: 329890, cacheWrite5m: 38843, cacheWrite1h: 0, thinking: 151, requests: 9, cost: 0.2015255 },
            agents: {
              a6c7ff04911c76bce: {
                input: 20,
                output: 3840,
                cacheRead: 329890,
                cacheWrite5m: 38843,
                cacheWrite1h: 0,
                thinking: 151,
                requests: 9,
                cost: 0.2015255,
              },
            },
            models: {
              'claude-sonnet-5-5': {
                input: 20,
                output: 3840,
                cacheRead: 329890,
                cacheWrite5m: 38843,
                cacheWrite1h: 0,
                thinking: 151,
                requests: 9,
                cost: 0.2015255,
              },
            },
            turns: 1,
            duration: 189117,
          },
          series: {
            t: [1790766297767, 1790766299821, 1790766306658, 1790766324362, 1790766340115, 1790766349359, 1790766472059, 1790766479920, 1790766486884],
            cumulative: {
              input: [2, 4, 6, 8, 10, 12, 14, 16, 20],
              output: [219, 1055, 1557, 1837, 2240, 2420, 2564, 3724, 3840],
              cacheRead: [6501, 35224, 74695, 115387, 156842, 199285, 242534, 286122, 329890],
              cacheWrite5m: [22222, 32970, 34191, 34954, 35942, 36748, 37087, 37267, 38843],
              cacheWrite1h: [0, 0, 0, 0, 0, 0, 0, 0, 0],
            },
            perTurn: {
              input: [0, 0, 20, 0],
              output: [0, 0, 3840, 0],
              cacheRead: [0, 0, 329890, 0],
              cacheWrite5m: [0, 0, 38843, 0],
              cacheWrite1h: [0, 0, 0, 0],
            },
            turnStarts: [1790761928517, 1790762965849, 1790768640442],
            compacts: [],
          },
          agents: [
            {
              id: 'a6c7ff04911c76bce',
              type: 'general-purpose',
              description: 'xxxxxxxxxxxxxxxxxxxxxxxxx',
              model: 'sonnet',
              prompt: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              parent: null,
            },
          ],
          agentStats: { a6c7ff04911c76bce: { tools: 8, duration: 189117, context: 45348, compacts: [] } },
          recordedCostUsd: null,
        },
      },
      usage: {
        totals: { input: 36, output: 6975, cacheRead: 873068, cacheWrite5m: 38843, cacheWrite1h: 29721, thinking: 340, requests: 15, cost: 0.6106931000000001 },
        recorded: 20.143822999999998,
        missing: 0,
        unknown: [],
      },
    },
  },
  usageAll: {
    totals: { input: 38, output: 7384, cacheRead: 873068, cacheWrite5m: 38843, cacheWrite1h: 72150, thinking: 340, requests: 16, cost: 0.7845031000000001 },
    recorded: 20.320020999999997,
    missing: 0,
    unknown: ['x'],
  },
}

const fromTarget = (id: string): SessionData => {
  assert.equal(observer.sync(id, 1000).stale, null)
  assert.ok(source)
  const d = createSessionData()
  absorb(
    d,
    createTargetReader(targetPath(source, id))
      .read()
      .items.map((i) => i.rec),
  )
  return d
}

test('the fixtures hold four sessions and a subagent', () => {
  assert.equal(ids.length, 4)
  assert.ok(ids.some((id) => Object.keys(GOLDEN.sessions[id]?.views ?? {}).some((scope) => scope.startsWith('agent:'))))
})

for (const id of ids) {
  test(`${id}: the target view equals the frozen store view for every scope`, () => {
    const golden = GOLDEN.sessions[id]
    assert.ok(golden)
    const d = fromTarget(id)
    const head = { id, gen: 0, version: 0 }
    for (const [scope, want] of Object.entries(golden.views)) assert.deepEqual(view(d, head, scope as Scope), { ...want, gen: 0, version: 0 }, scope)
    assert.deepEqual(usage([d], []), golden.usage)
  })

  test(`${id}: the store view equals the view built from the target`, () => {
    const d = fromTarget(id)
    const s = store.get(id)
    assert.ok(s)
    assert.deepEqual(store.view(s, 'all'), { ...view(d, { id, gen: s.gen, version: s.version }, 'all'), pipe: observer.state(id) })
  })
}

test('usage over the whole pick matches the frozen store usage', () => {
  assert.deepEqual(
    usage(
      ids.map((id) => fromTarget(id)),
      ['x'],
    ),
    GOLDEN.usageAll,
  )
})

test('a cost record followed by one with usd null gives a null cost', () => {
  const d = createSessionData()
  absorb(d, [
    { k: 'cost', usd: 2, byModel: { 'claude-x': 2 } },
    { k: 'cost', usd: null, byModel: {} },
  ])
  assert.equal(view(d, { id: 'x', gen: 1, version: 1 }, 'all')?.recordedCostUsd, null)
  const u = usage([d], [])
  assert.equal(u.recorded, null)
  assert.equal(u.missing, 1)
})
