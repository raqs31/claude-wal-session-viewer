import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampBadge, mcpSections, paneBadge } from './sections.ts'

test('mcpSections splits structured, text and metadata and hides empty sections', () => {
  const image = { type: 'image', data: 'AAAA', mimeType: 'image/png' }
  const out = mcpSections({
    content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: '[1,2]' }, { type: 'text', text: 'plain words' }, image],
    isError: true,
  })
  assert.deepEqual(out, { structured: [{ a: 1 }, [1, 2]], text: ['plain words'], meta: { isError: true, blocks: [image] } })
  assert.deepEqual(mcpSections([{ type: 'text', text: 'only' }]), { text: ['only'] })
  assert.deepEqual(mcpSections('bare'), { text: ['bare'] })
})

test('clampBadge is true for each unrestored clamp marker only', () => {
  for (const v of ['abc…[+12 chars]', '…[+3 items]', '…[depth limit]', { dropped: 2 }, { a: ['x', { b: 'y…[+5 chars]' }] }]) {
    assert.equal(clampBadge(v, false), true)
    assert.equal(clampBadge(v, true), false)
  }
  assert.equal(clampBadge({ a: 'full', b: [1, 'two'] }, false), false)
})

test('paneBadge adds a dropped WAL line to clampBadge, for an unrestored side only', () => {
  assert.equal(paneBadge(undefined, undefined, { dropped: 1 }), true)
  assert.equal(paneBadge(undefined, true, { dropped: 1 }), false)
  assert.equal(paneBadge('abc…[+12 chars]', false), true)
  assert.equal(paneBadge('abc…[+12 chars]', true, { dropped: 1 }), false)
  assert.equal(paneBadge({ a: 'full' }, undefined, { payload: {} }), false)
  assert.equal(paneBadge({ a: 'full' }, undefined), false)
})
