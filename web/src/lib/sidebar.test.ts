import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionMeta } from '../../../shared/api.ts'
import {
  ANY,
  chipValues,
  defaultFilter,
  filterRows,
  groupByProject,
  inDates,
  type SidebarFilter,
  sidebarSummary,
  startOfToday,
  toLocalInput,
} from './sidebar.ts'

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
const NONE: SidebarFilter = { chips: new Set(), not: false, project: '', text: '', created: ANY, last: ANY }
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
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['default']), not: false, project: 'p', text: 'login' })), ['a', 'c'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['default']), not: false, project: 'p', text: 'page' })), ['c'])
  assert.deepEqual(ids(filterRows(rows, { ...NONE, chips: new Set(['work']), not: false, project: 'p', text: '' })), [])
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
  assert.deepEqual(sidebarSummary({ ...NONE, chips: new Set(['priv']), not: false, project: 'p', text: ' bug ' }, 'unix_conf'), [
    'priv',
    'project: unix_conf',
    'q: bug',
  ])
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

test('the last-message range keeps rows whose last write lies within it, bounds inclusive', () => {
  const rs = [row('a', { last: 10 }), row('b', { last: 20 }), row('c', { last: 30 })]
  assert.deepEqual(ids(filterRows(rs, { ...NONE, last: { from: 20, to: null } })), ['b', 'c'])
  assert.deepEqual(ids(filterRows(rs, { ...NONE, last: { from: null, to: 20 } })), ['a', 'b'])
  assert.deepEqual(ids(filterRows(rs, { ...NONE, last: { from: 20, to: 20 } })), ['b'])
})

test('the created range reads started, falling back to the last write when the start is unknown', () => {
  const rs = [row('a', { started: 5, last: 50 }), row('b', { started: null, last: 15 }), row('c', { started: 25, last: 30 })]
  assert.deepEqual(ids(filterRows(rs, { ...NONE, created: { from: 10, to: 20 } })), ['b'])
  assert.equal(inDates(row('d', { started: 5, last: 50 }), { created: { from: null, to: 5 }, last: { from: 50, to: null } }), true)
})

test('startOfToday is local midnight of the given time', () => {
  const t = new Date(2026, 9, 27, 13, 58, 20).getTime()
  assert.equal(startOfToday(t), new Date(2026, 9, 27).getTime())
})

test('toLocalInput writes the local minute a datetime-local input reads back', () => {
  const t = new Date(2026, 0, 2, 3, 4).getTime()
  assert.equal(toLocalInput(t), '2026-01-02T03:04')
  assert.equal(new Date(toLocalInput(t)).getTime(), t)
})

test('the summary lists set date bounds', () => {
  const a = new Date(2026, 9, 27).getTime()
  const b = new Date(2026, 9, 28, 9, 30).getTime()
  assert.deepEqual(sidebarSummary({ ...NONE, last: { from: a, to: null } }, ''), ['last ≥ 2026-10-27 00:00'])
  assert.deepEqual(sidebarSummary({ ...NONE, created: { from: a, to: b } }, ''), ['created: 2026-10-27 00:00 – 2026-10-28 09:30'])
  assert.deepEqual(sidebarSummary({ ...NONE, created: { from: null, to: b } }, ''), ['created ≤ 2026-10-28 09:30'])
})

test('defaultFilter lists the sessions last touched since local midnight, nothing else set', () => {
  const t = new Date(2026, 9, 27, 13, 58).getTime()
  assert.deepEqual(defaultFilter(t), { ...NONE, last: { from: new Date(2026, 9, 27).getTime(), to: null } })
})
