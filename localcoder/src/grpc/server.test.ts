import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

import {
  bindServerOwnedToolCaller,
  buildAgentDefinitionsFromRequest,
  concurrentRequestError,
  interruptActiveRequest,
  missingRequiredHarnessTools,
  resolveCardRunControlCall,
  serializeProgressEvent,
} from './server.js'
import { resolveAgentTools } from '../tools/AgentTool/agentToolUtils.js'
import { agentTextDeltaProgress } from '../tools/AgentTool/AgentTool.js'
import { normalizeMessage } from '../utils/queryHelpers.js'
import { QueryEngine } from '../QueryEngine.js'
import type { QueryDeps } from '../query/deps.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import {
  FileStateCache,
  READ_FILE_STATE_CACHE_SIZE,
} from '../utils/fileStateCache.js'
import { createUserMessage } from '../utils/messages.js'

test('bindServerOwnedToolCaller replaces model identity with the saved Hermes identity', () => {
  const result = bindServerOwnedToolCaller({
    toolName: 'mcp__liquidaity__write_mag_one_instructions',
    input: {
      instructions: 'Prepare this exact task.',
      projectId: 'spoofed',
      _callerCardId: 'spoofed',
    },
    agentType: 'hermes-child',
    parentCardId: 'card_main_chat',
    parentRuntimeBinding: 'main_chat',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'conversation-1',
    parentRunId: 'run-1',
    cardIdByAgentType: new Map([['hermes-child', 'card_hermes_steward']]),
    runtimeBindingByAgentType: new Map([['hermes-child', 'hermes_steward']]),
  })

  assert.deepEqual(result, {
    updatedInput: {
      instructions: 'Prepare this exact task.',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      _callerCardId: 'card_hermes_steward',
      _callerRuntimeBinding: 'hermes_steward',
    },
  })
})

test('bindServerOwnedToolCaller fails closed without a saved caller binding', () => {
  const result = bindServerOwnedToolCaller({
    toolName: 'mcp__liquidaity__run_mag_one',
    input: { instructionId: 'instruction:one' },
    agentType: 'unknown-child',
    parentCardId: 'card_main_chat',
    parentRuntimeBinding: 'main_chat',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'conversation-1',
    parentRunId: 'run-1',
    cardIdByAgentType: new Map(),
    runtimeBindingByAgentType: new Map(),
  })

  assert.deepEqual(result, { deny: 'tool_caller_identity_unavailable' })
})

// No Node .mjs host, no mcp__liquidaity__ bare-to-qualified mapping, no aliases.
// A card doorway definition grants exactly the one card-run control tool — this
// function is a straight pass-through of whatever grants it is handed, nothing more.
test('buildAgentDefinitionsFromRequest passes the doorway tool grant through unchanged', () => {
  const req = {
    agent_definitions: [
      {
        agent_type: 'card_saved_worker',
        system_prompt: 'Run the bound saved worker card.',
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
        allowed_tools: ['unknown.old_tool'], // an unknown bare name must NOT be rewritten
      },
    ],
  }

  const [definition] = buildAgentDefinitionsFromRequest(req)

  assert.deepEqual(definition.tools, ['unknown.old_tool'])
})

// Fail-closed startup validation requires structural controls only. Graph
// tools are selected per card and are never global Harness prerequisites.
const REQUIRED_CONTROL_TOOLS = [
  'mcp__liquidaity__card_run_assistant_agent',
  'mcp__liquidaity__mag_one_describe_connected_agents',
]

test('QueryEngine captures the final provider payload and blocks transport', async () => {
  const previousDisableClaudeMds = process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS
  const previousDisableAutoMemory =
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  const previousAnthropicKey = process.env.ANTHROPIC_API_KEY
  const previousMacro = (globalThis as Record<string, unknown>).MACRO
  process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  process.env.ANTHROPIC_API_KEY = 'provider-boundary-spy-not-a-real-key'
  ;(globalThis as Record<string, unknown>).MACRO = new Proxy(
    { VERSION: 'provider-boundary-spy' },
    { get: (target, property) => Reflect.get(target, property) ?? 'test' },
  )

  const currentTask = 'CURRENT_TASK_SENTINEL: inspect the bounded graph context'
  const harnessInstruction =
    'HARNESS_INSTRUCTION_SENTINEL: follow the saved Main card contract'
  const fileRange =
    'repository evidence: C:/Projects/main/apps/backend/src/main.ts lines 10-20'
  const previousHistory = 'BOUNDED_HISTORY_SENTINEL: previous user turn'
  let captured: Parameters<QueryDeps['callModel']>[0] | undefined
  let callCount = 0
  const blocked = new Error('provider_transport_blocked_by_test')
  const queryDeps = {
    callModel: (async function* (request: Parameters<QueryDeps['callModel']>[0]) {
      callCount += 1
      captured = request
      throw blocked
    }) as QueryDeps['callModel'],
    microcompact: (async (messages: unknown[]) => ({
      messages,
      compactionInfo: undefined,
    })) as QueryDeps['microcompact'],
    autocompact: (async () => ({
      compactionResult: null,
      consecutiveFailures: undefined,
    })) as QueryDeps['autocompact'],
    uuid: () => 'payload-spy-uuid',
  }

  let appState = getDefaultAppState()
  const engine = new QueryEngine({
    cwd: process.cwd(),
    tools: [],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: 'allow' }),
    getAppState: () => appState,
    setAppState: updater => {
      appState = updater(appState)
    },
    initialMessages: [createUserMessage({ content: previousHistory })],
    readFileCache: new FileStateCache(
      READ_FILE_STATE_CACHE_SIZE,
      25 * 1024 * 1024,
    ),
    customSystemPrompt: 'SYSTEM_PROMPT_SENTINEL: deterministic transport proof',
    appendSystemPrompt: [
      harnessInstruction,
      '[AGENTGRAPH_CONTEXT_REFERENCES]',
      'AGENTGRAPH CONTEXT REFERENCES (1):',
      'cbm:payload-proof',
      `- ${fileRange}`,
    ].join('\n'),
    queryDeps,
  })

  try {
    for await (const _message of engine.submitMessage(currentTask)) {
      // QueryEngine converts the blocked transport into its normal SDK error
      // result. The spy below proves callModel was reached exactly once.
    }
  } finally {
    if (previousDisableClaudeMds === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS
    } else {
      process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = previousDisableClaudeMds
    }
    if (previousDisableAutoMemory === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
    } else {
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY =
        previousDisableAutoMemory
    }
    if (previousAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY
    } else {
      process.env.ANTHROPIC_API_KEY = previousAnthropicKey
    }
    if (previousMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = previousMacro
    }
  }

  assert.equal(callCount, 1)
  assert.ok(captured)
  const serialized = JSON.stringify(captured)
  const serializedBytes = Buffer.byteLength(serialized)
  const estimatedTokens = Math.ceil(serializedBytes / 4)
  const messageText = JSON.stringify(captured.messages)
  const systemText = String(captured.systemPrompt)
  const sourceRanges = [
    ...serialized.matchAll(
      /([A-Za-z]:\/[^"\n]+?)(?:\s+lines\s+(\d+)-(\d+))/g,
    ),
  ].map(match => ({
    file: match[1].replaceAll('\\', '/').toLowerCase(),
    range: `${match[2]}:${match[3]}`,
  }))
  const uniqueFiles = new Set(sourceRanges.map(item => item.file))
  const uniqueSourceRanges = new Set(
    sourceRanges.map(item => `${item.file}:${item.range}`),
  )
  const metric = {
    finalMessageCount: captured.messages.length,
    boundedHistoryCount: messageText.includes(previousHistory) ? 1 : 0,
    serializedBytes,
    estimatedTokens,
    toolCount: captured.tools.length,
    contextReferenceCount: (systemText.match(/AGENTGRAPH CONTEXT REFERENCES \(1\)/g) || []).length,
    graphEvidenceCount: (systemText.match(/repository evidence:/g) || []).length,
    uniqueFiles: uniqueFiles.size,
    uniqueSourceRanges: uniqueSourceRanges.size,
    duplicateFileRangeCount:
      sourceRanges.length - uniqueSourceRanges.size,
    currentTaskCopies: (serialized.match(/CURRENT_TASK_SENTINEL/g) || [])
      .length,
    harnessInstructionCopies: (
      serialized.match(/HARNESS_INSTRUCTION_SENTINEL/g) || []
    ).length,
    promptSpecCopies: (serialized.match(/PromptSpec/g) || []).length,
    recursivePayloadCopies: (
      serialized.match(/PREVIOUS_PROVIDER_PAYLOAD/g) || []
    ).length,
    repeatedToolOutputCopies: (
      serialized.match(/REPEATED_TOOL_OUTPUT_SENTINEL/g) || []
    ).length,
  }

  assert.deepEqual(metric, {
    finalMessageCount: 2,
    boundedHistoryCount: 1,
    serializedBytes,
    estimatedTokens,
    toolCount: 0,
    contextReferenceCount: 1,
    graphEvidenceCount: 1,
    uniqueFiles: 1,
    uniqueSourceRanges: 1,
    duplicateFileRangeCount: 0,
    currentTaskCopies: 1,
    harnessInstructionCopies: 1,
    promptSpecCopies: 0,
    recursivePayloadCopies: 0,
    repeatedToolOutputCopies: 0,
  })
  assert.ok(serializedBytes < 32_000)
  assert.ok(estimatedTokens < 8_000)
  assert.doesNotMatch(serialized, /full repository|CodeGraph dump/i)
  console.log(`PROVIDER_PAYLOAD_PROOF ${JSON.stringify(metric)}`)
})

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

test('serializeProgressEvent preserves ordered Hermes text deltas without a proto change', () => {
  const deltas = ['one ', 'two ', 'three'].map((text, index) => serializeProgressEvent({
    type: 'progress',
    toolUseID: `child-delta-${index}`,
    parentToolUseID: 'hermes-agent-call',
    data: {
      type: 'agent_text_delta',
      agentId: 'agent-42',
      agentType: 'card_hermes_steward',
      text,
    },
  }))

  assert.equal(deltas.map(delta => JSON.parse(delta.data_json).text).join(''), 'one two three')
  assert.ok(deltas.every(delta => delta.parent_tool_use_id === 'hermes-agent-call'))
})

test('child model text crosses Agent progress normalization and gRPC JSON locally', () => {
  const data = agentTextDeltaProgress({ type: 'stream_event', event: {
    type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hermes live prose.' },
  } } as any, 'agent-42', 'card_hermes_steward')
  assert.ok(data)
  const progress = { type: 'progress', toolUseID: 'child-delta-1', parentToolUseID: 'hermes-agent-call', uuid: 'progress-1', data }
  assert.deepEqual([...normalizeMessage(progress as any)], [progress])
  const serialized = serializeProgressEvent(progress as any)
  assert.equal(serialized.parent_tool_use_id, 'hermes-agent-call')
  assert.deepEqual(JSON.parse(serialized.data_json), data)
})

test('a second request on the same stream is rejected while the native turn is active', () => {
  assert.deepEqual(concurrentRequestError(true), {
    message: 'A request is already in progress on this stream',
    code: 'ALREADY_EXISTS',
  })
  assert.equal(concurrentRequestError(false), null)
})

test('stream cancellation interrupts the active native QueryEngine exactly once', () => {
  let interruptCount = 0
  assert.equal(interruptActiveRequest({ interrupt: () => { interruptCount += 1 } }), true)
  assert.equal(interruptCount, 1)
  assert.equal(interruptActiveRequest(null), false)
  assert.equal(interruptCount, 1)
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

  const request = service.requestDeserialize(service.requestSerialize({
    request: { message: text, originating_run_id: 'main-turn-1' },
  }))
  assert.equal(request.request.message, text)
  assert.equal(request.request.originating_run_id, 'main-turn-1')

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

test('missingRequiredHarnessTools never requires card-owned graph tools', () => {
  assert.deepEqual(missingRequiredHarnessTools(REQUIRED_CONTROL_TOOLS), [])
})

test('missingRequiredHarnessTools reports each absent tool exactly', () => {
  assert.deepEqual(
    missingRequiredHarnessTools(['mcp__liquidaity__engraphis_recall']),
    [
      'mcp__liquidaity__card_run_assistant_agent',
      'mcp__liquidaity__mag_one_describe_connected_agents',
    ],
  )
  // Old bare names are NOT the real pool names — no alias, no translation.
  assert.deepEqual(
    missingRequiredHarnessTools(['card.run_assistant_agent', 'engraphis.recall']),
    REQUIRED_CONTROL_TOOLS,
  )
})

// The trusted card-run gate: a doorway child is forced onto its OWN bound card
// with server-injected session identity; anything else is denied. The model can
// neither pick another card nor forge project/conversation identity.
test('resolveCardRunControlCall forces the bound card and injects trusted identity', () => {
  const resolved = resolveCardRunControlCall({
    input: {
      cardId: 'card_saved_worker',
      input: 'do the task',
      projectId: 'forged',
      agentContextId: 'agentctx:forged',
      originatingAgentId: 'card_attacker',
      originatingRunId: 'forged-run',
    },
    agentType: 'card_saved_worker',
    cardIdByAgentType: new Map([['card_saved_worker', 'card_saved_worker']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
    originatingRunId: 'main-turn-1',
  })
  assert.ok('updatedInput' in resolved)
  assert.deepEqual((resolved as any).updatedInput, {
    input: 'do the task',
    cardId: 'card_saved_worker',
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
    originatingAgentId: 'card_saved_worker',
    originatingRunId: 'main-turn-1',
  })
})

test('resolveCardRunControlCall denies callers that are not a doorway child of this turn', () => {
  const parentCall = resolveCardRunControlCall({
    input: { cardId: 'card_saved_worker', input: 'task' },
    agentType: undefined,
    cardIdByAgentType: new Map([['card_saved_worker', 'card_saved_worker']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
    originatingRunId: 'main-turn-1',
  })
  assert.deepEqual(parentCall, { deny: 'card_run_requires_card_doorway_child' })

  const unknownChild = resolveCardRunControlCall({
    input: { input: 'task' },
    agentType: 'general-purpose',
    cardIdByAgentType: new Map([['card_saved_worker', 'card_saved_worker']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
    originatingRunId: 'main-turn-1',
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
    originatingRunId: 'main-turn-1',
    allowedCardRunIdsByAgentType: new Map([['card_hermes_steward', ['card_research_agent']]]),
  }
  const allowed = resolveCardRunControlCall({ ...base, input: { cardId: 'card_research_agent', input: 'research' } })
  assert.ok('updatedInput' in allowed)
  assert.equal((allowed as any).updatedInput.cardId, 'card_research_agent')
  assert.equal((allowed as any).updatedInput.originatingAgentId, 'card_hermes_steward')
  assert.equal((allowed as any).updatedInput.originatingRunId, 'main-turn-1')
  const rejected = resolveCardRunControlCall({ ...base, input: { cardId: 'card_local_coder', input: 'run' } })
  assert.deepEqual(rejected, { deny: 'card_run_target_not_authorized' })
})

test('resolveCardRunControlCall denies when the session identity is unavailable', () => {
  const resolved = resolveCardRunControlCall({
    input: { input: 'task' },
    agentType: 'card_saved_worker',
    cardIdByAgentType: new Map([['card_saved_worker', 'card_saved_worker']]),
    projectId: '',
    conversationId: '',
    correlationId: 'corr-42',
    originatingRunId: 'main-turn-1',
  })
  assert.deepEqual(resolved, { deny: 'card_run_session_identity_unavailable' })
})

test('resolveCardRunControlCall denies when the parent Harness turn identity is unavailable', () => {
  const resolved = resolveCardRunControlCall({
    input: { input: 'task' },
    agentType: 'card_saved_worker',
    cardIdByAgentType: new Map([['card_saved_worker', 'card_saved_worker']]),
    projectId: 'proj-1',
    conversationId: 'conv-main',
    correlationId: 'corr-42',
    originatingRunId: '',
  })
  assert.deepEqual(resolved, { deny: 'card_run_originating_run_identity_unavailable' })
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
        agent_type: 'card_saved_worker',
        system_prompt: 'Run the bound saved worker card.',
        allowed_tools: ['mcp__liquidaity__card_run_assistant_agent'],
      },
    ],
  })

  const loadedPool = [
    fakeMcpTool('mcp__liquidaity__card_run_assistant_agent'),
    fakeMcpTool('mcp__liquidaity__engraphis_recall'),
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
