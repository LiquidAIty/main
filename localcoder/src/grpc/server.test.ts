import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

import {
  buildAgentDefinitionsFromRequest,
  missingRequiredHarnessTools,
  resolveCardRunControlCall,
  serializeProgressEvent,
} from './server.js'
import { resolveAgentTools } from '../tools/AgentTool/agentToolUtils.js'

// No Node .mjs host, no mcp__liquidaity__ bare-to-qualified mapping, no aliases.
// A card doorway definition grants exactly the one card-run control tool — this
// function is a straight pass-through of whatever grants it is handed, nothing more.
test('buildAgentDefinitionsFromRequest passes the doorway tool grant through unchanged', () => {
  const req = {
    agent_definitions: [
      {
        agent_type: 'card_thinkgraph_agent',
        system_prompt: 'Run the bound ThinkGraph card.',
        allowed_tools: ['mcp__liquidaity__card_run_assistant_agent'],
        context_mode_inherit_parent: true,
      },
    ],
  }

  const [definition] = buildAgentDefinitionsFromRequest(req)

  assert.deepEqual(definition.tools, ['mcp__liquidaity__card_run_assistant_agent'])
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
// contain the control-surface tools the card architecture depends on — the
// card-run doorway tool and the bounded READ-ONLY ThinkGraph slice. There is
// NO model-facing write tool to require. A card grant in deck data is never
// treated as executable on its own.
const REQUIRED_CONTROL_TOOLS = [
  'mcp__liquidaity__card_run_assistant_agent',
  'mcp__liquidaity__thinkgraph_get_graph_slice',
  'mcp__liquidaity__mag_one_describe_connected_agents',
]

test('serializeProgressEvent preserves native structured subagent progress and linkage', () => {
  const progress = serializeProgressEvent({
    type: 'progress',
    toolUseID: 'child-tool',
    parentToolUseID: 'agent-call',
    data: {
      type: 'agent_progress',
      agentId: 'agent-42',
      message: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'read_graph' }] } },
    },
  })

  assert.equal(progress.tool_use_id, 'child-tool')
  assert.equal(progress.parent_tool_use_id, 'agent-call')
  assert.deepEqual(JSON.parse(progress.data_json), {
    type: 'agent_progress',
    agentId: 'agent-42',
    message: { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'read_graph' }] } },
  })
})

test('the actual gRPC serializers preserve UTF-8 request and progress bytes', () => {
  const definition = protoLoader.loadSync(path.resolve(import.meta.dirname, '../proto/openclaude.proto'), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  const service = (grpc.loadPackageDefinition(definition) as any).openclaude.v1.AgentService.service.Chat
  const text = 'UTF-8 — café 漢字'

  const request = service.requestDeserialize(service.requestSerialize({ request: { message: text } }))
  assert.equal(request.request.message, text)

  const response = service.responseDeserialize(service.responseSerialize({
    progress: { tool_use_id: 'child', parent_tool_use_id: 'parent', data_json: JSON.stringify({ text }) },
  }))
  assert.deepEqual(JSON.parse(response.progress.data_json), { text })
})

test('missingRequiredHarnessTools passes only when the real qualified control tools are fetched', () => {
  assert.deepEqual(
    missingRequiredHarnessTools([...REQUIRED_CONTROL_TOOLS, 'mcp__liquidaity__canvas_inspect']),
    [],
  )
})

test('missingRequiredHarnessTools never requires a model-facing graph-write tool', () => {
  // A pool with only the read + doorway tools (no apply_live_patch anywhere) is
  // complete — the write tool was removed from the model-facing surface.
  assert.deepEqual(missingRequiredHarnessTools(REQUIRED_CONTROL_TOOLS), [])
})

test('missingRequiredHarnessTools reports each absent tool exactly', () => {
  assert.deepEqual(
    missingRequiredHarnessTools(['mcp__liquidaity__thinkgraph_get_graph_slice']),
    [
      'mcp__liquidaity__card_run_assistant_agent',
      'mcp__liquidaity__mag_one_describe_connected_agents',
    ],
  )
  // Old bare names are NOT the real pool names — no alias, no translation.
  assert.deepEqual(
    missingRequiredHarnessTools(['card.run_assistant_agent', 'thinkgraph.get_graph_slice']),
    REQUIRED_CONTROL_TOOLS,
  )
})

// The trusted card-run gate: a doorway child is forced onto its OWN bound card
// with server-injected session identity; anything else is denied. The model can
// neither pick another card nor forge project/conversation identity.
test('resolveCardRunControlCall forces the bound card and injects trusted identity', () => {
  const resolved = resolveCardRunControlCall({
    input: { cardId: 'card_thinkgraph_agent', input: 'do the task', projectId: 'forged' },
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

test('resolveCardRunControlCall permits only the persisted orange child target', () => {
  const base = {
    agentType: 'card_hermes_steward',
    cardIdByAgentType: new Map([['card_hermes_steward', 'card_hermes_steward']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
    allowedCardRunIdsByAgentType: new Map([['card_hermes_steward', ['card_research_agent']]]),
  }
  const allowed = resolveCardRunControlCall({ ...base, input: { cardId: 'card_research_agent', input: 'research' } })
  assert.ok('updatedInput' in allowed)
  assert.equal((allowed as any).updatedInput.cardId, 'card_research_agent')
  const rejected = resolveCardRunControlCall({ ...base, input: { cardId: 'card_local_coder', input: 'run' } })
  assert.deepEqual(rejected, { deny: 'card_run_target_not_authorized' })
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

test('the doorway grant resolves into a usable child tool only from the real loaded pool', () => {
  const [definition] = buildAgentDefinitionsFromRequest({
    agent_definitions: [
      {
        agent_type: 'card_thinkgraph_agent',
        system_prompt: 'Run the bound ThinkGraph card.',
        allowed_tools: ['mcp__liquidaity__card_run_assistant_agent'],
      },
    ],
  })

  const loadedPool = [
    fakeMcpTool('mcp__liquidaity__card_run_assistant_agent'),
    fakeMcpTool('mcp__liquidaity__thinkgraph_get_graph_slice'),
    fakeMcpTool('mcp__liquidaity__canvas_inspect'),
  ]
  const resolved = resolveAgentTools(definition, loadedPool)
  assert.deepEqual(
    resolved.resolvedTools.map(t => t.name),
    ['mcp__liquidaity__card_run_assistant_agent'],
  )
  assert.deepEqual(resolved.invalidTools, [])

  // Empty pool (AppState.mcp.tools not populated) → the grant is unresolvable.
  const unresolved = resolveAgentTools(definition, [])
  assert.deepEqual(unresolved.resolvedTools, [])
  assert.equal(unresolved.invalidTools.length, 1)
})
