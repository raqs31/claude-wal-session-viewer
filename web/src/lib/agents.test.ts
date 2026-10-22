import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentNode, SessionAgents } from '../../../shared/api.ts'
import { agentSelection, buildTree, checks, countNodes, type PickNode, pruneAgents, searchTree, selectAll, toggle } from './agents.ts'

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const n = (id: string, type: string | null, summaries = 0, children: AgentNode[] = []): AgentNode => ({ id, type, summaries, children })
// A: main → p1 (Explore, 2 summaries) → c1 (Plan); x1 beside p1; one unattributed summary.
const FA: SessionAgents = { sess: A, main: n('main', null, 1, [n('p1aaaaaa', 'Explore', 2, [n('c1bbbbbb', 'Plan')]), n('x1cccccc', 'Plan')]) }
const FB: SessionAgents = { sess: B, main: n('main', null, 0, [n('c1bbbbbb', 'Plan')]) }
const one = buildTree([FA])
const two = buildTree([FA, FB], (s) => (s === A ? 'Fix the bug' : undefined))
const keys = (t: readonly PickNode[]): string[] => t.flatMap((x) => [x.key, ...keys(x.children)])
const s = (...xs: string[]) => new Set(xs)

test('one session: main on top, children nested, summaries as a leaf per owner', () => {
  assert.equal(one.length, 1)
  assert.equal(one[0]?.label, 'main')
  assert.deepEqual(keys(one), [`${A}:main`, `${A}:p1aaaaaa`, `${A}:c1bbbbbb`, `${A}:summaries:p1aaaaaa`, `${A}:x1cccccc`, `${A}:summaries:main`])
  const p1 = one[0]?.children[0]
  assert.ok(p1)
  assert.equal(p1.label, 'Explore p1aaaa')
  assert.equal(p1.children[1]?.label, 'summaries (2)')
  assert.equal(one[0]?.sub, `${A}:*`)
  assert.equal(p1.sub, `${A}:p1aaaaaa*`)
  assert.equal(countNodes(one), 6)
})

test('two sessions: a session level with title and short id; untitled falls back', () => {
  assert.deepEqual(
    two.map((x) => x.label),
    ['Fix the bug · aaaaaaaa', 'untitled · bbbbbbbb'],
  )
  assert.deepEqual(
    two.map((x) => x.children[0]?.key),
    [`${A}:main`, `${B}:main`],
  )
  assert.deepEqual(
    two.map((x) => [x.name, x.tag]),
    [
      ['Fix the bug', '· aaaaaaaa'],
      ['untitled', '· bbbbbbbb'],
    ],
  )
  assert.equal(two[0]?.self, null)
})

test('ticking a node ticks its subtree as one subtree token', () => {
  assert.deepEqual([...toggle(one, s(), `${A}:p1aaaaaa`)], [`${A}:p1aaaaaa*`])
  assert.deepEqual([...toggle(one, s(), `${A}:summaries:main`)], [`${A}:summaries:main`])
  assert.deepEqual([...toggle(one, s(), `${A}:main`)], [`${A}:*`])
  assert.deepEqual([...toggle(two, s(), `${B}:*`)], [`${B}:*`])
})

test('select all equals toggling every top-level node on', () => {
  for (const t of [one, two])
    assert.deepEqual(
      selectAll(t),
      t.reduce((sel, x) => toggle(t, sel, x.key), s()),
    )
})

test('unticking inside a ticked subtree leaves the rest and a partial parent', () => {
  const sel = toggle(one, s(`${A}:*`), `${A}:c1bbbbbb`)
  assert.deepEqual([...sel].sort(), [`${A}:main`, `${A}:p1aaaaaa`, `${A}:summaries:main`, `${A}:summaries:p1aaaaaa`, `${A}:x1cccccc*`].sort())
  const st = checks(one, sel)
  assert.equal(st.get(`${A}:main`), 'mixed')
  assert.equal(st.get(`${A}:p1aaaaaa`), 'mixed')
  assert.equal(st.get(`${A}:c1bbbbbb`), 'off')
  assert.equal(st.get(`${A}:x1cccccc`), 'on')
  // Ticking the partial parent completes it; ticking it again clears it.
  const full = toggle(one, sel, `${A}:p1aaaaaa`)
  assert.deepEqual([...full], [`${A}:*`])
  assert.deepEqual([...toggle(one, full, `${A}:main`)], [])
})

test('ticking every child of a node folds into the node', () => {
  let sel = toggle(one, s(), `${A}:c1bbbbbb`)
  sel = toggle(one, sel, `${A}:summaries:p1aaaaaa`)
  assert.equal(checks(one, sel).get(`${A}:p1aaaaaa`), 'mixed')
  sel = toggle(one, sel, `${A}:p1aaaaaa`)
  assert.deepEqual([...sel], [`${A}:p1aaaaaa*`])
})

test('a session ticked in a two-session tree shows its main and children on', () => {
  const st = checks(two, s(`${B}:*`))
  assert.equal(st.get(`${B}:*`), 'on')
  assert.equal(st.get(`${B}:c1bbbbbb`), 'on')
  assert.equal(st.get(`${A}:c1bbbbbb`), 'off')
  assert.equal(st.get(`${A}:*`), 'off')
})

test('selection text: all, one node by name, else a count of ticked nodes', () => {
  assert.equal(agentSelection(s(), one), 'all')
  assert.equal(agentSelection(s(`${A}:main`), one), 'main')
  assert.equal(agentSelection(s(`${A}:summaries:main`), one), 'summaries (1)')
  assert.equal(agentSelection(s(`${A}:p1aaaaaa*`), one), '3')
  assert.equal(agentSelection(s(`${B}:*`), two), '2')
})

test('prune drops tokens of vanished sessions or agents and keeps an unchanged set', () => {
  const sel = s(`${A}:p1aaaaaa*`, `${B}:*`)
  assert.equal(pruneAgents(sel, two), sel)
  assert.deepEqual([...pruneAgents(sel, one)], [`${A}:p1aaaaaa*`])
  assert.deepEqual([...pruneAgents(s(`${A}:gone`), one)], [])
  const none = s()
  assert.equal(pruneAgents(none, []), none)
})

test('search keeps matches with their ancestors, and ticked nodes', () => {
  assert.deepEqual(keys(searchTree(one, ' ', s())), keys(one))
  assert.deepEqual(keys(searchTree(one, 'PLAN', s())), [`${A}:main`, `${A}:p1aaaaaa`, `${A}:c1bbbbbb`, `${A}:x1cccccc`])
  assert.deepEqual(keys(searchTree(one, 'zzz', s(`${A}:summaries:main`))), [`${A}:main`, `${A}:summaries:main`])
})

test('search: a node listed for this query stays after it is unticked', () => {
  const before = searchTree(one, 'zzz', s(`${A}:summaries:main`))
  assert.deepEqual(keys(searchTree(one, 'zzz', s())), [])
  assert.deepEqual(keys(searchTree(one, 'zzz', s(), new Set(keys(before)))), [`${A}:main`, `${A}:summaries:main`])
})
