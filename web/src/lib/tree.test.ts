import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyText, viewNodes } from './tree.ts'
import { normalize } from './normalize.ts'

const yaml = (v: unknown) => copyText(v, 'yaml')

test('JSON copy equals JSON.stringify of the normalized value', () => {
  for (const v of [[{ a: 1 }, { b: 2 }], {}, [], { a: {} }, { s: 'x\ny', n: -0, b: false, z: null }]) {
    assert.equal(copyText(v, 'json'), JSON.stringify(normalize(v), null, 2))
  }
})

test('YAML: single-key list items stay on the dash line', () => {
  assert.equal(yaml([{ a: 1 }, { b: 2 }]), '- a: 1\n- b: 2\n')
  assert.equal(yaml({ rows: [{ id: 1, name: 'a' }], count: 1 }), 'rows:\n  - id: 1\n    name: a\ncount: 1\n')
})

test('YAML: literal blocks for multi-line text, quotes where YAML needs them', () => {
  assert.equal(yaml('first line\nsecond: line\nthird line\n'), '|\n  first line\n  second: line\n  third line\n')
  assert.equal(yaml({ s: 'a\u0001\nb' }), 's: "a\\u0001\\nb"\n')
  assert.equal(yaml({ k: '<<' }), 'k: "<<"\n')
  assert.equal(yaml({ k: '=' }), 'k: "="\n')
  assert.equal(yaml({ k: 'a\u2028b' }), 'k: "a\\u2028b"\n')
  assert.equal(yaml({ k: 'yes' }), 'k: "yes"\n')
  assert.equal(yaml({ k: '1e3' }), 'k: "1e3"\n')
})

test('MCP content blocks are unwrapped and JSON strings parsed at any depth', () => {
  assert.deepEqual(normalize([{ type: 'text', text: '{"a":1}' }]), { a: 1 })
  assert.deepEqual(normalize([{ type: 'resource', resource: { text: '{"a":1}' } }]), [{ type: 'resource', resource: { text: { a: 1 } } }])
  assert.equal(normalize('12'), '12')
  assert.equal(normalize('{bad'), '{bad')
})

test('Raw copy is the stored value, pretty-printed, not normalized', () => {
  const v = [{ type: 'text', text: '{"a":1}' }]
  assert.equal(copyText(v, 'raw'), JSON.stringify(v, null, 2))
  assert.equal(copyText('plain', 'raw'), 'plain')
})

test('collapsed summaries use singular forms', () => {
  const [n] = viewNodes({ a: [1] }, false)
  assert.ok(n && !Array.isArray(n))
  assert.equal(n.s, '{…} 1 key')
})

test('a 1 MB string renders and copies quickly', () => {
  const big = { tool_response: 'x'.repeat(1_000_000) + '\n' + 'y'.repeat(1000) }
  const t0 = performance.now()
  viewNodes(big, true)
  copyText(big, 'yaml')
  assert.ok(performance.now() - t0 < 500)
})
