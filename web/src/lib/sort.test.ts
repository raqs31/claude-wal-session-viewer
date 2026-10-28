import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canSort, next, sortParams } from './sort.ts'

test('clicking one key cycles null, desc, asc, null', () => {
  const first = next(null, 'tot')
  const second = next(first, 'tot')
  const third = next(second, 'tot')
  assert.deepEqual([first, second, third], [{ key: 'tot', dir: 'desc' }, { key: 'tot', dir: 'asc' }, null])
})

test('clicking a new key while another is active starts at desc', () => {
  assert.deepEqual(next({ key: 'tot', dir: 'asc' }, 'dur'), { key: 'dur', dir: 'desc' })
})

test('no sort sends no params', () => {
  assert.deepEqual(sortParams(null), [])
})

test('a sort sends sort and dir', () => {
  assert.deepEqual(sortParams({ key: 'out', dir: 'asc' }), [
    ['sort', 'out'],
    ['dir', 'asc'],
  ])
})

test('sorting is allowed only with Live off in the Table view', () => {
  assert.equal(canSort(false, 'table'), true)
  assert.equal(canSort(true, 'table'), false)
  assert.equal(canSort(false, 'tail'), false)
  assert.equal(canSort(true, 'tail'), false)
})
