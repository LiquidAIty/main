import { createHash } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import type { AgentConfig } from '../types/agentBuilder';
import {
  listAgentCards,
  saveAgentConfig as persistAgentConfig,
  getAgentConfig as fetchAgentConfig,
} from '../services/agentBuilderStore';
import { runLLM } from '../llm/client';
import { createOpenRouterEmbedding } from '../llm/openrouterEmbeddings';
import { captureProbability } from '../lib/receiptCapture';
import type { ResolvedAgentConfig } from '../services/resolveAgents';
import { getConfiguredPositiveInt, isDevTestModeEnabled } from '../services/devTest';
import { runAssistIngress } from '../services/orchestration/assistIngress';
import { ragSearchDirect } from '../tools/rag.search';
import type { UploadedFile } from './knowgraph.routes';
import type { KgEntity, KgRelationship } from './v2/chunking';
import type { CandidateEdge, KnowGraphGap, ResearchSearchTask, ThinkGraphTriplet } from '../services/research/types';

export const agentRoutes = Router();
const lastAssistantTextByProject = new Map<string, string>();
const BOSS_UPLOAD_MAX_FILE_SIZE_BYTES = Math.max(
  1_000_000,
  Number(
    process.env.BOSS_UPLOAD_MAX_FILE_SIZE_BYTES ||
      (isDevTestModeEnabled() ? 512 * 1024 * 1024 : 25 * 1024 * 1024),
  ),
);
function looksLikePdfUpload(file: { mimetype?: string; originalname?: string } | null | undefined): boolean {
  if (!file) return false;
  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  return fileName.endsWith('.pdf') || fileType === 'application/pdf' || fileType.includes('/pdf');
}
const bossUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: BOSS_UPLOAD_MAX_FILE_SIZE_BYTES,
    files: 1,
    parts: 12,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!looksLikePdfUpload(file)) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
      return;
    }
    cb(null, true);
  },
});
const bossUploadSingle = (req: any, res: any, next: any) => {
  bossUpload.single('file')(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Attached file exceeds the current upload size limit.'
          : 'Only a single PDF attachment is accepted on this route.';
      res.status(status).json({ ok: false, error: 'invalid_upload', message });
      return;
    }
    next(err);
  });
};
// DEV TEST LIMIT RAISED: keep more candidate edges during real document loop testing.
const TEMP_STABILIZATION_MAX_CANDIDATE_EDGES = getConfiguredPositiveInt(
  'LOOP_MAX_CANDIDATE_EDGES',
  isDevTestModeEnabled() ? 12 : 5,
);
// DEV TEST LIMIT RAISED: allow more KnowGraph gaps to trigger research on real projects.
const TEMP_STABILIZATION_MAX_GAPS_PER_TURN = getConfiguredPositiveInt(
  'LOOP_MAX_GAPS_PER_TURN',
  isDevTestModeEnabled() ? 10 : 3,
);
// DEV TEST LIMIT RAISED: keep more attention entities when building the research packet.
const TEMP_STABILIZATION_MAX_PRIORITY_ENTITIES = getConfiguredPositiveInt(
  'LOOP_MAX_PRIORITY_ENTITIES',
  isDevTestModeEnabled() ? 10 : 5,
);
// DEV TEST LIMIT RAISED: let reply synthesis see a deeper evidence bundle on real documents.
const TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES = getConfiguredPositiveInt(
  'LOOP_MAX_REPLY_EVIDENCE_NODES',
  isDevTestModeEnabled() ? 10 : 3,
);
// DEV TEST LIMIT RAISED: allow evidence from more source documents in the reply context.
const TEMP_STABILIZATION_MAX_REPLY_SOURCE_DOCS = getConfiguredPositiveInt(
  'LOOP_MAX_REPLY_SOURCE_DOCS',
  isDevTestModeEnabled() ? 6 : 2,
);
// DEV TEST LIMIT RAISED: scan more evidence rows before trimming the final reply bundle.
const TEMP_STABILIZATION_REPLY_QUERY_LIMIT = getConfiguredPositiveInt(
  'LOOP_REPLY_QUERY_LIMIT',
  isDevTestModeEnabled() ? 40 : 12,
);
const TEMP_STABILIZATION_REPLY_WEIGHTED_QUERY_LIMIT = getConfiguredPositiveInt(
  'LOOP_REPLY_WEIGHTED_QUERY_LIMIT',
  isDevTestModeEnabled() ? 32 : 10,
);
const TEMP_STABILIZATION_MAX_REPLY_GRAPH_FACTS = getConfiguredPositiveInt(
  'LOOP_MAX_REPLY_GRAPH_FACTS',
  isDevTestModeEnabled() ? 12 : 6,
);
// DEV TEST LIMIT RAISED: carry larger evidence snippets from real technical documents.
const TEMP_STABILIZATION_REPLY_SNIPPET_CHARS = getConfiguredPositiveInt(
  'LOOP_REPLY_SNIPPET_CHARS',
  isDevTestModeEnabled() ? 900 : 320,
);
const DEFAULT_REPLY_EMBED_MODEL =
  process.env.OPENROUTER_DEFAULT_EMBED_MODEL || 'openai/text-embedding-3-small';
const TEMP_STABILIZATION_STALE_EVIDENCE_DAYS = getConfiguredPositiveInt(
  'LOOP_STALE_EVIDENCE_DAYS',
  30,
);
const HEURISTIC_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'compare', 'does', 'evidence',
  'for', 'from', 'how', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'their',
  'this', 'time', 'to', 'use', 'using', 'what', 'with',
]);
const GAP_CONFLICT_RELATION_TYPES = new Set([
  'contradicts',
  'conflicts_with',
  'opposes',
  'disputes',
  'counterevidence',
]);

type RetrievedEvidence = {
  entityName: string;
  title: string;
  snippet: string;
  url: string;
  documentId: string;
  fetchedAt: string | null;
};

type RetrievedGraphFact = {
  entityA: string;
  relationshipType: string;
  entityB: string;
  confidence: number | null;
  documentId: string;
  sourceName: string;
  fetchedAt: string | null;
};

type RetrievedEvidenceBundle = {
  evidence: RetrievedEvidence[];
  graphFacts: RetrievedGraphFact[];
  mode: 'graph' | 'hybrid' | 'weighted_fallback' | 'disabled';
  weightedResults: number;
  graphResults: number;
};

type TurnIngestedDocument = {
  documentId: string;
  fileName: string;
};

type PlanWikiRewriteResult = {
  planWikiMarkdown: string;
  deltaSummary: string;
  status: 'draft' | 'grounded' | 'revised';
  whatChanged: string[];
  openQuestions: string[];
  sources: string[];
};

type StoredPlanWiki = {
  anchor: string;
  whatChanged: string[];
  openQuestions: string[];
  sources: string[];
  deltaSummary: string;
  status: 'draft' | 'grounded' | 'revised';
  updatedAt: string;
  turnId: string;
  lastUserMessage: string;
};

const TEMP_STABILIZATION_MAX_PLANWIKI_TRIPLETS = getConfiguredPositiveInt(
  'LOOP_MAX_PLANWIKI_TRIPLETS',
  isDevTestModeEnabled() ? 10 : 5,
);
const TEMP_STABILIZATION_MAX_PLANWIKI_FACTS = getConfiguredPositiveInt(
  'LOOP_MAX_PLANWIKI_FACTS',
  isDevTestModeEnabled() ? 10 : 5,
);
const TEMP_STABILIZATION_MAX_PLANWIKI_EVIDENCE = getConfiguredPositiveInt(
  'LOOP_MAX_PLANWIKI_EVIDENCE',
  isDevTestModeEnabled() ? 8 : 4,
);
const PLANWIKI_REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    planWikiMarkdown: { type: 'string' },
    deltaSummary: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'grounded', 'revised'] },
    whatChanged: {
      type: 'array',
      items: { type: 'string' },
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
    },
    sources: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['planWikiMarkdown', 'deltaSummary', 'status', 'whatChanged', 'openQuestions', 'sources'],
};

function normalizeRelationType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseTimestampMs(value: unknown): number | null {
  if (value == null) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

function normalizeHeuristicPhrase(value: string): string {
  return String(value || '')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// LEGACY boss-era helpers below are no longer part of the active orchestration path.
// The live `/api/agents/boss` ingress now delegates to `runAssistIngress`.

export function isPdfUpload(file: UploadedFile | null | undefined): boolean {
  if (!file) return false;
  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  return fileName.endsWith('.pdf') || fileType.includes('pdf');
}

export function buildAssistUploadDocumentId(
  projectId: string,
  turnId: string,
  file: UploadedFile,
  requestedDocumentId?: string | null,
): string {
  const explicit = String(requestedDocumentId || '').trim();
  if (explicit) return explicit;

  const fileHash = createHash('sha1').update(file.buffer).digest('hex').slice(0, 12);
  return `assist-upload:${projectId}:${turnId}:${fileHash}`;
}

function coerceStringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => String((entry as any)?.text ?? entry ?? '').trim())
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function tryParseJsonObject(text: string): any {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying looser extracts.
    }
  }
  return null;
}

export function extractExistingPlanWiki(plan: unknown): Partial<StoredPlanWiki> {
  if (typeof plan === 'string') {
    return {
      anchor: plan.trim(),
      whatChanged: [],
      openQuestions: [],
      sources: [],
      deltaSummary: '',
      status: 'draft',
    };
  }
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
  const obj = plan as any;
  const statusRaw = String(obj.status ?? '').trim().toLowerCase();
  return {
    anchor: String(
      obj.anchor ??
      obj.anchorText ??
      obj.anchor_text ??
      obj.planWiki ??
      obj.plan_wiki ??
      obj.memo ??
      obj.article ??
      obj.summary ??
      obj.body ??
      obj.text ??
      '',
    ).trim(),
    whatChanged: coerceStringList(obj.whatChanged ?? obj.what_changed ?? obj.recentChanges ?? obj.recent_changes),
    openQuestions: coerceStringList(obj.openQuestions ?? obj.open_questions ?? obj.unknowns ?? obj.questions),
    sources: coerceStringList(obj.sources),
    deltaSummary: String(obj.deltaSummary ?? obj.delta_summary ?? '').trim(),
    status:
      statusRaw === 'grounded' || statusRaw === 'revised'
        ? (statusRaw as StoredPlanWiki['status'])
        : 'draft',
  };
}

export function buildThinkGraphPlanWikiSummary(
  entities: KgEntity[],
  relationships: KgRelationship[],
  triplets: ThinkGraphTriplet[],
): Record<string, unknown> {
  return {
    entityCount: entities.length,
    relationshipCount: relationships.length,
    entities: entities
      .map((entity) => String(entity?.name || '').trim())
      .filter(Boolean)
      .slice(0, TEMP_STABILIZATION_MAX_PRIORITY_ENTITIES),
    triplets: triplets.slice(0, TEMP_STABILIZATION_MAX_PLANWIKI_TRIPLETS).map((triplet) => ({
      entityA: triplet.entityA,
      relationshipType: triplet.relationshipType,
      entityB: triplet.entityB,
      confidence: triplet.confidence ?? null,
      source: triplet.source ?? 'thinkgraph',
    })),
  };
}

export function buildKnowGraphPlanWikiSummary(
  graphFacts: RetrievedGraphFact[],
  evidence: RetrievedEvidence[],
  gaps: KnowGraphGap[],
  researchDocumentCount: number,
  ingestedDocuments: TurnIngestedDocument[],
): Record<string, unknown> {
  return {
    researchDocumentCount,
    ingestedDocuments: ingestedDocuments.map((item) => ({
      documentId: item.documentId,
      fileName: item.fileName,
    })),
    graphFacts: graphFacts.slice(0, TEMP_STABILIZATION_MAX_PLANWIKI_FACTS).map((fact) => ({
      entityA: fact.entityA,
      relationshipType: fact.relationshipType,
      entityB: fact.entityB,
      confidence: fact.confidence ?? null,
      sourceName: fact.sourceName,
      documentId: fact.documentId,
    })),
    evidence: evidence.slice(0, TEMP_STABILIZATION_MAX_PLANWIKI_EVIDENCE).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      documentId: item.documentId,
    })),
    gaps: gaps.slice(0, TEMP_STABILIZATION_MAX_GAPS_PER_TURN).map((gap) => ({
      entityA: gap.entityA,
      relationshipType: gap.relationshipType,
      entityB: gap.entityB,
      gapType: gap.gapType,
      priority: gap.priority,
      reason: gap.reason,
    })),
  };
}

function buildPlanWikiFallback(
  userText: string,
  priorAssistantText: string,
  previousPlanWiki: Partial<StoredPlanWiki>,
  thinkGraphSummary: Record<string, unknown>,
  knowGraphSummary: Record<string, unknown>,
): PlanWikiRewriteResult {
  const entities = Array.isArray(thinkGraphSummary.entities) ? thinkGraphSummary.entities as string[] : [];
  const triplets = Array.isArray(thinkGraphSummary.triplets) ? thinkGraphSummary.triplets as any[] : [];
  const graphFacts = Array.isArray(knowGraphSummary.graphFacts) ? knowGraphSummary.graphFacts as any[] : [];
  const evidence = Array.isArray(knowGraphSummary.evidence) ? knowGraphSummary.evidence as any[] : [];
  const gaps = Array.isArray(knowGraphSummary.gaps) ? knowGraphSummary.gaps as any[] : [];
  const sources = Array.from(new Set(
    [
      ...(previousPlanWiki.sources || []),
      ...evidence.map((item) => String(item?.title || item?.url || '').trim()),
      ...graphFacts.map((item) => String(item?.sourceName || item?.documentId || '').trim()),
    ].filter(Boolean),
  )).slice(0, TEMP_STABILIZATION_MAX_PLANWIKI_EVIDENCE);
  const status: PlanWikiRewriteResult['status'] =
    graphFacts.length > 0 || evidence.length > 0
      ? previousPlanWiki.anchor
        ? 'revised'
        : 'grounded'
      : previousPlanWiki.anchor
        ? 'revised'
        : 'draft';
  const whatChanged = [
    userText ? `The current user request is: ${userText}` : '',
    triplets.length > 0 ? `ThinkGraph attention is centered on ${triplets.length} entity/relationship triplets.` : '',
    evidence.length > 0 ? `KnowGraph retrieval produced ${evidence.length} supporting evidence excerpts.` : '',
    gaps.length > 0 ? `Open grounding gaps remain for ${gaps.length} candidate relationships.` : '',
  ].filter(Boolean).slice(0, 4);
  const openQuestions = gaps.length > 0
    ? gaps.map((gap) => String(gap?.reason || '').trim()).filter(Boolean).slice(0, 4)
    : previousPlanWiki.openQuestions?.slice(0, 4) || [];
  const currentTruths = [
    entities.length > 0 ? `ThinkGraph currently highlights: ${entities.slice(0, 6).join(', ')}.` : '',
    graphFacts.length > 0
      ? `Grounded graph context includes relationships such as ${graphFacts.slice(0, 3).map((fact) => `${fact.entityA} ${String(fact.relationshipType || '').replace(/_/g, ' ')} ${fact.entityB}`).join('; ')}.`
      : '',
    priorAssistantText ? `The previous assistant reply was steering toward: ${priorAssistantText}` : '',
  ].filter(Boolean);
  const planWikiMarkdown = [
    '# What this is',
    previousPlanWiki.anchor
      ? previousPlanWiki.anchor.split('\n\n')[0].replace(/^# .+$/gm, '').trim() || `This is the current working page for ${userText}.`
      : `This is the current working page for ${userText}.`,
    '',
    '# Current understanding',
    currentTruths.length > 0
      ? currentTruths.join('\n\n')
      : 'The current turn did not produce enough grounded context to sharpen the working understanding beyond the user request itself.',
    '',
    '# What changed this run',
    whatChanged.length > 0 ? whatChanged.map((item) => `- ${item}`).join('\n') : '- No material change was established this run.',
    '',
    '# Current direction',
    graphFacts.length > 0 || evidence.length > 0
      ? 'Use the newly grounded graph and research context to keep the working direction evidence-backed and narrow.'
      : 'Keep the direction provisional until stronger grounded evidence is available.',
    '',
    '# Open questions',
    openQuestions.length > 0 ? openQuestions.map((item) => `- ${item}`).join('\n') : '- No explicit open questions were extracted this run.',
    '',
    '# Next move',
    userText
      ? `Use the current request "${userText}" as the next concrete move, while preserving continuity from the prior anchor.`
      : 'Continue by grounding the next turn and rewriting this page with stronger evidence.',
  ].join('\n');

  return {
    planWikiMarkdown,
    deltaSummary: whatChanged[0] || 'The PlanWiki was refreshed to preserve continuity for the current turn.',
    status,
    whatChanged,
    openQuestions,
    sources,
  };
}

export async function rewriteAssistPlanWiki(input: {
  projectId: string;
  turnId: string;
  domain?: unknown;
  userText: string;
  priorAssistantText: string;
  finalAssistantText: string;
  previousPlanWiki: Partial<StoredPlanWiki>;
  thinkGraphSummary: Record<string, unknown>;
  knowGraphSummary: Record<string, unknown>;
  resolved: ResolvedAgentConfig;
}): Promise<PlanWikiRewriteResult> {
  const { projectId, turnId, domain, userText, priorAssistantText, finalAssistantText, previousPlanWiki, thinkGraphSummary, knowGraphSummary, resolved } = input;
  const promptPayload = {
    current_user_message: userText,
    previous_assistant_reply: priorAssistantText,
    previous_planwiki: previousPlanWiki.anchor || '',
    thinkgraph_summary: thinkGraphSummary,
    knowgraph_research_summary: knowGraphSummary,
    project_metadata: {
      projectId,
      turnId,
      domain: String(domain ?? 'general').trim() || 'general',
    },
    assistant_reply_generated_this_turn: finalAssistantText,
  };

  try {
    const llmRes = await runLLM(
      [
        'Rewrite the full PlanWiki for the current thing.',
        'The PlanWiki is the directional working page for the current project, idea, product, or topic being developed.',
        'It is rewritten in full each turn.',
        'Preserve continuity in meaning unless new context clearly changes it.',
        'Integrate new evidence explicitly.',
        'Do not invent unsupported facts.',
        'Do not add filler or vague fluff.',
        'Do not turn unresolved issues into false certainty.',
        'Keep the writing readable, compact, and useful.',
        'Write the full PlanWiki with exactly these markdown sections:',
        '# What this is',
        '# Current understanding',
        '# What changed this run',
        '# Current direction',
        '# Open questions',
        '# Next move',
        '',
        'Then return a short delta summary and a status label.',
        'Return JSON only.',
        '',
        'PlanWiki rewrite input:',
        JSON.stringify(promptPayload, null, 2),
      ].join('\n'),
      {
        modelKey: resolved.modelKey,
        provider: resolved.provider,
        providerModelId: resolved.providerModelId,
        temperature: Math.min(resolved.temperature ?? 0.2, 0.4),
        maxTokens: Math.min(resolved.maxTokens ?? 2200, 2600),
        useResponsesApi: resolved.provider === 'openai',
        jsonMode: resolved.provider !== 'openai',
        jsonSchema:
          resolved.provider === 'openai'
            ? { name: 'assist_planwiki_rewrite', schema: PLANWIKI_REWRITE_SCHEMA, strict: true }
            : undefined,
        system: [
          resolved.systemPrompt,
          'You rewrite the PlanWiki for the current thing.',
          'The PlanWiki is not a generic summary, not a fake PM form, and not motivational filler.',
          'It must preserve continuity, integrate grounded context, and leave a useful next move.',
          'Return only JSON.',
        ].filter(Boolean).join('\n\n'),
      },
    );
    const parsed = tryParseJsonObject(llmRes.text);
    const statusRaw = String(parsed?.status ?? '').trim().toLowerCase();
    const planWikiMarkdown = String(parsed?.planWikiMarkdown ?? '').trim();
    const deltaSummary = String(parsed?.deltaSummary ?? '').trim();
    if (!planWikiMarkdown || !deltaSummary) {
      throw new Error('planwiki_invalid_model_output');
    }
    return {
      planWikiMarkdown,
      deltaSummary,
      status:
        statusRaw === 'grounded' || statusRaw === 'revised'
          ? (statusRaw as PlanWikiRewriteResult['status'])
          : 'draft',
      whatChanged: coerceStringList(parsed?.whatChanged, 6),
      openQuestions: coerceStringList(parsed?.openQuestions, 6),
      sources: coerceStringList(parsed?.sources, 8),
    };
  } catch (error: any) {
    console.warn(
      '[PlanWiki] projectId=%s turnId=%s fallback=deterministic reason=%s',
      projectId,
      turnId,
      error?.message || String(error),
    );
    return buildPlanWikiFallback(
      userText,
      priorAssistantText,
      previousPlanWiki,
      thinkGraphSummary,
      knowGraphSummary,
    );
  }
}

function pickRecentEntityNames(userText: string, entities: KgEntity[], limit = 5): string[] {
  const loweredUserText = userText.toLowerCase();
  const ranked = entities
    .map((entity, index) => {
      const name = String(entity?.name || '').trim();
      return {
        name,
        lastIdx: name ? loweredUserText.lastIndexOf(name.toLowerCase()) : -1,
        index,
      };
    })
    .filter((entry) => entry.name);

  ranked.sort((a, b) => {
    if (a.lastIdx !== b.lastIdx) return b.lastIdx - a.lastIdx;
    return a.index - b.index;
  });

  return Array.from(new Set(ranked.map((entry) => entry.name))).slice(0, limit);
}

function extractFallbackEntityNames(userText: string): string[] {
  const text = String(userText || '').trim();
  if (!text) return [];
  const seen = new Set<string>();
  const candidates: Array<{ value: string; score: number }> = [];
  const pushCandidate = (raw: string) => {
    const value = normalizeHeuristicPhrase(raw);
    if (!value || value.length < 3) return;
    const lower = value.toLowerCase();
    if (seen.has(lower)) return;
    if (HEURISTIC_STOPWORDS.has(lower)) return;
    if (lower.split(' ').some((word) => HEURISTIC_STOPWORDS.has(word))) return;
    seen.add(lower);
    candidates.push({ value, score: text.toLowerCase().lastIndexOf(lower) });
  };

  for (const match of text.matchAll(/\b(?:[A-Z][a-z0-9]+(?:\s+[A-Za-z][a-z0-9-]+)*)\b/g)) {
    pushCandidate(match[0]);
  }

  const words = Array.from(text.matchAll(/[A-Za-z][A-Za-z0-9-]*/g)).map((match) => match[0]);
  for (let size = 3; size >= 2; size -= 1) {
    for (let i = 0; i <= words.length - size; i += 1) {
      const slice = words.slice(i, i + size);
      if (slice.some((word) => HEURISTIC_STOPWORDS.has(word.toLowerCase()) || word.length < 3)) continue;
      pushCandidate(slice.join(' '));
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length)
    .map((entry) => entry.value)
    .slice(0, 3);
}

export function buildCandidateEdges(userText: string, entities: KgEntity[], relationships: KgRelationship[]): CandidateEdge[] {
  const entityById = new Map(entities.map((entity) => [entity.id, String(entity.name || '').trim()]));
  const loweredUserText = userText.toLowerCase();
  const seen = new Set<string>();
  const edges: Array<CandidateEdge & { recency: number; order: number }> = [];

  relationships.forEach((relationship, order) => {
    const entityA = String(entityById.get(relationship.from) || relationship.from || '').trim();
    const entityB = String(entityById.get(relationship.to) || relationship.to || '').trim();
    const relationshipType = normalizeRelationType(relationship.type);
    if (!entityA || !entityB || !relationshipType) return;
    const key = `${entityA.toLowerCase()}::${relationshipType}::${entityB.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      entityA,
      relationshipType,
      entityB,
      confidence: typeof relationship.confidence === 'number' ? relationship.confidence : null,
      source: 'thinkgraph',
      recency: Math.max(
        loweredUserText.lastIndexOf(entityA.toLowerCase()),
        loweredUserText.lastIndexOf(entityB.toLowerCase()),
      ),
      order,
    });
  });

  if (!edges.length) {
    const recentEntities = pickRecentEntityNames(userText, entities, 2);
    const fallbackEntities =
      recentEntities.length >= 2 ? recentEntities : extractFallbackEntityNames(userText);
    if (recentEntities.length >= 2) {
      edges.push({
        entityA: recentEntities[0],
        relationshipType: 'related_to',
        entityB: recentEntities[1],
        confidence: 0.1,
        source: 'fallback',
        recency: Math.max(
          loweredUserText.lastIndexOf(recentEntities[0].toLowerCase()),
          loweredUserText.lastIndexOf(recentEntities[1].toLowerCase()),
        ),
        order: Number.MAX_SAFE_INTEGER,
      });
    } else if (fallbackEntities.length >= 2) {
      edges.push({
        entityA: fallbackEntities[0],
        relationshipType:
          loweredUserText.includes('compare') || loweredUserText.includes(' vs ')
            ? 'competes_with'
            : 'related_to',
        entityB: fallbackEntities[1],
        confidence: 0.1,
        source: 'fallback',
        recency: Math.max(
          loweredUserText.lastIndexOf(fallbackEntities[0].toLowerCase()),
          loweredUserText.lastIndexOf(fallbackEntities[1].toLowerCase()),
        ),
        order: Number.MAX_SAFE_INTEGER - 1,
      });
    }
  }

  return edges
    .sort((a, b) => {
      if (a.recency !== b.recency) return b.recency - a.recency;
      const aConfidence = typeof a.confidence === 'number' ? a.confidence : -1;
      const bConfidence = typeof b.confidence === 'number' ? b.confidence : -1;
      if (aConfidence !== bConfidence) return bConfidence - aConfidence;
      return a.order - b.order;
    })
    .slice(0, TEMP_STABILIZATION_MAX_CANDIDATE_EDGES)
    .map(({ recency: _recency, order: _order, ...edge }) => edge);
}

export function buildThinkGraphTriplets(candidateEdges: CandidateEdge[]): ThinkGraphTriplet[] {
  const seen = new Set<string>();
  const triplets: ThinkGraphTriplet[] = [];
  for (const edge of candidateEdges) {
    const entityA = String(edge.entityA || '').trim();
    const entityB = String(edge.entityB || '').trim();
    const relationshipType = normalizeRelationType(edge.relationshipType);
    if (!entityA || !entityB || !relationshipType) continue;
    const key = `${entityA.toLowerCase()}::${relationshipType}::${entityB.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    triplets.push({
      entityA,
      relationshipType,
      entityB,
      confidence: typeof edge.confidence === 'number' ? edge.confidence : null,
      source: edge.source || 'thinkgraph',
    });
    if (triplets.length >= TEMP_STABILIZATION_MAX_CANDIDATE_EDGES) break;
  }
  return triplets;
}

function humanizeResearchRelation(value: string): string {
  return normalizeRelationType(value).replace(/_/g, ' ').trim() || 'related to';
}

function inferResearchIntent(userText: string, edge: CandidateEdge | null): ResearchSearchTask['intent'] {
  const lowered = String(userText || '').toLowerCase();
  const relation = normalizeRelationType(edge?.relationshipType || '');
  if (lowered.includes('compare') || lowered.includes(' vs ') || relation.includes('compare') || relation.includes('compete')) {
    return 'compare';
  }
  if (lowered.includes('why') || lowered.includes('how') || relation.includes('cause') || relation.includes('explain')) {
    return 'explain';
  }
  return 'verify';
}

function buildResearchSearchTasks(
  userText: string,
  candidateEdges: CandidateEdge[],
  entityNames: string[],
): ResearchSearchTask[] {
  const seen = new Set<string>();
  const tasks: ResearchSearchTask[] = [];

  const pushTask = (
    query: string,
    priority: ResearchSearchTask['priority'],
    edge: CandidateEdge | null,
  ) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return;
    const key = normalizedQuery.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push({
      query: normalizedQuery,
      intent: inferResearchIntent(userText, edge),
      priority,
      gap: null,
      triplet: edge
        ? {
            entityA: edge.entityA,
            relationshipType: normalizeRelationType(edge.relationshipType),
            entityB: edge.entityB,
            confidence: typeof edge.confidence === 'number' ? edge.confidence : null,
            source: edge.source || 'thinkgraph',
          }
        : null,
    });
  };

  pushTask(userText, 'high', null);

  candidateEdges.forEach((edge) => {
    const relation = humanizeResearchRelation(edge.relationshipType);
    pushTask(`${edge.entityA} ${relation} ${edge.entityB}`.trim(), 'high', edge);
    pushTask(`${edge.entityA} ${edge.entityB} ${userText}`.trim(), 'medium', edge);
  });

  entityNames.forEach((entityName) => {
    pushTask(`${entityName} ${userText}`.trim(), 'medium', null);
  });

  return tasks.slice(0, TEMP_STABILIZATION_MAX_CANDIDATE_EDGES);
}

function buildResearchOpenQuestions(candidateEdges: CandidateEdge[]): string[] {
  return candidateEdges
    .slice(0, 4)
    .map((edge) => {
      const relation = humanizeResearchRelation(edge.relationshipType);
      return `What source-backed evidence supports ${edge.entityA} ${relation} ${edge.entityB}?`;
    });
}

export function buildDebugResearchPacket(
  projectId: string,
  turnId: string,
  userText: string,
  candidateEdges: CandidateEdge[],
  triplets: ThinkGraphTriplet[],
  entityNames: string[],
  gaps: KnowGraphGap[] = [],
) {
  const priorityRelationships = Array.from(
    new Set(candidateEdges.map((edge) => normalizeRelationType(edge.relationshipType)).filter(Boolean)),
  );
  const searchTasks = gaps.length > 0 ? [] : buildResearchSearchTasks(userText, candidateEdges, entityNames);

  return {
    projectId,
    turnId,
    query: userText,
    priorityEntities: entityNames,
    priorityRelationships,
    attentionEdges: candidateEdges,
    triplets,
    gaps,
    searchTasks,
    openQuestions: buildResearchOpenQuestions(candidateEdges),
  };
}

export async function openNeo4jSession(): Promise<{ driver: any; session: any } | null> {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !user || !password) {
    return null;
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = process.env.NEO4J_DATABASE || undefined;
  const session = driver.session(database ? { database } : undefined);
  return { driver, session };
}

async function fetchCandidateEdgeGap(
  session: any,
  projectId: string,
  edge: CandidateEdge,
): Promise<KnowGraphGap | null> {
  const params = {
    projectId,
    entityA: edge.entityA.toLowerCase(),
    entityB: edge.entityB.toLowerCase(),
    relationshipType: normalizeRelationType(edge.relationshipType),
    conflictTypes: Array.from(GAP_CONFLICT_RELATION_TYPES),
  };

  const endpointResult = await session.run(
    `
      MATCH (n)
      WHERE coalesce(n.project_id, '') = $projectId
        AND toLower(coalesce(n.name, '')) IN [$entityA, $entityB]
      RETURN
        count(DISTINCT CASE WHEN toLower(coalesce(n.name, '')) = $entityA THEN n END) AS a_nodes,
        count(DISTINCT CASE WHEN toLower(coalesce(n.name, '')) = $entityB THEN n END) AS b_nodes
    `,
    params,
  );
  const endpointRow = endpointResult.records[0];
  const entityANodes = Number(endpointRow?.get('a_nodes') || 0);
  const entityBNodes = Number(endpointRow?.get('b_nodes') || 0);

  const relationResult = await session.run(
    `
      MATCH (a)-[r]-(b)
      WHERE coalesce(a.project_id, '') = $projectId
        AND coalesce(b.project_id, '') = $projectId
        AND toLower(coalesce(a.name, '')) = $entityA
        AND toLower(coalesce(b.name, '')) = $entityB
      RETURN
        count(DISTINCT r) AS rel_count,
        count(DISTINCT CASE WHEN toLower(type(r)) = $relationshipType THEN r END) AS exact_rel_count,
        count(DISTINCT CASE WHEN toLower(type(r)) IN $conflictTypes THEN r END) AS conflict_rel_count,
        [relType IN collect(DISTINCT toLower(type(r))) WHERE relType IS NOT NULL][0..8] AS relation_types,
        max(coalesce(r.fetched_at, r.last_seen_ts, toString(r.updated_at), toString(r.created_at))) AS last_rel_ts
    `,
    params,
  );
  const relationRow = relationResult.records[0];
  const exactRelationCount = Number(relationRow?.get('exact_rel_count') || 0);
  const conflictRelationCount = Number(relationRow?.get('conflict_rel_count') || 0);
  const relationTypes = Array.isArray(relationRow?.get('relation_types'))
    ? (relationRow.get('relation_types') as string[]).map((value) => normalizeRelationType(value)).filter(Boolean)
    : [];
  const lastRelationTs = String(relationRow?.get('last_rel_ts') || '').trim() || null;

  const mentionResult = await session.run(
    `
      MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)
      WITH doc, chunk,
           EXISTS {
             MATCH (chunk)-[:MENTIONS]->(a)
             WHERE toLower(coalesce(a.name, '')) = $entityA
           } AS has_a,
           EXISTS {
             MATCH (chunk)-[:MENTIONS]->(b)
             WHERE toLower(coalesce(b.name, '')) = $entityB
           } AS has_b
      WHERE has_a AND has_b
      RETURN
        count(DISTINCT chunk) AS shared_chunk_count,
        count(DISTINCT doc) AS shared_doc_count,
        max(coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), toString(chunk.ingested_at))) AS last_doc_ts
    `,
    params,
  );
  const mentionRow = mentionResult.records[0];
  const sharedChunkCount = Number(mentionRow?.get('shared_chunk_count') || 0);
  const sharedDocCount = Number(mentionRow?.get('shared_doc_count') || 0);
  const lastDocTs = String(mentionRow?.get('last_doc_ts') || '').trim() || null;

  const evidenceCount = exactRelationCount + sharedDocCount;
  const lastEvidenceMs = parseTimestampMs(lastDocTs || lastRelationTs);
  const staleCutoffMs = Date.now() - TEMP_STABILIZATION_STALE_EVIDENCE_DAYS * 24 * 60 * 60 * 1000;
  const isStale = typeof lastEvidenceMs === 'number' && lastEvidenceMs < staleCutoffMs;

  if (conflictRelationCount > 0) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'conflict',
      evidenceCount,
      contradictionCount: conflictRelationCount,
      priority: 'high',
      reason: `conflicting relationship evidence already exists for ${edge.entityA} ${params.relationshipType} ${edge.entityB}`,
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  if (entityANodes === 0 || entityBNodes === 0) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'missing_evidence',
      evidenceCount,
      contradictionCount: 0,
      priority: 'high',
      reason:
        entityANodes === 0 && entityBNodes === 0
          ? 'both endpoint entities are missing from KnowGraph'
          : 'one endpoint entity is missing from KnowGraph',
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  if (exactRelationCount === 0 && sharedDocCount === 0 && sharedChunkCount === 0) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'missing_evidence',
      evidenceCount: 0,
      contradictionCount: 0,
      priority: 'high',
      reason: 'no KnowGraph relationship or co-mentioned evidence exists for this candidate edge',
      existingRelationTypes: relationTypes,
      lastEvidenceAt: null,
    };
  }

  if (isStale) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'stale_evidence',
      evidenceCount,
      contradictionCount: 0,
      priority: 'medium',
      reason: `supporting evidence is older than ${TEMP_STABILIZATION_STALE_EVIDENCE_DAYS} days`,
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  if (exactRelationCount === 0 || evidenceCount <= 1) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'weak_evidence',
      evidenceCount,
      contradictionCount: 0,
      priority: exactRelationCount === 0 ? 'high' : 'medium',
      reason:
        exactRelationCount === 0
          ? 'only indirect co-mention evidence exists for this edge'
          : 'supporting evidence for this edge is still weak',
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  return null;
}

function compareGapPriority(a: KnowGraphGap, b: KnowGraphGap) {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  if (rank[a.priority] !== rank[b.priority]) return rank[b.priority] - rank[a.priority];
  if (a.evidenceCount !== b.evidenceCount) return a.evidenceCount - b.evidenceCount;
  return a.reason.localeCompare(b.reason);
}

export async function checkKnowGraphGaps(
  session: any,
  projectId: string,
  candidateEdges: CandidateEdge[],
): Promise<KnowGraphGap[]> {
  const gaps: KnowGraphGap[] = [];
  for (const edge of candidateEdges) {
    try {
      const gap = await fetchCandidateEdgeGap(session, projectId, edge);
      if (!gap) continue;
      console.log('[Gap] %s %s %s -> %s', gap.entityA, gap.relationshipType, gap.entityB, gap.gapType);
      gaps.push(gap);
    } catch (err: any) {
      console.warn(
        '[KnowGraph] gap check failed for edge %s %s %s: %s',
        edge.entityA,
        edge.relationshipType,
        edge.entityB,
        err?.message || String(err),
      );
    }
  }
  return gaps.sort(compareGapPriority).slice(0, TEMP_STABILIZATION_MAX_GAPS_PER_TURN);
}

function appendEvidenceRows(
  rows: RetrievedEvidence[],
  kept: RetrievedEvidence[],
  seenDocs: Set<string>,
): void {
  for (const row of rows) {
    if (!row.snippet) continue;
    if (row.documentId) {
      if (!seenDocs.has(row.documentId) && seenDocs.size >= TEMP_STABILIZATION_MAX_REPLY_SOURCE_DOCS) continue;
      seenDocs.add(row.documentId);
    }
    kept.push(row);
    if (kept.length >= TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES) return;
  }
}

function appendGraphFacts(
  rows: RetrievedGraphFact[],
  kept: RetrievedGraphFact[],
  seenFacts: Set<string>,
): void {
  for (const row of rows) {
    if (!row.entityA || !row.entityB || !row.relationshipType) continue;
    const key = [
      row.entityA.toLowerCase(),
      normalizeRelationType(row.relationshipType),
      row.entityB.toLowerCase(),
      String(row.documentId || '').toLowerCase(),
    ].join('::');
    if (seenFacts.has(key)) continue;
    seenFacts.add(key);
    kept.push(row);
    if (kept.length >= TEMP_STABILIZATION_MAX_REPLY_GRAPH_FACTS) return;
  }
}

async function retrieveGraphFactsForTurn(
  session: any,
  projectId: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
): Promise<RetrievedGraphFact[]> {
  const kept: RetrievedGraphFact[] = [];
  const seenFacts = new Set<string>();

  if (attentionEdges.length > 0) {
    const edgeResult = await session.run(
      `
        UNWIND $edges AS edge
        MATCH (a)-[r]-(b)
        WHERE coalesce(a.project_id, '') = $projectId
          AND coalesce(b.project_id, '') = $projectId
          AND coalesce(r.project_id, '') = $projectId
          AND toLower(coalesce(a.name, '')) = edge.entity_a
          AND toLower(coalesce(b.name, '')) = edge.entity_b
        RETURN
          coalesce(a.name, '') AS entity_a,
          coalesce(r.r_type, type(r), 'related_to') AS relationship_type,
          coalesce(b.name, '') AS entity_b,
          coalesce(r.confidence, r.weight) AS confidence,
          coalesce(r.document_id, a.document_id, b.document_id, '') AS document_id,
          coalesce(r.source_name, a.source_name, b.source_name, '') AS source_name,
          coalesce(r.fetched_at, a.fetched_at, b.fetched_at, '') AS fetched_at
        ORDER BY coalesce(r.fetched_at, a.fetched_at, b.fetched_at, toString(r.created_at), toString(a.created_at)) DESC
        LIMIT toInteger($limit)
      `,
      {
        projectId,
        limit: TEMP_STABILIZATION_MAX_REPLY_GRAPH_FACTS,
        edges: attentionEdges.map((edge) => ({
          entity_a: edge.entityA.toLowerCase(),
          entity_b: edge.entityB.toLowerCase(),
        })),
      },
    );
    const mappedRows = edgeResult.records.map((record: any) => ({
      entityA: String(record.get('entity_a') || '').trim(),
      relationshipType: String(record.get('relationship_type') || '').trim(),
      entityB: String(record.get('entity_b') || '').trim(),
      confidence: Number.isFinite(Number(record.get('confidence'))) ? Number(record.get('confidence')) : null,
      documentId: String(record.get('document_id') || '').trim(),
      sourceName: String(record.get('source_name') || '').trim(),
      fetchedAt: String(record.get('fetched_at') || '').trim() || null,
    }));
    appendGraphFacts(mappedRows, kept, seenFacts);
  }

  if (kept.length < TEMP_STABILIZATION_MAX_REPLY_GRAPH_FACTS && entityNames.length > 0) {
    const entityResult = await session.run(
      `
        MATCH (a)-[r]-(b)
        WHERE coalesce(a.project_id, '') = $projectId
          AND coalesce(b.project_id, '') = $projectId
          AND coalesce(r.project_id, '') = $projectId
          AND toLower(coalesce(a.name, '')) IN $entityNames
        RETURN
          coalesce(a.name, '') AS entity_a,
          coalesce(r.r_type, type(r), 'related_to') AS relationship_type,
          coalesce(b.name, '') AS entity_b,
          coalesce(r.confidence, r.weight) AS confidence,
          coalesce(r.document_id, a.document_id, b.document_id, '') AS document_id,
          coalesce(r.source_name, a.source_name, b.source_name, '') AS source_name,
          coalesce(r.fetched_at, a.fetched_at, b.fetched_at, '') AS fetched_at
        ORDER BY coalesce(r.fetched_at, a.fetched_at, b.fetched_at, toString(r.created_at), toString(a.created_at)) DESC
        LIMIT toInteger($limit)
      `,
      {
        projectId,
        limit: TEMP_STABILIZATION_MAX_REPLY_GRAPH_FACTS,
        entityNames: entityNames.map((name) => name.toLowerCase()),
      },
    );
    const mappedRows = entityResult.records.map((record: any) => ({
      entityA: String(record.get('entity_a') || '').trim(),
      relationshipType: String(record.get('relationship_type') || '').trim(),
      entityB: String(record.get('entity_b') || '').trim(),
      confidence: Number.isFinite(Number(record.get('confidence'))) ? Number(record.get('confidence')) : null,
      documentId: String(record.get('document_id') || '').trim(),
      sourceName: String(record.get('source_name') || '').trim(),
      fetchedAt: String(record.get('fetched_at') || '').trim() || null,
    }));
    appendGraphFacts(mappedRows, kept, seenFacts);
  }

  return kept.slice(0, TEMP_STABILIZATION_MAX_REPLY_GRAPH_FACTS);
}

function buildWeightedEvidenceQuery(
  userMessage: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
): string {
  const parts = [
    String(userMessage || '').trim(),
    ...attentionEdges.slice(0, 4).map((edge) => `${edge.entityA} ${edge.relationshipType} ${edge.entityB}`.trim()),
    ...entityNames.slice(0, 4).map((name) => String(name || '').trim()),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(parts)).join('\n');
}

async function loadKnowGraphDocumentMeta(
  session: any,
  projectId: string,
  docIds: string[],
): Promise<Map<string, { title: string; url: string; fetchedAt: string | null }>> {
  const normalizedDocIds = Array.from(new Set(docIds.map((docId) => String(docId || '').trim()).filter(Boolean)));
  if (!normalizedDocIds.length) return new Map();

  const result = await session.run(
    `
      MATCH (doc:Document {project_id: $projectId})
      WHERE coalesce(doc.document_id, '') IN $docIds
      RETURN
        coalesce(doc.document_id, '') AS document_id,
        coalesce(doc.source_name, doc.title, doc.document_id, 'Untitled') AS title,
        coalesce(doc.source_url, '') AS url,
        coalesce(doc.fetched_at, toString(doc.ingested_at), '') AS fetched_at
    `,
    { projectId, docIds: normalizedDocIds },
  );

  const metaByDocId = new Map<string, { title: string; url: string; fetchedAt: string | null }>();
  result.records.forEach((record: any) => {
    const documentId = String(record.get('document_id') || '').trim();
    if (!documentId) return;
    metaByDocId.set(documentId, {
      title: String(record.get('title') || 'Untitled').trim(),
      url: String(record.get('url') || '').trim(),
      fetchedAt: String(record.get('fetched_at') || '').trim() || null,
    });
  });
  return metaByDocId;
}

async function retrieveWeightedSourceBackedEvidence(
  session: any,
  projectId: string,
  userMessage: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
): Promise<RetrievedEvidence[]> {
  const queryText = buildWeightedEvidenceQuery(userMessage, attentionEdges, entityNames);
  if (!queryText) return [];

  const embedding = await createOpenRouterEmbedding(queryText, DEFAULT_REPLY_EMBED_MODEL);
  const weighted = await ragSearchDirect(embedding, TEMP_STABILIZATION_REPLY_WEIGHTED_QUERY_LIMIT);
  const rows = Array.isArray((weighted as any)?.rows) ? ((weighted as any).rows as any[]) : [];
  if (!rows.length) return [];

  const docMeta = await loadKnowGraphDocumentMeta(
    session,
    projectId,
    rows.map((row) => String(row?.doc_id || '').trim()),
  );
  if (!docMeta.size) return [];

  return rows
    .map((row) => {
      const documentId = String(row?.doc_id || '').trim();
      const meta = docMeta.get(documentId);
      if (!meta) return null;
      const snippet = String(row?.chunk || '').trim().slice(0, TEMP_STABILIZATION_REPLY_SNIPPET_CHARS);
      if (!snippet) return null;
      const evidenceRow: RetrievedEvidence = {
        entityName: '',
        title: meta.title,
        snippet,
        url: meta.url,
        documentId,
        fetchedAt:
          meta.fetchedAt ||
          (String(row?.created_at || '').trim() || null),
      };
      return evidenceRow;
    })
    .filter((row): row is RetrievedEvidence => Boolean(row));
}

export async function retrieveKnowGraphEvidenceForTurn(
  session: any,
  projectId: string,
  userMessage: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
  turnId: string | null,
): Promise<RetrievedEvidenceBundle> {
  if (!projectId) {
    return {
      evidence: [],
      graphFacts: [],
      mode: 'disabled',
      weightedResults: 0,
      graphResults: 0,
    };
  }

  const kept: RetrievedEvidence[] = [];
  const graphFacts = await retrieveGraphFactsForTurn(session, projectId, attentionEdges, entityNames);
  const seenDocs = new Set<string>();
  let weightedResults = 0;
  let graphResults = graphFacts.length;

  if (attentionEdges.length > 0) {
    const edgeRowsResult = await session.run(
      `
        UNWIND $edges AS edge
        MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)
        WHERE EXISTS {
          MATCH (chunk)-[:MENTIONS]->(a)
          WHERE toLower(coalesce(a.name, '')) = edge.entity_a
        }
          AND EXISTS {
            MATCH (chunk)-[:MENTIONS]->(b)
            WHERE toLower(coalesce(b.name, '')) = edge.entity_b
          }
        RETURN
          edge.entity_a AS entity_name,
          coalesce(doc.source_name, doc.document_id, 'Untitled') AS title,
          left(coalesce(chunk.text, doc.snippet, ''), $snippetChars) AS snippet,
          coalesce(doc.source_url, chunk.source_url, '') AS url,
          coalesce(doc.document_id, '') AS document_id,
          coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') AS fetched_at
        ORDER BY coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') DESC
        LIMIT toInteger($queryLimit)
      `,
      {
        projectId,
        queryLimit: TEMP_STABILIZATION_REPLY_QUERY_LIMIT,
        snippetChars: TEMP_STABILIZATION_REPLY_SNIPPET_CHARS,
        edges: attentionEdges.map((edge) => ({
          entity_a: edge.entityA.toLowerCase(),
          entity_b: edge.entityB.toLowerCase(),
        })),
      },
    );
    const mappedRows = edgeRowsResult.records.map((record: any) => ({
        entityName: String(record.get('entity_name') || '').trim(),
        title: String(record.get('title') || 'Untitled').trim(),
        snippet: String(record.get('snippet') || '').trim(),
        url: String(record.get('url') || '').trim(),
        documentId: String(record.get('document_id') || '').trim(),
        fetchedAt: String(record.get('fetched_at') || '').trim() || null,
      }));
    graphResults += mappedRows.length;
    appendEvidenceRows(mappedRows, kept, seenDocs);
  }

  if (kept.length < TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES && entityNames.length > 0) {
    const entityResult = await session.run(
      `
        MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)-[:MENTIONS]->(entity)
        WHERE toLower(coalesce(entity.name, '')) IN $entityNames
        RETURN
          coalesce(entity.name, '') AS entity_name,
          coalesce(doc.source_name, doc.document_id, 'Untitled') AS title,
          left(coalesce(chunk.text, doc.snippet, ''), $snippetChars) AS snippet,
          coalesce(doc.source_url, chunk.source_url, entity.source_url, '') AS url,
          coalesce(doc.document_id, entity.document_id, '') AS document_id,
          coalesce(doc.fetched_at, chunk.fetched_at, entity.fetched_at, toString(doc.ingested_at), '') AS fetched_at
        ORDER BY coalesce(doc.fetched_at, chunk.fetched_at, entity.fetched_at, toString(doc.ingested_at), '') DESC
        LIMIT toInteger($queryLimit)
      `,
      {
        projectId,
        queryLimit: TEMP_STABILIZATION_REPLY_QUERY_LIMIT,
        snippetChars: TEMP_STABILIZATION_REPLY_SNIPPET_CHARS,
        entityNames: entityNames.map((name) => name.toLowerCase()),
      },
    );
    const mappedRows = entityResult.records.map((record: any) => ({
        entityName: String(record.get('entity_name') || '').trim(),
        title: String(record.get('title') || 'Untitled').trim(),
        snippet: String(record.get('snippet') || '').trim(),
        url: String(record.get('url') || '').trim(),
        documentId: String(record.get('document_id') || '').trim(),
        fetchedAt: String(record.get('fetched_at') || '').trim() || null,
      }));
    graphResults += mappedRows.length;
    appendEvidenceRows(mappedRows, kept, seenDocs);
  }

  if (kept.length < TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES && turnId) {
    const turnResult = await session.run(
      `
        MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)
        WHERE doc.document_id STARTS WITH $docPrefix
        RETURN
          '' AS entity_name,
          coalesce(doc.source_name, doc.document_id, 'Untitled') AS title,
          left(coalesce(chunk.text, doc.snippet, ''), $snippetChars) AS snippet,
          coalesce(doc.source_url, chunk.source_url, '') AS url,
          coalesce(doc.document_id, '') AS document_id,
          coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') AS fetched_at
        ORDER BY coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') DESC
        LIMIT toInteger($queryLimit)
      `,
      {
        projectId,
        docPrefix: `research:${turnId}`,
        queryLimit: TEMP_STABILIZATION_REPLY_QUERY_LIMIT,
        snippetChars: TEMP_STABILIZATION_REPLY_SNIPPET_CHARS,
      },
    );
    const mappedRows = turnResult.records.map((record: any) => ({
        entityName: String(record.get('entity_name') || '').trim(),
        title: String(record.get('title') || 'Untitled').trim(),
        snippet: String(record.get('snippet') || '').trim(),
        url: String(record.get('url') || '').trim(),
        documentId: String(record.get('document_id') || '').trim(),
        fetchedAt: String(record.get('fetched_at') || '').trim() || null,
      }));
    graphResults += mappedRows.length;
    appendEvidenceRows(mappedRows, kept, seenDocs);
  }

  const minGraphEvidenceRows = Math.min(2, TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES);
  const minGraphSourceDocs = Math.min(2, TEMP_STABILIZATION_MAX_REPLY_SOURCE_DOCS);
  const graphEvidenceWeak =
    graphResults === 0 ||
    kept.length < minGraphEvidenceRows ||
    seenDocs.size < minGraphSourceDocs;

  if (graphEvidenceWeak && kept.length < TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES) {
    try {
      const weightedRows = await retrieveWeightedSourceBackedEvidence(
        session,
        projectId,
        userMessage,
        attentionEdges,
        entityNames,
      );
      weightedResults = weightedRows.length;
      appendEvidenceRows(weightedRows, kept, seenDocs);
    } catch (err: any) {
      console.warn('[EvidenceRetrieval] weighted retrieval unavailable: %s', err?.message || String(err));
    }
  }

  const evidence = kept.slice(0, TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES);
  const mode: RetrievedEvidenceBundle['mode'] =
    graphResults > 0
      ? weightedResults > 0
        ? 'hybrid'
        : 'graph'
      : weightedResults > 0
        ? 'weighted_fallback'
        : 'graph';

  return {
    evidence,
    graphFacts,
    mode,
    weightedResults,
    graphResults,
  };
}

export function buildReplyContext(
  userMessage: string,
  previousResponseId: string | null,
  evidence: RetrievedEvidence[],
  graphFacts: RetrievedGraphFact[],
  ingestedDocuments: TurnIngestedDocument[] = [],
) {
  return {
    user_message: userMessage,
    previous_response_id: previousResponseId,
    ingested_documents: ingestedDocuments.map((item) => ({
      document_id: item.documentId,
      file_name: item.fileName,
    })),
    graph_context: graphFacts.map((item) => ({
      entity_a: item.entityA,
      relationship_type: item.relationshipType,
      entity_b: item.entityB,
      confidence: item.confidence,
      document_id: item.documentId,
      source_name: item.sourceName,
      fetched_at: item.fetchedAt,
    })),
    evidence: evidence.map((item) => ({
      source_title: item.title,
      snippet: item.snippet,
      url: item.url,
    })),
  };
}

agentRoutes.post('/boss', bossUploadSingle as any, async (req, res) => {
  const body = req.body || {};
  const { goal, query, q, message, prompt, domain } = body;
  const userText =
    [goal, query, q, message, prompt]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find(Boolean) || '';
  const attachedFile = ((req as any).file as UploadedFile | undefined) || null;

  if (!userText) {
    return res.status(400).json({
      ok: false,
      error: 'missing_goal',
      message: "Missing 'goal' (or 'query'/'q'/'message'/'prompt') in body",
    });
  }

  const project =
    (body.projectId || body.project_id || req.query?.projectId || req.query?.project_id || '').toString().trim();
  if (!project) {
    return res.status(400).json({ ok: false, error: 'missing_projectId', message: 'projectId required' });
  }

  const turnId =
    typeof body.turnId === 'string' && body.turnId.trim()
      ? body.turnId.trim()
      : `assist:${Date.now()}`;

  try {
    const result = await runAssistIngress({
      projectId: project,
      userText,
      domain,
      turnId,
      priorAssistantText: lastAssistantTextByProject.get(project) || '',
      attachedFile,
    });

    lastAssistantTextByProject.set(project, result.finalText);

    void captureProbability({
      projectId: project,
      outputText: result.finalText,
    }).catch((err) => console.error('[ASSIST_CHAT] probability capture failed:', err));

    return res.json({
      ok: true,
      projectId: result.projectId,
      domain: result.domain,
      result: { final: result.finalText },
      provider: result.session.modelProvider,
      model: result.session.providerModelId,
      session: result.session,
      orchestration: {
        stopReason: result.sidecar.stopReason ?? null,
        reportBackCount: result.sidecar.reportBacks.length,
        elapsedMs: result.sidecar.metrics.elapsedMs,
        turnsUsed: result.sidecar.metrics.turnsUsed,
        blackboardWriteCount: result.sidecar.metrics.blackboardWriteCount,
        searchTaskCount: result.sidecar.metrics.searchTaskCount,
        refinementApplied: result.sidecar.metrics.refinementApplied,
        researchStarted: result.researchStarted,
        researchError: result.researchError,
        ingestedDocuments: result.ingestedDocuments,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (
      lower.includes('assist_main_agent_missing') ||
      lower.includes('llm_chat_prompt_missing') ||
      lower.includes('llm_chat_model_missing') ||
      lower.includes('assist_main_prompt_missing')
    ) {
      return res.status(409).json({ ok: false, error: 'assist_main_agent_missing', message });
    }
    if (lower.includes('invalid_file_type')) {
      return res.status(400).json({ ok: false, error: 'invalid_file_type', message });
    }
    if (lower.includes('magentic_model_not_approved')) {
      return res.status(409).json({ ok: false, error: 'magentic_model_not_approved', message });
    }
    if (lower.includes('autogen_orchestrator_http_') || lower.includes('autogen_orchestrator_unreachable')) {
      return res.status(502).json({ ok: false, error: 'autogen_orchestrator_failed', message });
    }
    console.error('[ASSIST_CHAT] unexpected failure', error);
    return res.status(502).json({
      ok: false,
      error: 'assist_boss_failed',
      message,
    });
  }
});

agentRoutes.get('/cards', async (_req, res) => {
  try {
    const cards = await listAgentCards();
    return res.json(cards);
  } catch (error) {
    console.error('[AGENT] list cards failed', error);
    return res.status(500).json({ ok: false, error: 'list failed' });
  }
});

// Alias for project list (used by Agent Builder drawer)
agentRoutes.get('/projects', async (_req, res) => {
  try {
    console.log('[AGENT] /projects called');
    const cards = await listAgentCards();
    console.log('[AGENT] /projects success, returned', cards?.length || 0, 'cards');
    return res.json(cards);
  } catch (error: any) {
    console.error('[AGENT] list projects failed:', {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      stack: error?.stack,
    });
    return res.status(500).json({ 
      ok: false, 
      error: error?.message || 'list failed',
      details: {
        name: error?.name,
        code: error?.code,
      }
    });
  }
});

agentRoutes.post('/save', async (req, res) => {
  const cfg = req.body as AgentConfig;
  if (!cfg || typeof cfg.id !== 'string' || !cfg.id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  try {
    const saved = await persistAgentConfig(cfg);
    return res.json(saved);
  } catch (error: unknown) {
    console.error('[AGENT] save config failed', error);
    if (error instanceof Error) {
      console.error('[AGENT] save config failed stack:', error.stack);
    }
    return res.status(500).json({ ok: false, error: 'save failed' });
  }
});

agentRoutes.get('/:id', async (req, res) => {
  const projectId = req.params.id;
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  try {
    const config = await fetchAgentConfig(projectId);
    return res.json(config);
  } catch (error: unknown) {
    console.error('[AGENT] get config failed', error);
    if (error instanceof Error) {
      console.error('[AGENT] get config failed stack:', error.stack);
    }
    return res.status(500).json({ ok: false, error: 'load failed' });
  }
});
