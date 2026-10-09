import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupMcp, mcpParts, toolColor } from './mcp.ts'

test('mcpParts splits server and tool at the first __ after the prefix', () => {
  assert.deepEqual(mcpParts('mcp__claude_ai_Todoist__find-tasks'), ['claude_ai_Todoist', 'find-tasks'])
  assert.deepEqual(mcpParts('mcp__x'), ['x', 'x'])
  assert.equal(mcpParts('Bash'), null)
})

test('colours: no tool red, built-ins Claude orange, MCP stable per server', () => {
  assert.equal(toolColor('-'), 'var(--status-critical)')
  assert.equal(toolColor('Bash'), 'var(--tool-claude)')
  assert.equal(toolColor('mcp__pg__query'), toolColor('mcp__pg__exec'))
  assert.match(toolColor('mcp__pg__query'), /^hsl\(\d+ 60% 55%\)$/)
})

test('groupMcp sorts groups and tools, search matches server or tool name', () => {
  const tools = ['Bash', 'mcp__pg__query', 'mcp__idea__open', 'mcp__pg__exec', 'mcp__idea__close']
  assert.deepEqual(groupMcp(tools, ''), [
    { server: 'idea', tools: ['mcp__idea__close', 'mcp__idea__open'] },
    { server: 'pg', tools: ['mcp__pg__exec', 'mcp__pg__query'] },
  ])
  assert.deepEqual(groupMcp(tools, 'PG'), [{ server: 'pg', tools: ['mcp__pg__exec', 'mcp__pg__query'] }])
  assert.deepEqual(groupMcp(tools, 'clo'), [{ server: 'idea', tools: ['mcp__idea__close'] }])
})
