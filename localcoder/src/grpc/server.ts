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

// The one tool the official Python MCP host exposes for live, in-turn ThinkGraph
// writes (apps/python-models/app/mcp_host.py: thinkgraph.apply_live_patch).
// Qualified per the runtime's own MCP naming (mcp__<clientName>__<normalizedToolName>,
// see services/mcp/mcpStringUtils.ts) for the 'liquidaity' client this file connects —
// a fixed identity constant, not a name-translation mapper: the saved card grants
// this exact string directly, nothing here rewrites what the card says.
const THINKGRAPH_LIVE_WRITE_TOOL_NAME = 'mcp__liquidaity__thinkgraph_apply_live_patch'
const THINKGRAPH_LIVE_AUTHORITY_KIND = 'thinkgraph_live_agent_turn'
const THINKGRAPH_LIVE_AUTHORITY_TTL_SECONDS = 900

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
      return {
        agentType: String(c.agent_type),
        whenToUse: `Saved card agent (runtimeBinding=${String(c.runtime_binding || '')}).`,
        ...(allowedTools.length > 0 ? { tools: allowedTools } : {}),
        source: 'built-in',
        baseDir: 'built-in',
        ...(c.context_mode_inherit_parent ? { contextMode: 'inherit_parent' as const } : {}),
        getSystemPrompt: () => systemPrompt,
      }
    })
}

// Inverse of grpcChatClient.ts's deriveSessionId ("mag1:{projectId}:{conversationId}"),
// owned separately here since localcoder cannot import from apps/backend. Used only to
// mint the live ThinkGraph write authority below — never exposed to the model.
function parseSessionIdForLiveAuthority(sessionId: string): { projectId: string; conversationId: string } | null {
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

  constructor() {
    this.server = new grpc.Server()
    this.server.addService(openclaudeProto.AgentService.service, {
      Chat: this.handleChat.bind(this),
    })
  }

  start(port: number = 50051, host: string = 'localhost') {
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
    let appState: AppState = getDefaultAppState()
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

          // Load exactly ONE LiquidAIty MCP client (the separate host process that
          // bridges to backend authority) using the runtime's existing MCP
          // mechanism. Guarded: a failed/absent host degrades to no MCP, never a
          // crash. No parallel tool framework; no vendored-internal redesign.
          let liquidAItyMcpClients: MCPServerConnection[] = []
          let liquidAItyMcpTools: Tool[] = []
          const mcpHostPath = process.env.LIQUIDAITY_MCP_HOST
          const mcpCommand = process.env.LIQUIDAITY_MCP_NODE
          if (mcpHostPath && mcpCommand) {
            try {
              const conn = await connectToServer('liquidaity', {
                type: 'stdio',
                command: mcpCommand,
                args: [mcpHostPath],
              } as any)
              if (conn && conn.type === 'connected') {
                liquidAItyMcpClients = [conn]
                // Merge the MCP client's tools into the model's tool list so the
                // session can actually call them (connecting the client alone does
                // not surface its tools to the model).
                try {
                  liquidAItyMcpTools = await fetchToolsForClient(conn)
                } catch (toolErr) {
                  console.error('[grpc] liquidaity MCP tool fetch failed:', toolErr instanceof Error ? toolErr.message : toolErr)
                }
                console.log(`[grpc] liquidaity MCP client connected; mcpTools=${liquidAItyMcpTools.length}`)
              } else {
                console.error('[grpc] liquidaity MCP client not connected:', conn?.type)
              }
            } catch (err) {
              console.error('[grpc] liquidaity MCP client load failed:', err instanceof Error ? err.message : err)
            }
          }

          // Mint the live ThinkGraph write authority once per turn, at this trusted
          // server boundary — never chosen, forged, or reused by the model. Scoped to
          // the resolved ThinkGraph card's agentType for THIS turn only; a stale or
          // absent card resolution means no child exists to hold the write grant.
          const rawThinkGraphAgent = Array.isArray(req.agent_definitions) ? req.agent_definitions[0] : undefined
          const thinkGraphAgentType = rawThinkGraphAgent ? String(rawThinkGraphAgent.agent_type || '') : ''
          const sessionParts = parseSessionIdForLiveAuthority(sessionId)
          const liveAuthority = sessionParts && thinkGraphAgentType
            ? {
                kind: THINKGRAPH_LIVE_AUTHORITY_KIND,
                projectId: sessionParts.projectId,
                conversationId: sessionParts.conversationId,
                liveTurnId: randomUUID(),
                agentRunId: randomUUID(),
                writerCardId: String(rawThinkGraphAgent.card_id || ''),
                issuedAt: String(Date.now() / 1000),
                expiresAt: String(Date.now() / 1000 + THINKGRAPH_LIVE_AUTHORITY_TTL_SECONDS),
              }
            : null

          engine = new QueryEngine({
            cwd: req.working_directory || process.cwd(),
            tools: [...getTools(appState.toolPermissionContext), ...liquidAItyMcpTools], // base tools + LiquidAIty MCP tools
            commands: [], // Slash commands
            mcpClients: liquidAItyMcpClients,
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

              // The live ThinkGraph write grant belongs only to the resolved
              // ThinkGraph Agent child for this turn — never the main OpenClaude
              // Chat thread, never a different agent. No authority, no grant.
              if (tool.name === THINKGRAPH_LIVE_WRITE_TOOL_NAME) {
                if (!liveAuthority || context.agentType !== thinkGraphAgentType) {
                  return {
                    behavior: 'deny',
                    message: 'thinkgraph_live_write_requires_thinkgraph_agent_child',
                    decisionReason: { type: 'other', reason: 'thinkgraph_live_write_requires_thinkgraph_agent_child' },
                  }
                }
              }

              // Ask user for permission
              const promptId = randomUUID()
              const question = `Approve ${tool.name}?`
              call.write({
                action_required: {
                  prompt_id: promptId,
                  question,
                  type: 'CONFIRM_COMMAND'
                }
              })

              return new Promise((resolve) => {
                pendingRequests.set(promptId, (reply) => {
                  if (reply.toLowerCase() === 'yes' || reply.toLowerCase() === 'y') {
                    // Inject the trusted authority outside the model's visible
                    // arguments — the model supplied only the patch content.
                    if (tool.name === THINKGRAPH_LIVE_WRITE_TOOL_NAME && liveAuthority) {
                      resolve({
                        behavior: 'allow',
                        updatedInput: { ...(input as Record<string, unknown>), authority: liveAuthority },
                      })
                    } else {
                      resolve({ behavior: 'allow' })
                    }
                  } else {
                    resolve({ behavior: 'deny', reason: 'User denied via gRPC' })
                  }
                })
              })
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
