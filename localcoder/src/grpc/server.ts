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

const PROTO_PATH = path.resolve(import.meta.dirname, '../proto/openclaude.proto')

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

/**
 * Translate a UserInput.reply (from the BuilderChat answer endpoint) into the
 * PermissionResult the runtime's canUseTool contract expects. Structured native
 * answers — an AskUserQuestion selection or an ExitPlanMode plan edit — travel as
 * a JSON object in the EXISTING `reply` string (no proto change) and are merged
 * into the model's original tool input as `updatedInput`, so the answer/edit
 * reaches the same running session. Plain yes/no approve/deny is preserved: only
 * an explicit "yes" or a structured approve allows; everything else denies.
 */
function interpretGrpcReply(
  reply: string,
  input: Record<string, unknown> | undefined,
):
  | { behavior: 'allow'; updatedInput?: any; userModified?: boolean }
  | { behavior: 'deny'; reason: string } {
  const trimmed = String(reply ?? '').trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'yes' || lower === 'y') {
    return { behavior: 'allow', updatedInput: input }
  }
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.behavior === 'deny' || parsed.approve === false) {
          return {
            behavior: 'deny',
            reason: typeof parsed.reason === 'string' ? parsed.reason : 'User denied via gRPC',
          }
        }
        // Merge patch: an explicit updatedInput, an AskUserQuestion `answers` map,
        // or a generic `patch` — merged over the model's original tool input.
        const patch =
          parsed.updatedInput && typeof parsed.updatedInput === 'object'
            ? parsed.updatedInput
            : parsed.answers && typeof parsed.answers === 'object'
              ? { answers: parsed.answers }
              : parsed.patch && typeof parsed.patch === 'object'
                ? parsed.patch
                : null
        const base = input && typeof input === 'object' ? input : {}
        return patch
          ? { behavior: 'allow', updatedInput: { ...base, ...patch }, userModified: true }
          : { behavior: 'allow', updatedInput: input, userModified: parsed.userModified === true }
      }
    } catch {
      /* not valid JSON — fall through to deny (preserves "deny unless yes") */
    }
  }
  return { behavior: 'deny', reason: 'User denied via gRPC' }
}

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
    this.server.bindAsync(
      `${host}:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (error, boundPort) => {
        if (error) {
          console.error('Failed to start gRPC server')
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
          if (mcpHostPath) {
            try {
              const conn = await connectToServer('liquidaity', {
                type: 'stdio',
                command: process.env.LIQUIDAITY_MCP_NODE || 'node',
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

          engine = new QueryEngine({
            cwd: req.working_directory || process.cwd(),
            tools: [...getTools(appState.toolPermissionContext), ...liquidAItyMcpTools], // base tools + LiquidAIty MCP tools
            commands: [], // Slash commands
            mcpClients: liquidAItyMcpClients,
            agents: [],
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
                  // Structured native answers / plan edits return via updatedInput
                  // to the same running session; plain yes/no still approve/deny.
                  resolve(interpretGrpcReply(reply, input as Record<string, unknown>))
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
