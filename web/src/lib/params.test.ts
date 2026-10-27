import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTree } from './agents.ts'
import { buildParams, EMPTY_FILTERS, filterSummary, pruneFilters, sameRows } from './params.ts'

test('nothing selected sends only the pick', () => {
  assert.equal(buildParams(EMPTY_FILTERS, ['s1', 's2']).toString(), 'ids=s1%2Cs2')
  assert.equal(buildParams(EMPTY_FILTERS, []).toString(), 'ids=')
})

test('selected chips become include lists; text fields are trimmed; nodur only when on', () => {
  const p = buildParams(
    {
      ...EMPTY_FILTERS,
      q: '  needle ',
      min_ms: '10',
      cat: new Set(['fail'] as const),
      tool: new Set(['Bash', '-']),
      event: new Set(['SubagentStart', 'SubagentStop']),
      agent: new Set(['s1:main', 's1:a1*']),
      nodur: true,
    },
    ['s1'],
  )
  assert.equal(p.toString(), 'ids=s1&q=needle&min_ms=10&cat=fail&tool=Bash%2C-&event=SubagentStart%2CSubagentStop&agent=s1%3Amain%2Cs1%3Aa1*&nodur=include')
  assert.equal(p.has('session'), false)
})

test('token bounds are trimmed and sent; notok only when on', () => {
  const p = buildParams({ ...EMPTY_FILTERS, min_tok: ' 5000 ', max_tok: '9000', notok: true }, ['s1'])
  assert.equal(p.toString(), 'ids=s1&min_tok=5000&max_tok=9000&notok=include')
  assert.equal(buildParams({ ...EMPTY_FILTERS, min_tok: '5' }, ['s1']).has('notok'), false)
})

test('a Not section is sent as <field>_not instead of <field>', () => {
  for (const k of ['cat', 'tool', 'event', 'agent'] as const) {
    const p = buildParams({ ...EMPTY_FILTERS, [k]: new Set(['x']), not: new Set([k]) }, ['s1'])
    assert.equal(p.toString(), `ids=s1&${k}_not=x`)
  }
})

test('summary lists only active filters, in bar order', () => {
  assert.deepEqual(filterSummary(EMPTY_FILTERS, []), [])
  assert.deepEqual(
    filterSummary(
      {
        ...EMPTY_FILTERS,
        q: ' foo ',
        cat: new Set(['fail', 'tool'] as const),
        agent: new Set(['s1:main']),
        date_from: '2026-10-01',
        min_ms: '10',
        nodur: true,
      },
      buildTree([{ sess: 's1', main: { id: 'main', type: null, summaries: 0, children: [] } }]),
    ),
    ['cat: 2', 'agent: main', 'q: foo', 'date: 2026-10-01–', 'ms: 10– +none'],
  )
})

test('summary shows the token range in the style of ms', () => {
  assert.deepEqual(filterSummary({ ...EMPTY_FILTERS, min_tok: '5000' }, []), ['tok: 5000–'])
  assert.deepEqual(filterSummary({ ...EMPTY_FILTERS, max_tok: '9', notok: true }, []), ['tok: –9 +none'])
})

test('summary marks a Not section with ≠', () => {
  const t = buildTree([{ sess: 's1', main: { id: 'main', type: null, summaries: 0, children: [] } }])
  assert.deepEqual(filterSummary({ ...EMPTY_FILTERS, tool: new Set(['a', 'b']), not: new Set(['tool']) }, t), ['tool: ≠2'])
  assert.deepEqual(filterSummary({ ...EMPTY_FILTERS, agent: new Set(['s1:main']), not: new Set(['agent']) }, t), ['agent: ≠main'])
})

test('EMPTY_FILTERS has no Not section', () => {
  assert.equal(EMPTY_FILTERS.not.size, 0)
})

const tree = buildTree([{ sess: 's1', main: { id: 'main', type: null, summaries: 0, children: [] } }])
const facets = { tools: ['Bash'], events: ['PreToolUse'], cats: ['tool'] as const, agents: tree }

test('prune keeps the same object when nothing drops', () => {
  const f = { ...EMPTY_FILTERS, cat: new Set(['tool'] as const), tool: new Set(['Bash']), event: new Set(['PreToolUse']), agent: new Set(['s1:*']) }
  assert.equal(pruneFilters(f, facets), f)
  assert.equal(pruneFilters(EMPTY_FILTERS, facets), EMPTY_FILTERS)
})

test('prune drops values the facets lack, keeping untouched sets', () => {
  const f = {
    ...EMPTY_FILTERS,
    q: 'x',
    nodur: true,
    cat: new Set(['tool', 'fail'] as const),
    tool: new Set(['Bash', 'Read']),
    event: new Set(['PreToolUse', 'Stop']),
    agent: new Set(['s1:*', 's2:*']),
  }
  const g = pruneFilters(f, facets)
  assert.deepEqual([...g.cat], ['tool'])
  assert.deepEqual([...g.tool], ['Bash'])
  assert.deepEqual([...g.event], ['PreToolUse'])
  assert.deepEqual([...g.agent], ['s1:*'])
  assert.equal(g.q, 'x')
  assert.equal(g.nodur, true)
  assert.equal(g.q, f.q)
  const keepTool = { ...EMPTY_FILTERS, tool: new Set(['Bash']), event: new Set(['Stop']) }
  assert.equal(pruneFilters(keepTool, facets).tool, keepTool.tool)
})

test('prune keeps the Not flags', () => {
  const f = { ...EMPTY_FILTERS, tool: new Set(['Bash', 'Read']), not: new Set(['tool'] as const) }
  assert.deepEqual([...pruneFilters(f, facets).not], ['tool'])
})

test('prune drops the Not flag of a section it empties', () => {
  const f = { ...EMPTY_FILTERS, tool: new Set(['Gone']), not: new Set(['tool'] as const) }
  assert.equal(pruneFilters(f, facets).not.size, 0)
})

test("prune keeps '-' with an empty tools facet", () => {
  const f = { ...EMPTY_FILTERS, tool: new Set(['-', 'Bash']) }
  assert.deepEqual([...pruneFilters(f, { ...facets, tools: [] }).tool], ['-'])
})

test("prune keeps a 'session' cat the cats facet lists even with no event mapping to it, and drops an absent one", () => {
  const f = { ...EMPTY_FILTERS, cat: new Set(['session', 'tool'] as const) }
  assert.deepEqual([...pruneFilters(f, { ...facets, cats: ['session'] }).cat], ['session'])
})

test('sameRows is false only when a set that had values is now empty', () => {
  const f = { ...EMPTY_FILTERS, tool: new Set(['a', 'b']), event: new Set(['Stop']) }
  assert.equal(sameRows(f, { ...f, tool: new Set(['a']) }), true)
  assert.equal(sameRows(f, { ...f, event: new Set() }), false)
  assert.equal(sameRows(EMPTY_FILTERS, EMPTY_FILTERS), true)
})

test('sameRows is false when pruning empties a Not section', () => {
  const f = { ...EMPTY_FILTERS, tool: new Set(['Read']), not: new Set(['tool'] as const) }
  assert.equal(sameRows(f, pruneFilters(f, facets)), false)
})
