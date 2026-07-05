import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAgentDefinitionsFromRequest,
  missingRequiredThinkGraphTools,
  resolveCardRunControlCall,
} from './server.js'
import { resolveAgentTools } from '../tools/AgentTool/agentToolUtils.js'

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

// Fail-closed startup validation: the fetched Python MCP pool must actually
// contain the control-surface tools the merged card architecture depends on —
// a card grant in deck data is never treated as executable on its own.
const REQUIRED_CONTROL_TOOLS = [
  'mcp__liquidaity__card_run_assistant_agent',
  'mcp__liquidaity__thinkgraph_get_graph_slice',
  'mcp__liquidaity__thinkgraph_apply_live_patch',
]

test('missingRequiredThinkGraphTools passes only when the real qualified control tools are fetched', () => {
  assert.deepEqual(
    missingRequiredThinkGraphTools([...REQUIRED_CONTROL_TOOLS, 'mcp__liquidaity__canvas_inspect']),
    [],
  )
})

test('missingRequiredThinkGraphTools reports each absent tool exactly', () => {
  assert.deepEqual(
    missingRequiredThinkGraphTools(['mcp__liquidaity__thinkgraph_get_graph_slice']),
    [
      'mcp__liquidaity__card_run_assistant_agent',
      'mcp__liquidaity__thinkgraph_apply_live_patch',
    ],
  )
  // Old bare names are NOT the real pool names — no alias, no translation.
  assert.deepEqual(
    missingRequiredThinkGraphTools([
      'card.run_assistant_agent',
      'thinkgraph.get_graph_slice',
      'thinkgraph.apply_live_patch',
    ]),
    REQUIRED_CONTROL_TOOLS,
  )
})

// The trusted card-run gate: a doorway child is forced onto its OWN bound card
// with server-injected session identity; anything else is denied. The model can
// neither pick another card nor forge project/conversation identity.
test('resolveCardRunControlCall forces the bound card and injects trusted identity', () => {
  const resolved = resolveCardRunControlCall({
    input: { cardId: 'card_SOMETHING_ELSE', input: 'do the task', projectId: 'forged' },
    agentType: 'card_thinkgraph_agent',
    cardIdByAgentType: new Map([['card_thinkgraph_agent', 'card_thinkgraph_agent']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
  })
  assert.ok('updatedInput' in resolved)
  assert.deepEqual((resolved as any).updatedInput, {
    input: 'do the task',
    cardId: 'card_thinkgraph_agent',
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
  })
})

test('resolveCardRunControlCall denies callers that are not a doorway child of this turn', () => {
  const parentCall = resolveCardRunControlCall({
    input: { cardId: 'card_thinkgraph_agent', input: 'task' },
    agentType: undefined,
    cardIdByAgentType: new Map([['card_thinkgraph_agent', 'card_thinkgraph_agent']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
  })
  assert.deepEqual(parentCall, { deny: 'card_run_requires_card_doorway_child' })

  const unknownChild = resolveCardRunControlCall({
    input: { input: 'task' },
    agentType: 'general-purpose',
    cardIdByAgentType: new Map([['card_thinkgraph_agent', 'card_thinkgraph_agent']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
  })
  assert.deepEqual(unknownChild, { deny: 'card_run_requires_card_doorway_child' })
})

test('resolveCardRunControlCall denies when the session identity is unavailable', () => {
  const resolved = resolveCardRunControlCall({
    input: { input: 'task' },
    agentType: 'card_thinkgraph_agent',
    cardIdByAgentType: new Map([['card_thinkgraph_agent', 'card_thinkgraph_agent']]),
    projectId: '',
    conversationId: '',
    correlationId: 'corr-42',
  })
  assert.deepEqual(resolved, { deny: 'card_run_session_identity_unavailable' })
})

// The child worker pool boundary: the saved card's exact grants resolve
// against the REAL loaded MCP tool pool (what AppState.mcp.tools now carries),
// and resolve to nothing when that pool is absent — the pre-fix failure mode.
function fakeMcpTool(name: string) {
  return { name, isMcp: true } as any
}

test('card grants resolve into usable child tools only from the real loaded pool', () => {
  const [definition] = buildAgentDefinitionsFromRequest({
    agent_definitions: [
      {
        agent_type: 'card_thinkgraph_agent',
        system_prompt: 'Read and write the ThinkGraph.',
        allowed_tools: [
          'mcp__liquidaity__thinkgraph_get_graph_slice',
          'mcp__liquidaity__thinkgraph_apply_live_patch',
        ],
      },
    ],
  })

  const loadedPool = [
    fakeMcpTool('mcp__liquidaity__thinkgraph_get_graph_slice'),
    fakeMcpTool('mcp__liquidaity__thinkgraph_apply_live_patch'),
    fakeMcpTool('mcp__liquidaity__canvas_inspect'),
  ]
  const resolved = resolveAgentTools(definition, loadedPool)
  assert.deepEqual(
    resolved.resolvedTools.map(t => t.name).sort(),
    [
      'mcp__liquidaity__thinkgraph_apply_live_patch',
      'mcp__liquidaity__thinkgraph_get_graph_slice',
    ],
  )
  assert.deepEqual(resolved.invalidTools, [])

  // Empty pool (AppState.mcp.tools not populated) → both grants unresolvable.
  const unresolved = resolveAgentTools(definition, [])
  assert.deepEqual(unresolved.resolvedTools, [])
  assert.equal(unresolved.invalidTools.length, 2)
})
