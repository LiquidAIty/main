import { randomUUID } from 'crypto';

import { getProjectStateSnapshot, saveProjectState } from '../agentBuilderStore';
import { resolveAgentConfig } from '../resolveAgents';
import { runSidecarOrchestrator } from './autogenOrchestratorClient';
import type { BlackboardEntry, ContextPack, OrchestratorRunResponse, ProjectSession } from './contracts';
import { createEmptyV3Blackboard, mergeV3Blackboard, normalizeV3Blackboard } from '../../v3/blackboard';
import { getV3ProjectBlob, saveProjectBlackboard } from '../../v3/decks';
import type { V3Blackboard } from '../../v3/types';
import { proxyKnowgraphPdfIngest, type UploadedFile } from '../../routes/knowgraph.routes';
import { runKgChatTurnNow, runResearchPacketForProject } from '../../routes/v2/kg.routes';

// This ingress is not the planner of record. The intended product spine is PlanWiki -> Agent Graph -> Runtime -> Tool Layer -> Blackboard/Graphs.
type StoredPlanWiki = {
  anchor: string;
  whatChanged: string[];
  openQuestions: string[];
  sources: string[];
  deltaSummary: string;
  status: 'draft' | 'grounded' | 'revised';
};

type AssistIngressInput = {
  projectId: string;
  userText: string;
  domain?: unknown;
  turnId?: string | null;
  priorAssistantText?: string;
  attachedFile?: UploadedFile | null;
};

type TurnIngestedDocument = {
  documentId: string;
  fileName: string;
};

export type AssistIngressResult = {
  projectId: string;
  turnId: string;
  domain: string;
  finalText: string;
  session: ProjectSession;
  sidecar: OrchestratorRunResponse;
  ingestedDocuments: TurnIngestedDocument[];
  researchStarted: boolean;
  researchError: string | null;
};

function normalizeStringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean)),
  ).slice(0, limit);
}

function normalizeProjectMessages(
  value: unknown,
): Array<{ role: 'assistant' | 'user'; text: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry: any): { role: 'assistant' | 'user'; text: string } => ({
      role: entry?.role === 'assistant' ? 'assistant' : 'user',
      text: String(entry?.text ?? '').trim(),
    }))
    .filter((entry) => entry.text.length > 0);
}

function extractExistingPlanWiki(plan: unknown): StoredPlanWiki {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return {
      anchor: '',
      whatChanged: [],
      openQuestions: [],
      sources: [],
      deltaSummary: '',
      status: 'draft',
    };
  }
  const raw = plan as Record<string, unknown>;
  const statusRaw = String(raw.status ?? '').trim().toLowerCase();
  return {
    anchor: String(raw.anchor ?? '').trim(),
    whatChanged: normalizeStringList(raw.whatChanged),
    openQuestions: normalizeStringList(raw.openQuestions),
    sources: normalizeStringList(raw.sources),
    deltaSummary: String(raw.deltaSummary ?? '').trim(),
    status:
      statusRaw === 'grounded' || statusRaw === 'revised'
        ? (statusRaw as StoredPlanWiki['status'])
        : 'draft',
  };
}

function isPdfUpload(file: UploadedFile | null | undefined): boolean {
  if (!file) return false;
  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  return fileName.endsWith('.pdf') || fileType.includes('pdf');
}

function buildAssistUploadDocumentId(
  projectId: string,
  turnId: string,
  file: UploadedFile,
  requestedDocumentId?: string | null,
): string {
  const explicit = String(requestedDocumentId || '').trim();
  if (explicit) return explicit;
  return `assist-upload:${projectId}:${turnId}:${Buffer.from(file.buffer).toString('hex').slice(0, 12)}`;
}

function scalarFromEntry(entry: BlackboardEntry): string | null {
  if (typeof entry.valueText === 'string' && entry.valueText.trim()) return entry.valueText.trim();
  if (Array.isArray(entry.valueList) && entry.valueList.length) return String(entry.valueList[0] || '').trim() || null;
  return null;
}

function listFromEntry(entry: BlackboardEntry): string[] {
  if (Array.isArray(entry.valueList) && entry.valueList.length) {
    return Array.from(new Set(entry.valueList.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 8);
  }
  if (typeof entry.valueText === 'string' && entry.valueText.trim()) {
    return [entry.valueText.trim()];
  }
  return [];
}

function blackboardEntriesToWrite(entries: BlackboardEntry[]): V3Blackboard {
  const next = createEmptyV3Blackboard();
  for (const entry of entries) {
    switch (entry.field) {
      case 'current_goal':
      case 'next_move': {
        const text = scalarFromEntry(entry);
        if (!text) break;
        if (entry.field === 'current_goal') next.current_goal = text;
        if (entry.field === 'next_move') next.next_move = text;
        break;
      }
      case 'what_matters_now':
      case 'open_questions':
      case 'findings':
      case 'suggestions':
      case 'next_options': {
        const list = listFromEntry(entry);
        if (!list.length) break;
        (next as any)[entry.field] = list;
        break;
      }
      default:
        break;
    }
  }
  next.updated_at = new Date().toISOString();
  return next;
}

async function ingestAttachedPdf(
  projectId: string,
  turnId: string,
  file: UploadedFile | null | undefined,
): Promise<TurnIngestedDocument[]> {
  if (!file) return [];
  if (!isPdfUpload(file)) {
    throw new Error('invalid_file_type');
  }
  const assistDocumentId = buildAssistUploadDocumentId(projectId, turnId, file, null);
  const upstream = await proxyKnowgraphPdfIngest({
    projectId,
    documentId: assistDocumentId,
    file,
    route: '/api/agents/boss',
  });
  if (upstream.status >= 200 && upstream.status < 300 && upstream.data?.ok !== false) {
    const finalDocumentId = String(upstream.data?.document_id || assistDocumentId).trim() || assistDocumentId;
    return [
      {
        documentId: finalDocumentId,
        fileName: String(file.originalname || `${finalDocumentId}.pdf`),
      },
    ];
  }
  throw new Error(String(upstream.data?.error?.message || upstream.data?.message || 'pdf_ingest_failed'));
}

function buildContextPack(input: {
  session: ProjectSession;
  userText: string;
  priorAssistantText: string;
  systemPrompt: string;
  previousPlanWiki: StoredPlanWiki;
  blackboard: V3Blackboard;
  ingestedDocuments: TurnIngestedDocument[];
}): ContextPack {
  const openQuestions = Array.from(
    new Set([
      ...input.previousPlanWiki.openQuestions,
      ...normalizeV3Blackboard(input.blackboard).open_questions,
    ]),
  ).slice(0, 8);

  return {
    session: input.session,
    userText: input.userText,
    priorAssistantText: input.priorAssistantText,
    systemPrompt: input.systemPrompt,
    blackboard: normalizeV3Blackboard(input.blackboard),
    plan: {
      anchor: input.previousPlanWiki.anchor,
      whatChanged: input.previousPlanWiki.whatChanged,
      openQuestions: input.previousPlanWiki.openQuestions,
      sources: input.previousPlanWiki.sources,
      deltaSummary: input.previousPlanWiki.deltaSummary,
      status: input.previousPlanWiki.status,
    },
    thinkGraph: {
      priorityEntities: [],
      priorityRelationships: [],
      triplets: [],
      openQuestions,
    },
    knowGraph: {
      gaps: [],
      graphFacts: [],
      evidence: [],
      researchDocumentCount: 0,
    },
    attachments: input.ingestedDocuments,
    maxResearchTasks: 6,
  };
}

export async function runAssistIngress(input: AssistIngressInput): Promise<AssistIngressResult> {
  const resolved = await resolveAgentConfig(input.projectId, 'llm_chat', '/api/agents/boss');
  if (!resolved) {
    throw new Error('assist_main_agent_missing');
  }

  const turnId =
    typeof input.turnId === 'string' && input.turnId.trim()
      ? input.turnId.trim()
      : `assist:${Date.now()}`;
  const projectStateSnapshot = await getProjectStateSnapshot(input.projectId);
  const projectState = projectStateSnapshot.state;
  const previousPlanWiki = extractExistingPlanWiki(projectState.plan);

  let blackboard = createEmptyV3Blackboard();
  let blackboardRevision: string | null = null;
  try {
    const v3Blob = await getV3ProjectBlob(input.projectId);
    blackboard = normalizeV3Blackboard(v3Blob.blackboard);
    blackboardRevision = v3Blob.meta.blackboard.revision;
  } catch {
    blackboard = createEmptyV3Blackboard();
    blackboardRevision = null;
  }

  const ingestedDocuments = await ingestAttachedPdf(input.projectId, turnId, input.attachedFile);

  const session: ProjectSession = {
    sessionId: randomUUID(),
    projectId: input.projectId,
    turnId,
    route: '/api/agents/boss',
    orchestrator: 'magentic_one',
    modelProvider: resolved.provider,
    modelKey: resolved.modelKey,
    providerModelId: resolved.providerModelId,
    startedAt: new Date().toISOString(),
  };

  const contextPack = buildContextPack({
    session,
    userText: input.userText,
    priorAssistantText: input.priorAssistantText || '',
    systemPrompt: resolved.systemPrompt || '',
    previousPlanWiki,
    blackboard,
    ingestedDocuments,
  });

  const sidecar = await runSidecarOrchestrator(contextPack);
  const finalText = String(sidecar.finalResponseText || '').trim();
  if (!finalText) {
    throw new Error('empty_assistant_reply');
  }

  const mergedBlackboard = mergeV3Blackboard(
    blackboard,
    blackboardEntriesToWrite(sidecar.blackboardEntries),
    { userInput: input.userText },
  );
  const blackboardSave = await saveProjectBlackboard(input.projectId, mergedBlackboard, {
    expectedRevision: blackboardRevision,
    onConflict: 'return_current',
  });

  const existingPlanObject =
    projectState.plan && typeof projectState.plan === 'object' && !Array.isArray(projectState.plan)
      ? (projectState.plan as Record<string, unknown>)
      : {};
  const existingMessages = normalizeProjectMessages((projectState as any).messages);
  const nextMessages = [
    ...existingMessages,
    { role: 'user' as const, text: input.userText },
    { role: 'assistant' as const, text: finalText },
  ];
  const nextPlanState = {
    ...existingPlanObject,
    anchor: sidecar.plan.anchor,
    whatChanged: sidecar.plan.whatChanged,
    openQuestions: sidecar.plan.openQuestions,
    sources: sidecar.plan.sources,
    deltaSummary: sidecar.plan.deltaSummary,
    status: sidecar.plan.status,
    updatedAt: new Date().toISOString(),
    turnId,
    lastUserMessage: input.userText,
  };
  const stateSave = await saveProjectState(input.projectId, {
    ...projectState,
    messages: nextMessages,
    plan: nextPlanState,
  }, {
    expectedRevision: projectStateSnapshot.meta.revision,
    onConflict: 'return_current',
  });
  if (!blackboardSave.applied) {
    console.warn(
      '[ASSIST_INGRESS][blackboard] preserved newer truth projectId=%s turnId=%s',
      input.projectId,
      turnId,
    );
  }
  if (!stateSave.applied) {
    console.warn(
      '[ASSIST_INGRESS][builder_state] preserved newer truth projectId=%s turnId=%s',
      input.projectId,
      turnId,
    );
  }

  void runKgChatTurnNow({
    projectId: input.projectId,
    turnId,
    src: 'chat.auto',
    mode: 'assist',
    userText: input.userText,
    assistantText: finalText,
  }).catch((error: any) => {
    console.warn(
      '[ASSIST_INGRESS][ThinkGraph][adapter-only] projectId=%s turnId=%s failed: %s',
      input.projectId,
      turnId,
      error?.message || String(error),
    );
  });

  let researchStarted = false;
  let researchError: string | null = null;
  const searchTasks = Array.isArray(sidecar.knowGraph.searchTasks) ? sidecar.knowGraph.searchTasks : [];
  if (
    searchTasks.length ||
    sidecar.knowGraph.triplets.length ||
    sidecar.knowGraph.gaps.length ||
    sidecar.knowGraph.priorityEntities.length
  ) {
    researchStarted = true;
    void runResearchPacketForProject(
      input.projectId,
      {
        turnId,
        query: input.userText,
        priorityEntities: sidecar.knowGraph.priorityEntities,
        priorityRelationships: sidecar.knowGraph.priorityRelationships,
        triplets: sidecar.knowGraph.triplets,
        gaps: sidecar.knowGraph.gaps,
        searchTasks: sidecar.knowGraph.searchTasks,
        openQuestions: sidecar.knowGraph.openQuestions,
        maxResults: Math.max(1, Math.min(contextPack.maxResearchTasks, 6)),
      },
      turnId,
    ).catch((error: any) => {
      const message = error?.message || String(error);
      console.warn(
        '[ASSIST_INGRESS][KnowGraph][adapter-only] projectId=%s turnId=%s failed: %s',
        input.projectId,
        turnId,
        message,
      );
    });
  }

  return {
    projectId: input.projectId,
    turnId,
    domain: String(input.domain ?? 'general').trim() || 'general',
    finalText,
    session,
    sidecar,
    ingestedDocuments,
    researchStarted,
    researchError,
  };
}
