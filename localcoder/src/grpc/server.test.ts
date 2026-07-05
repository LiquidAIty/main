import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAgentDefinitionsFromRequest } from './server.js'

// No Node .mjs host, no mcp__liquidaity__ bare-to-qualified mapping, no aliases.
// The saved card must already grant the exact real tool names the live Python
// MCP pool uses — this function is a straight pass-through, nothing more.
test('buildAgentDefinitionsFromRequest passes the saved card tool grants through unchanged', () => {
  const req = {
    agent_definitions: [
      {
        agent_type: 'card_thinkgraph_agent',
        system_prompt: 'Read and write the ThinkGraph.',
        allowed_tools: [
          'mcp__liquidaity__thinkgraph_get_graph_slice',
          'mcp__liquidaity__thinkgraph_apply_live_patch',
        ],
        context_mode_inherit_parent: true,
      },
    ],
  }

  const [definition] = buildAgentDefinitionsFromRequest(req)

  assert.deepEqual(definition.tools, [
    'mcp__liquidaity__thinkgraph_get_graph_slice',
    'mcp__liquidaity__thinkgraph_apply_live_patch',
  ])
  assert.equal(definition.contextMode, 'inherit_parent')
})

test('buildAgentDefinitionsFromRequest never invents or rewrites a tool name', () => {
  const req = {
    agent_definitions: [
      {
        agent_type: 'some_other_card',
        system_prompt: 'Do something else.',
        allowed_tools: ['read_thinkgraph_scope'], // an old bare name — must NOT be rewritten
      },
    ],
  }

  const [definition] = buildAgentDefinitionsFromRequest(req)

  assert.deepEqual(definition.tools, ['read_thinkgraph_scope'])
})
