// Debug-only record of what the agent-builder / Mag One path actually SENT to the
// model rails for each run, plus a summary of what came back. This is observability,
// not a prompt mutation — it copies the assembled payload verbatim (truncated) and
// never logs secrets (the backend payload carries no API keys; those live only in the
// Python rails env). In-memory ring buffer; dev/debug surface only.

const MAX_PACKETS = 50;
const MAX_TEXT = 12000;

export type ModelCallPacketContext = {
  activeSurface?: string | null;
  workspaceRoot?: string | null;
  repoPath?: string | null;
  graphSource?: string | null;
  selectedObjectTitle?: string | null;
  availableCanvasAgents?: string[];
  excludedAgents?: string[];
};

export type ModelCallPacket = {
  callId: string;
  timestamp: string;
  route: string;
  projectId: string | null;
  deckRunId: string | null;
  cardId: string | null;
  provider: string;
  model: string;
  maxTokens: number | null;
  temperature: number | null;
  // What was sent
  systemPrompt: string;
  userInput: string;
  assembledContext: ModelCallPacketContext | null;
  availableAgents: string[];
  availableTools: string[];
  toolDefinitionsSentCount: number;
  outputContract: string;
  taskLedgerInstructionIncluded: boolean;
  planFlowTaskObjectsContractIncluded: boolean;
  thinkGraphIncluded: boolean;
  knowGraphIncluded: boolean;
  codeGraphIncluded: boolean;
  // What came back
  finalResponseText: string;
  finalResponseTextLength: number;
  autogenMessageCount: number;
  stopReason: string | null;
  taskLedgerArtifactPresent: boolean;
  planFlowTaskObjectsCount: number;
  tokenUsage: unknown | null;
  error: string | null;
  durationMs: number;
};

const packets: ModelCallPacket[] = [];

function clip(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[truncated ${text.length - MAX_TEXT} chars]` : text;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function recordModelCallPacket(packet: ModelCallPacket): void {
  packets.push(packet);
  if (packets.length > MAX_PACKETS) packets.splice(0, packets.length - MAX_PACKETS);
  // Compact, secret-free console summary so backend logs show the real call shape.
  console.log('[model-call-packet]', {
    callId: packet.callId,
    route: packet.route,
    projectId: packet.projectId,
    model: `${packet.provider}:${packet.model}`,
    agents: packet.availableAgents,
    tools: packet.availableTools.length,
    contractSent: packet.planFlowTaskObjectsContractIncluded,
    taskLedgerInstr: packet.taskLedgerInstructionIncluded,
    thinkGraph: packet.thinkGraphIncluded,
    knowGraph: packet.knowGraphIncluded,
    codeGraph: packet.codeGraphIncluded,
    finalLen: packet.finalResponseTextLength,
    artifact: packet.taskLedgerArtifactPresent,
    tasks: packet.planFlowTaskObjectsCount,
    error: packet.error,
    durationMs: packet.durationMs,
  });
}

export function getRecentModelCallPackets(options?: {
  projectId?: string | null;
  limit?: number;
}): ModelCallPacket[] {
  const projectId = options?.projectId ? String(options.projectId).trim() : '';
  const limit = Math.max(1, Math.min(MAX_PACKETS, options?.limit ?? 10));
  const filtered = projectId ? packets.filter((p) => p.projectId === projectId) : packets;
  return filtered.slice(-limit).reverse();
}

/**
 * Build a ModelCallPacket from the assembled Mag One payload and the rails response.
 * Pure extraction — never mutates the payload. Shows what was sent, not what the code
 * wishes it sent (e.g. thinkGraph/knowGraph flags reflect the actual payload).
 */
export function buildModelCallPacket(args: {
  route: string;
  projectId: string | null;
  payload: any;
  modelConfig: { provider?: string; providerModelId?: string; maxTokens?: number | null; temperature?: number | null };
  response: any | null;
  error: string | null;
  durationMs: number;
}): ModelCallPacket {
  const { payload, modelConfig, response, error } = args;
  const cardRuntime = payload?.cardRuntime || {};
  const participants: any[] = Array.isArray(cardRuntime.participants) ? cardRuntime.participants : [];
  const wctx = payload?.workspaceObjectContext || null;
  const outputContract = String(cardRuntime.taskLedgerOutputContract || '');
  const systemPrompt = String(cardRuntime.prompt || payload?.systemPrompt || '');
  const tools = Array.from(
    new Set(participants.flatMap((p) => asStringList(p?.tools))),
  );
  const artifact = response?.taskLedgerArtifact ?? null;
  const planFlowTaskObjects = Array.isArray(artifact?.planFlowTaskObjects)
    ? artifact.planFlowTaskObjects
    : [];
  const finalResponseText = String(response?.finalResponseText || '');

  return {
    callId: `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    route: args.route,
    projectId: args.projectId,
    deckRunId: String(payload?.session?.turnId || payload?.session?.sessionId || '') || null,
    cardId: String(cardRuntime.cardId || '') || null,
    provider: String(modelConfig.provider || ''),
    model: String(modelConfig.providerModelId || ''),
    maxTokens: typeof modelConfig.maxTokens === 'number' ? modelConfig.maxTokens : null,
    temperature: typeof modelConfig.temperature === 'number' ? modelConfig.temperature : null,
    systemPrompt: clip(systemPrompt),
    userInput: clip(payload?.userText || ''),
    assembledContext: wctx
      ? {
          activeSurface: wctx.activeSurface ?? null,
          workspaceRoot: wctx.workspaceRoot ?? null,
          repoPath: wctx.repoPath ?? null,
          graphSource: wctx.graphSource ?? null,
          selectedObjectTitle: wctx.selectedObjectTitle ?? null,
          availableCanvasAgents: asStringList(wctx.availableCanvasAgents),
          excludedAgents: asStringList(wctx.excludedAgents),
        }
      : null,
    availableAgents: participants
      .map((p) => String(p?.title || p?.cardId || '').trim())
      .filter(Boolean),
    availableTools: tools,
    // The backend lists tool ids per participant but does NOT send OpenAI function
    // definitions in this payload (the rails build tool-less AssistantAgents). So the
    // count of real function defs sent to the model from here is 0 — surfaced honestly.
    toolDefinitionsSentCount: 0,
    outputContract: clip(outputContract),
    taskLedgerInstructionIncluded: systemPrompt.trim().length > 0,
    planFlowTaskObjectsContractIncluded: outputContract.trim().length > 0,
    thinkGraphIncluded: Boolean(payload?.thinkGraph),
    knowGraphIncluded: Boolean(payload?.knowGraph),
    codeGraphIncluded: Boolean(wctx?.repoPath || wctx?.graphSource),
    finalResponseText: clip(finalResponseText),
    finalResponseTextLength: finalResponseText.length,
    autogenMessageCount: Array.isArray(response?.autogenMessages) ? response.autogenMessages.length : 0,
    stopReason: response?.stopReason ?? null,
    taskLedgerArtifactPresent: Boolean(artifact),
    planFlowTaskObjectsCount: planFlowTaskObjects.length,
    tokenUsage: response?.metrics ?? null,
    error: error ?? null,
    durationMs: args.durationMs,
  };
}
