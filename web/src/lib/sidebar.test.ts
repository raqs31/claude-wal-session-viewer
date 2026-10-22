import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionMeta } from '../../../shared/api.ts'
import { chipValues, filterRows, groupByProject, pinPicked, type SidebarFilter, sidebarSummary } from './sidebar.ts'

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
const NONE: SidebarFilter = { chips: new Set(), not: false, project: '', text: '' }
const ids = (rs: readonly SessionMeta[]) => rs.map((r) => r.id)

const rows = [
  row('a', { source: 'default', workspaces: ['priv'], title: 'Fix login bug' }),
  row('b', { source: 'work', workspaces: ['work'], project: { slug: 'q', cwd: '/w/q' } }),
  row('c', { source: 'default', workspaces: ['unknown'], worktree: 'feat-x', title: 'Login page' }),
]

test('no filter keeps every row', () => {
  assert.deepEqual(ids(filterRows(rows, NONE)), ['a', 'b', 'c'])
})

test('a chip matches the source or any workspace', () => {
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['priv']) })), ['a'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['default']) })), ['a', 'c'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['work', 'unknown']) })), ['b', 'c'])
})

test('Not with a source chip hides the rows of that source', () => {
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['work']), not: true })), ['a', 'c'])
})

test('Not with a workspace chip hides rows having that workspace', () => {
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['priv']), not: true })), ['b', 'c'])
})

test('Not with empty chips filters nothing', () => {
  assert.deepEqual(ids(filterRows(rows, { ...NONE, not: true })), ['a', 'b', 'c'])
})

test('text matches every word, case-insensitive, across title, id, project and worktree', () => {
  assert.deepEqual(ids(filterRows(rows, { ...NONE, text: 'LOGIN' })), ['a', 'c'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, text: 'login feat' })), ['c'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, text: '/w/q' })), ['b'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, text: '   ' })), ['a', 'b', 'c'])
})

test('chip AND project AND text all apply', () => {
  assert.deepEqual(ids(filterRows(rows, { chips: new Set(['default']), not: false, project: 'p', text: 'login' })), ['a', 'c'])
  assert.deepEqual(ids(filterRows(rows, { chips: new Set(['default']), not: false, project: 'p', text: 'page' })), ['c'])
  assert.deepEqual(ids(filterRows(rows, { chips: new Set(['work']), not: false, project: 'p', text: '' })), [])
})

test('chip values are the sorted union of sources and workspaces', () => {
  assert.deepEqual(chipValues(rows), ['default', 'priv', 'unknown', 'work'])
})

test('groups by project, worktrees under the parent, newest group and row first', () => {
  const gs = groupByProject([
    row('old', { last: 1 }),
    row('q1', { last: 5, project: { slug: 'q', cwd: '/w/q' } }),
    row('wt', { last: 9, worktree: 'feat', project: { slug: 'p', cwd: '/w/p/.ai/worktrees/feat' } }),
    row('mid', { last: 3 }),
  ])
  assert.deepEqual(
    gs.map((g) => [g.slug, g.last, ids(g.rows)]),
    [
      ['p', 9, ['wt', 'mid', 'old']],
      ['q', 5, ['q1']],
    ],
  )
  assert.equal(gs[0]?.cwd, '/w/p')
})

test('a tie keeps list order; a worktree-only group takes the worktree cwd; no cwd is null', () => {
  const gs = groupByProject([
    row('x', { last: 2, project: { slug: 'x', cwd: null } }),
    row('y1', { last: 2, worktree: 'w', project: { slug: 'y', cwd: '/w/y/wt' } }),
    row('y2', { last: 2, project: { slug: 'y', cwd: null } }),
  ])
  assert.deepEqual(
    gs.map((g) => [g.slug, g.cwd, ids(g.rows)]),
    [
      ['x', null, ['x']],
      ['y', '/w/y/wt', ['y1', 'y2']],
    ],
  )
  assert.deepEqual(groupByProject([]), [])
})

test('summary lists only active sidebar filters', () => {
  assert.deepEqual(sidebarSummary(NONE, ''), [])
  assert.deepEqual(sidebarSummary({ chips: new Set(['priv']), not: false, project: 'p', text: ' bug ' }, 'unix_conf'), ['priv', 'project: unix_conf', 'q: bug'])
  assert.deepEqual(sidebarSummary({ ...NONE, chips: new Set(['a', 'b', 'c']) }, ''), ['chips: 3'])
})

test('summary marks negated chips', () => {
  assert.deepEqual(sidebarSummary({ ...NONE, chips: new Set(['default', 'work']), not: true }, ''), ['≠ default, work'])
})

test('a frozen lastOf holds row and group order while `last` moves between polls', () => {
  const poll1 = [row('a', { last: 1 }), row('b', { last: 2 }), row('q1', { last: 3, project: { slug: 'q', cwd: '/w/q' } })]
  const poll2 = [row('a', { last: 10 }), row('b', { last: 2 }), row('q1', { last: 3, project: { slug: 'q', cwd: '/w/q' } })]
  assert.deepEqual(
    groupByProject(poll2).map((g) => ids(g.rows)),
    [['a', 'b'], ['q1']],
  )
  const m = new Map(poll1.map((r) => [r.id, r.last]))
  const frozen = groupByProject(poll2, (r) => m.get(r.id) ?? 0)
  assert.deepEqual(
    frozen.map((g) => [g.slug, ids(g.rows)]),
    groupByProject(poll1).map((g) => [g.slug, ids(g.rows)]),
  )
  assert.deepEqual(
    frozen.map((g) => [g.slug, ids(g.rows)]),
    [
      ['q', ['q1']],
      ['p', ['b', 'a']],
    ],
  )
})

test('an id unknown to the frozen lastOf sinks to the bottom of its group', () => {
  const m = new Map([
    ['a', 1],
    ['b', 2],
  ])
  const gs = groupByProject([row('new', { last: 99 }), row('a', { last: 1 }), row('b', { last: 2 })], (r) => m.get(r.id) ?? 0)
  assert.deepEqual(
    gs.map((g) => ids(g.rows)),
    [['b', 'a', 'new']],
  )
})

test('pinPicked returns picked rows in pick order, skips missing ids, keeps the rest in input order', () => {
  const rs = [row('a'), row('b'), row('c'), row('d')]
  const { picked, rest } = pinPicked(rs, ['d', 'gone', 'b'])
  assert.deepEqual(ids(picked), ['d', 'b'])
  assert.deepEqual(ids(rest), ['a', 'c'])
  assert.deepEqual(pinPicked(rs, []), { picked: [], rest: rs })
})
