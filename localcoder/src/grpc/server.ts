import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { randomUUID } from 'crypto'
import { QueryEngine } from '../QueryEngine.js'
import { getTools } from '../tools.js'
import { connectToServer, fetchToolsForClient } from '../services/mcp/client.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Tool } from '../Tool.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { AppState } from '../state/AppState.js'
import { FileStateCache, READ_FILE_STATE_CACHE_SIZE } from '../utils/fileStateCache.js'
import type { BuiltInAgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

const PROTO_PATH = path.resolve(import.meta.dirname, '../proto/openclaude.proto')

// The bounded READ-ONLY ThinkGraph slice tool the official Python MCP host
// exposes (apps/python-models/app/mcp_host.py: thinkgraph.get_graph_slice),
// qualified per the runtime's own MCP naming (mcp__<clientName>__<normalizedToolName>,
// see services/mcp/mcpStringUtils.ts) for the 'liquidaity' client this server
// connects. There is NO model-facing graph-write tool: live ThinkGraph writes
// happen only inside a real configured ThinkGraph card run (card.run_assistant_agent
// → Python runConfiguredCard → the card's own scoped apply_thinkgraph_patch tool).
const THINKGRAPH_READ_TOOL_NAME = 'mcp__liquidaity__thinkgraph_get_graph_slice'
const MAG_ONE_DESCRIBE_TOOL_NAME = 'mcp__liquidaity__mag_one_describe_connected_agents'

// The one MCP control tool a card doorway child calls to run its bound saved
// card through the canonical Python executor (card.run_assistant_agent on the
// official Python MCP host, qualified per the runtime's own MCP naming).
const CARD_RUN_CONTROL_TOOL_NAME = 'mcp__liquidaity__card_run_assistant_agent'

/** Trusted identity resolution for a doorway child's card-run control call.
 * The model supplies only { cardId, input }; this forces the child's BOUND
 * card id and injects the real session identity — the model can neither pick
 * another card nor forge project/conversation identity. A caller that is not
 * one of this turn's doorway children is denied. Pure, directly testable. */
export function resolveCardRunControlCall(params: {
  input: Record<string, unknown>
  agentType: string | undefined
  cardIdByAgentType: Map<string, string>
  projectId: string
  conversationId: string
  correlationId: string
  /** Per-child ORANGE-edge authority (backend-resolved): extra saved card ids
   * this child may run beyond its own bound card. Absent = own card only. */
  allowedCardRunIdsByAgentType?: Map<string, string[]>
}): { deny: string } | { updatedInput: Record<string, unknown> } {
  const agentType = String(params.agentType || '')
  const boundCardId = agentType ? params.cardIdByAgentType.get(agentType) : undefined
  if (!boundCardId) return { deny: 'card_run_requires_card_doorway_child' }
  if (!params.projectId || !params.conversationId) {
    return { deny: 'card_run_session_identity_unavailable' }
  }
  const requestedCardId = String(params.input?.cardId || '').trim()
  let targetCardId = boundCardId
  if (requestedCardId && requestedCardId !== boundCardId) {
    const allowed = params.allowedCardRunIdsByAgentType?.get(agentType) || []
    if (!allowed.includes(requestedCardId)) {
      return { deny: 'card_run_target_not_authorized' }
    }
    targetCardId = requestedCardId
  }
  return {
    updatedInput: {
      ...params.input,
      cardId: targetCardId,
      projectId: params.projectId,
      conversationId: params.conversationId,
      correlationId: params.correlationId,
    },
  }
}

/** The official Python MCP host launch identity, resolved and file-validated by
 * scripts/start-grpc.ts from the real repo layout. No env vars, no .env. */
export type PythonMcpConfig = {
  serverName: string
  command: string
  hostPath: string
}

/** Fail-closed startup check: the control-surface tools the card architecture
 * depends on must exist in the actually-fetched Python MCP tool pool — the
 * card-run doorway tool, the bounded READ-ONLY ThinkGraph slice, and the live
 * Mag One roster read used by native Hermes. There is
 * no model-facing write tool to require. Pure so it is directly testable. */
export function missingRequiredHarnessTools(toolNames: string[]): string[] {
  const pool = new Set(toolNames)
  return [CARD_RUN_CONTROL_TOOL_NAME, THINKGRAPH_READ_TOOL_NAME, MAG_ONE_DESCRIBE_TOOL_NAME].filter(
    name => !pool.has(name),
  )
}

// Structural bridge only: turns the request's AgentDefinitionConfig entries
// (saved card id/prompt/tool-grants, carried verbatim over the wire — see
// openclaude.proto) into real native AgentDefinitions for this turn's
// QueryEngine. No graph data, no conversation text, no invented semantics —
// the saved card's own visible prompt and its own exact tool grants are the
// only content used. No bare-to-qualified compatibility mapping: the saved
// card must already grant the real, exact tool names the live MCP pool uses.
export function buildAgentDefinitionsFromRequest(req: any): BuiltInAgentDefinition[] {
  const configs = Array.isArray(req.agent_definitions) ? req.agent_definitions : []
  return configs
    .filter((c: any) => c && String(c.agent_type || '').trim() && String(c.system_prompt || '').trim())
    .map((c: any): BuiltInAgentDefinition => {
      const systemPrompt = String(c.system_prompt)
      const allowedTools = Array.isArray(c.allowed_tools) ? c.allowed_tools.map(String) : []
      // Parent-facing capability line: use the backend-authored when_to_use (which
      // states the sub-agent's REAL read/write capability) so the model delegates
      // correctly; fall back to the generic line only when absent.
      const whenToUse = String(c.when_to_use || '').trim()
        || `Saved card agent (runtimeBinding=${String(c.runtime_binding || '')}).`
      return {
        agentType: String(c.agent_type),
        whenToUse,
        ...(allowedTools.length > 0 ? { tools: allowedTools } : {}),
        ...(String(c.model || '').trim() ? { model: String(c.model) } : {}),
        source: 'built-in',
        baseDir: 'built-in',
        ...(c.context_mode_inherit_parent ? { contextMode: 'inherit_parent' as const } : {}),
        getSystemPrompt: () => systemPrompt,
      }
    })
}

/** Preserve the native QueryEngine progress union without cloning it into the
 * gRPC schema. JSON is lossless for the message data QueryEngine emits. */
export function serializeProgressEvent(message: any): {
  tool_use_id: string
  parent_tool_use_id: string
  data_json: string
} {
  return {
    tool_use_id: String(message?.toolUseID || ''),
    parent_tool_use_id: String(message?.parentToolUseID || ''),
    data_json: JSON.stringify(message?.data ?? null),
  }
}

// Inverse of grpcChatClient.ts's deriveSessionId ("mag1:{projectId}:{conversationId}"),
// owned separately here since localcoder cannot import from apps/backend. Used to
// recover the trusted projectId/conversationId this server injects into a doorway
// child's card-run control call — never exposed to the model.
function parseSessionIdParts(sessionId: string): { projectId: string; conversationId: string } | null {
  const parts = String(sessionId || '').split(':')
  if (parts.length < 3 || parts[0] !== 'mag1' || !parts[1]) return null
  return { projectId: parts[1], conversationId: parts.slice(2).join(':') }
}

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const openclaudeProto = protoDescriptor.openclaude.v1

const MAX_SESSIONS = 1000

export class GrpcServer {
  private server: grpc.Server
  private sessions: Map<string, any[]> = new Map()
  private pythonMcp: PythonMcpConfig
  // The one server-lifetime Python MCP connection + its fetched tool pool.
  // Established once in start() before the server binds; every chat turn and
  // every Agent child reuses these exact objects — no per-turn spawn, no
  // env-var wiring, no degraded no-MCP mode.
  private mcpClients: MCPServerConnection[] = []
  private mcpTools: Tool[] = []

  constructor(pythonMcp: PythonMcpConfig) {
    this.pythonMcp = pythonMcp
    this.server = new grpc.Server()
    this.server.addService(openclaudeProto.AgentService.service, {
      Chat: this.handleChat.bind(this),
    })
  }

  /** Connect the official Python MCP host for the server's lifetime. Any
   * failure (spawn, handshake, tool fetch, missing ThinkGraph tools) is one
   * exact fatal startup error — chat never starts against a broken registry. */
  private async connectOfficialPythonMcp(): Promise<void> {
    const { serverName, command, hostPath } = this.pythonMcp
    let connection: MCPServerConnection
    try {
      connection = await connectToServer(serverName, {
        type: 'stdio',
        command,
        args: [hostPath],
      } as any)
    } catch (err) {
      console.error(
        `gRPC Server: FATAL — official Python MCP host failed to connect: ${command} ${hostPath} — ${err instanceof Error ? err.message : err}`,
      )
      process.exit(1)
    }
    if (!connection || connection.type !== 'connected') {
      console.error(
        `gRPC Server: FATAL — official Python MCP host not connected (state=${connection?.type ?? 'none'}): ${command} ${hostPath}`,
      )
      process.exit(1)
    }
    let tools: Tool[]
    try {
      tools = await fetchToolsForClient(connection)
    } catch (err) {
      console.error(
        `gRPC Server: FATAL — official Python MCP tool fetch failed: ${err instanceof Error ? err.message : err}`,
      )
      process.exit(1)
    }
    const missing = missingRequiredHarnessTools(tools.map(t => t.name))
    if (missing.length > 0) {
      console.error(
        `gRPC Server: FATAL — Python MCP host connected but required Harness tools are missing: ${missing.join(', ')}`,
      )
      process.exit(1)
    }
    this.mcpClients = [connection]
    this.mcpTools = tools
    console.log(
      `gRPC Server: official Python MCP connected (${serverName}); tools=${tools.length}`,
    )
  }

  async start(port: number = 50051, host: string = 'localhost') {
    await this.connectOfficialPythonMcp()
    const bindTarget = `${host}:${port}`
    console.log(`gRPC Server: requesting bind on ${bindTarget}`)
    this.server.bindAsync(
      bindTarget,
      grpc.ServerCredentials.createInsecure(),
      (error, boundPort) => {
        if (error) {
          // bindAsync's error carries the real cause (e.g. address-in-use —
          // grpc-js resolves `host` to every matching address, IPv4 and IPv6,
          // and reports "No address added out of total N resolved" when none
          // of them could bind). Never swallow it behind a generic message —
          // a chat runtime that silently fails to bind is worse than a
          // process that exits loudly with the exact reason.
          console.error(
            `gRPC Server: FAILED to bind ${bindTarget} — code=${(error as any).code ?? 'unknown'} message=${error.message}`,
          )
          process.exit(1)
          return
        }
        console.log(`gRPC Server running at ${host}:${boundPort}`)
      }
    )
  }

  private handleChat(call: grpc.ServerDuplexStream<any, any>) {
    let engine: QueryEngine | null = null
    // The SAME server-lifetime Python MCP client/tool objects go into
    // AppState.mcp here, BEFORE any AgentTool call — the child worker pool is
    // assembled from appState.mcp.tools (AgentTool.tsx → assembleToolPool), so
    // this is what makes the saved card's exact tool grants resolvable.
    const defaults = getDefaultAppState()
    let appState: AppState = {
      ...defaults,
      mcp: { ...defaults.mcp, clients: this.mcpClients, tools: this.mcpTools },
    }
    const fileCache: FileStateCache = new FileStateCache(READ_FILE_STATE_CACHE_SIZE, 25 * 1024 * 1024)

    // To handle ActionRequired (ask user for permission)
    const pendingRequests = new Map<string, (reply: string) => void>()

    // Accumulated messages from previous turns for multi-turn context
    let previousMessages: any[] = []
    let sessionId = ''
    let interrupted = false

    call.on('data', async (clientMessage) => {
      try {
        if (clientMessage.request) {
          if (engine) {
            call.write({
              error: {
                message: 'A request is already in progress on this stream',
                code: 'ALREADY_EXISTS'
              }
            })
            return
          }
          interrupted = false
          const req = clientMessage.request
          sessionId = req.session_id || ''
          previousMessages = []

          // Load previous messages from session store (cross-stream persistence)
          if (sessionId && this.sessions.has(sessionId)) {
            previousMessages = [...this.sessions.get(sessionId)!]
          }

          const toolNameById = new Map<string, string>()

          // This turn's doorway children: agentType → bound saved card id. The
          // trusted card-run gate below forces each child to its own card and
          // injects the real session identity (projectId/conversationId).
          const rawAgentDefinitions: any[] = Array.isArray(req.agent_definitions) ? req.agent_definitions : []
          const cardIdByAgentType = new Map<string, string>(
            rawAgentDefinitions
              .filter((d: any) => String(d?.agent_type || '').trim() && String(d?.card_id || '').trim())
              .map((d: any) => [String(d.agent_type), String(d.card_id)]),
          )
          // ORANGE-edge card-run authority per child (backend-resolved).
          const allowedCardRunIdsByAgentType = new Map<string, string[]>(
            rawAgentDefinitions
              .filter((d: any) => String(d?.agent_type || '').trim() && Array.isArray(d?.allowed_card_run_ids))
              .map((d: any) => [String(d.agent_type), d.allowed_card_run_ids.map(String).filter(Boolean)]),
          )
          const sessionParts = parseSessionIdParts(sessionId)

          // The PARENT session's MCP surface = the saved parent card's Tools
          // selection (backend-sent). Empty list = full pool (back-compat).
          // Children still resolve their own allowed_tools from the full
          // server-lifetime pool via appState.mcp.tools.
          const parentAllowedMcpTools: string[] = Array.isArray(req.parent_allowed_mcp_tools)
            ? req.parent_allowed_mcp_tools.map(String).filter(Boolean)
            : []
          const parentMcpTools = parentAllowedMcpTools.length > 0
            ? this.mcpTools.filter(tool => parentAllowedMcpTools.includes(tool.name))
            : this.mcpTools

          engine = new QueryEngine({
            cwd: req.working_directory || process.cwd(),
            tools: [...getTools(appState.toolPermissionContext), ...parentMcpTools], // base tools + the parent's granted MCP tools
            commands: [], // Slash commands
            mcpClients: this.mcpClients,
            agents: buildAgentDefinitionsFromRequest(req),
            ...(typeof req.append_system_prompt === 'string' && req.append_system_prompt.trim()
              ? { appendSystemPrompt: req.append_system_prompt }
              : {}),
            ...(previousMessages.length > 0 ? { initialMessages: previousMessages } : {}),
            includePartialMessages: true,
            canUseTool: async (tool, input, context, assistantMsg, toolUseID) => {
              if (toolUseID) {
                toolNameById.set(toolUseID, tool.name)
              }
              // Notify client of the tool call first
              call.write({
                tool_start: {
                  tool_name: tool.name,
                  arguments_json: JSON.stringify(input),
                  tool_use_id: toolUseID
                }
              })

              // Card doorway control call: only one of this turn's doorway
              // children may call it, its bound card id is forced, and the real
              // session identity (projectId/conversationId) plus a fresh
              // correlationId are injected server-side — the model supplies only
              // the task. A parent/direct call is denied: in chat mode the
              // doorways ARE the only direct card surface.
              if (tool.name === CARD_RUN_CONTROL_TOOL_NAME) {
                const resolved = resolveCardRunControlCall({
                  input: input as Record<string, unknown>,
                  agentType: context.agentType,
                  cardIdByAgentType,
                  projectId: sessionParts?.projectId ?? '',
                  conversationId: sessionParts?.conversationId ?? '',
                  correlationId: randomUUID(),
                  allowedCardRunIdsByAgentType,
                })
                if ('deny' in resolved) {
                  return {
                    behavior: 'deny',
                    message: resolved.deny,
                    decisionReason: { type: 'other', reason: resolved.deny },
                  }
                }
                return { behavior: 'allow', updatedInput: resolved.updatedInput }
              }

              // No interactive human-confirmation gate: every other tool call is
              // allowed to proceed immediately. There is no model-facing
              // ThinkGraph write tool — live graph writes happen only inside the
              // configured ThinkGraph card run reached through the doorway above.
              return { behavior: 'allow' }
            },
            getAppState: () => appState,
            setAppState: (updater) => { appState = updater(appState) },
            readFileCache: fileCache,
            userSpecifiedModel: req.model,
            fallbackModel: req.model,
          })

          // Track accumulated response data for FinalResponse
          let fullText = ''
          let promptTokens = 0
          let completionTokens = 0

          const generator = engine.submitMessage(req.message)

          for await (const msg of generator) {
            if (msg.type === 'stream_event') {
              if (msg.event.type === 'content_block_delta' && msg.event.delta.type === 'text_delta') {
                call.write({
                  text_chunk: {
                    text: msg.event.delta.text
                  }
                })
                fullText += msg.event.delta.text
              }
            } else if (msg.type === 'progress') {
              call.write({ progress: serializeProgressEvent(msg) })
            } else if (msg.type === 'user') {
              // Extract tool results
              const content = msg.message.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    let outputStr = ''
                    if (typeof block.content === 'string') {
                      outputStr = block.content
                    } else if (Array.isArray(block.content)) {
                      outputStr = block.content.map(c => c.type === 'text' ? c.text : '').join('\n')
                    }
                    call.write({
                      tool_result: {
                        tool_name: toolNameById.get(block.tool_use_id) ?? block.tool_use_id,
                        tool_use_id: block.tool_use_id,
                        output: outputStr,
                        is_error: block.is_error || false
                      }
                    })
                  }
                }
              }
            } else if (msg.type === 'result') {
              // Extract real token counts and final text from the result
              if (msg.subtype === 'success') {
                if (msg.result) {
                  fullText = msg.result
                }
                promptTokens = msg.usage?.input_tokens ?? 0
                completionTokens = msg.usage?.output_tokens ?? 0
              }
            }
          }

          if (!interrupted) {
            // Save messages for multi-turn context in subsequent requests
            previousMessages = [...engine.getMessages()]

            // Persist to session store for cross-stream resumption
            if (sessionId) {
              if (!this.sessions.has(sessionId) && this.sessions.size >= MAX_SESSIONS) {
                // Evict oldest session (Map preserves insertion order)
                this.sessions.delete(this.sessions.keys().next().value)
              }
              this.sessions.set(sessionId, previousMessages)
            }

            call.write({
              done: {
                full_text: fullText,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens
              }
            })
          }

          engine = null

        } else if (clientMessage.input) {
          const promptId = clientMessage.input.prompt_id
          const reply = clientMessage.input.reply
          if (pendingRequests.has(promptId)) {
            pendingRequests.get(promptId)!(reply)
            pendingRequests.delete(promptId)
          }
        } else if (clientMessage.cancel) {
          interrupted = true
          if (engine) {
            engine.interrupt()
          }
          call.end()
        }
      } catch (err: any) {
        console.error('Error processing stream')
        call.write({
          error: {
            message: err.message || "Internal server error",
            code: "INTERNAL"
          }
        })
        call.end()
      }
    })

    call.on('end', () => {
      interrupted = true
      // Unblock any pending permission prompts so canUseTool can return
      for (const resolve of pendingRequests.values()) {
        resolve('no')
      }
      if (engine) {
        engine.interrupt()
      }
      engine = null
      pendingRequests.clear()
    })
  }
}
