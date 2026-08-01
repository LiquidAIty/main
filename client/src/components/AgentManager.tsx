import { useEffect, useMemo, useState } from 'react';

import type {
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  RuntimeBinding,
} from '../types/agentgraph';
import { GPT_CARD_MODEL_PRESETS } from '../features/agentbuilder/deck/deckPrimitives';
import {
  NativeThinkGraphSurface,
  type GraphProjectionV1,
} from './knowledge/NativeAuthorityGraphSurface';

type KnowledgeGraphLayer = 'agentgraph' | 'thinkgraph' | 'knowgraph' | 'codegraph';

type CardCapability = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  capability: {
    surface: 'knowledge' | 'tools' | 'system';
    capabilityType: 'callable_tool';
    graphAuthority: KnowledgeGraphLayer | null;
    authorityClass: string;
    runtimeCompatibility: string[];
    cardAssignable: boolean;
    latency: 'fast' | 'medium' | 'slow';
    providerPossible: boolean;
    health: string;
    recommendedUse: string;
    verification: string;
    approvalRequired: boolean;
    deprecated: boolean;
  };
};

type EffectiveCoderToolSnapshot = {
  authority: 'direct_main_audit' | 'mag_one_execution';
  permissionMode: 'plan' | 'acceptEdits';
  allowsShell: boolean;
  allowsWrite: boolean;
  allowsNetwork: boolean;
  hasPaidTools: boolean;
  unresolved: string[];
  counts: { saved: number; enabled: number; callable: number; unavailable: number };
  tools: Array<{
    canonicalName: string;
    runtimeName: string | null;
    displayName: string;
    description: string;
    source: string;
    group: string;
    risk: string;
    saved: boolean;
    enabled: boolean;
    callable: boolean;
    reason: string;
  }>;
};

const GRAPH_LAYER_LABELS: Record<KnowledgeGraphLayer, string> = {
  agentgraph: 'AgentGraph',
  thinkgraph: 'ThinkGraph',
  knowgraph: 'KnowGraph',
  codegraph: 'CodeGraph',
};

let cardCapabilityCatalogRequest: Promise<CardCapability[]> | null = null;

function loadCardCapabilityCatalog(): Promise<CardCapability[]> {
  if (!cardCapabilityCatalogRequest) {
    cardCapabilityCatalogRequest = fetch('/api/coder/tool-library')
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !Array.isArray(payload.tools)) {
          throw new Error(String(payload?.error || `Tool library unavailable (HTTP ${response.status})`));
        }
        return payload.tools as CardCapability[];
      })
      .catch((error) => {
        cardCapabilityCatalogRequest = null;
        throw error;
      });
  }
  return cardCapabilityCatalogRequest;
}

type AgentType =
  | 'agent_builder'
  | 'llm_chat'
  | 'kg_ingest'
  | 'knowgraph'
  | 'neo4j'
  | 'research_agent';

interface AgentManagerProps {
  projectId?: string;
  cardId?: string;
  agentType: AgentType;
  activeTab: string;
  promptPreviewPlanText?: string;
  onGraphRefresh?: () => void;
  onLastRun?: (lastRun: {
    agentType: AgentType;
    request: any;
    responseOrError: any;
    elapsedMs: number;
    provider?: string | null;
    model?: string | null;
    endpoint?: string | null;
    requestId?: string | null;
    finishReason?: string | null;
    usage?: any | null;
  }) => void;
  promptTestInput?: string;
  onChangePromptTestInput?: (value: string) => void;
  onRunPromptTest?: () => void;
  promptTestBusy?: boolean;
  promptTestDisabled?: boolean;
  localConfig?: AgentManagerLocalConfig | null;
  onSaveLocalConfig?: (config: AgentManagerLocalConfig) => void | Promise<void>;
  runContext?: AgentCardRunContext | null;
  runContextLoading?: boolean;
  runContextError?: string | null;
}

export type AgentCardRunContext = {
  assignment: {
    assignmentId: string;
    instructionId: string;
    instruction: string;
    state: string;
    correlationId: string;
    contextReferences: Array<{
      referenceId: string;
      referenceType: string;
      required: boolean;
    }>;
    result: {
      resultId: string;
      status: string;
      output?: string | null;
      summary?: string | null;
      errorCode?: string | null;
      errorDetail?: string | null;
      toolEvidence?: Array<Record<string, unknown>>;
    } | null;
    runTrace: {
      runtime?: string | null;
      provider?: string | null;
      modelKey?: string | null;
      providerModelId?: string | null;
      outcome?: string | null;
      state?: string | null;
      errorCode?: string | null;
    };
  } | null;
  deliveredContext: {
    projectionId: string;
    graphViews: Array<{
      viewId: string;
      displayLabel?: string;
      receivingRole?: string;
    }>;
    manifest: {
      manifestHash: string;
      records: Array<{
        authority: string;
        kind: 'node' | 'edge';
        nativeId: string;
        nativeRevision?: string | null;
        sourceId?: string | null;
        targetId?: string | null;
        predicate?: string | null;
        required: boolean;
        deliveryOrder: number;
        representation: string;
        representationHash: string;
        characters: number;
      }>;
      unresolvedReferences: Array<{
        referenceId: string;
        referenceType: string;
        required: boolean;
        reason: string;
      }>;
    };
  } | null;
};

function normalizeContextLayer(authority: string): KnowledgeGraphLayer | null {
  const normalized = String(authority || '').trim().toLowerCase();
  if (normalized === 'agentgraph' || normalized === 'graphview') return 'agentgraph';
  if (normalized === 'thinkgraph' || normalized === 'engraphis') return 'thinkgraph';
  if (normalized === 'knowgraph' || normalized === 'graphiti' || normalized === 'neo4j') return 'knowgraph';
  if (normalized === 'codegraph' || normalized === 'cbm') return 'codegraph';
  return null;
}

export function contextGraphLayers(runContext: AgentCardRunContext | null | undefined): KnowledgeGraphLayer[] {
  const layers = new Set<KnowledgeGraphLayer>();
  if (runContext?.assignment || runContext?.deliveredContext?.graphViews.length) {
    layers.add('agentgraph');
  }
  for (const record of runContext?.deliveredContext?.manifest.records || []) {
    const layer = normalizeContextLayer(record.authority);
    if (layer) layers.add(layer);
  }
  return (Object.keys(GRAPH_LAYER_LABELS) as KnowledgeGraphLayer[]).filter((layer) => layers.has(layer));
}

export function buildAssignmentContextProjection(
  runContext: AgentCardRunContext | null | undefined,
  projectId: string,
  visibleLayers: KnowledgeGraphLayer[],
): GraphProjectionV1 | null {
  const assignment = runContext?.assignment;
  const delivered = runContext?.deliveredContext;
  if (!assignment && !delivered) return null;

  const visible = new Set(visibleLayers);
  const nodes = new Map<string, GraphProjectionV1['nodes'][number]>();
  const edges = new Map<string, GraphProjectionV1['edges'][number]>();
  const assignmentNodeId = assignment ? `agentgraph:assignment:${assignment.assignmentId}` : null;

  if (assignment && assignmentNodeId && visible.has('agentgraph')) {
    nodes.set(assignmentNodeId, {
      id: assignmentNodeId,
      canonicalId: assignment.assignmentId,
      label: assignment.instruction,
      type: 'Assignment',
      authority: 'agentgraph',
      currentState: assignment.state,
      mentionCount: 1,
      properties: {
        assignmentId: assignment.assignmentId,
        correlationId: assignment.correlationId,
        state: assignment.state,
      },
    });
  }

  if (visible.has('agentgraph')) {
    for (const view of delivered?.graphViews || []) {
      const viewNodeId = `agentgraph:graphview:${view.viewId}`;
      nodes.set(viewNodeId, {
        id: viewNodeId,
        canonicalId: view.viewId,
        label: view.displayLabel || view.viewId,
        type: 'GraphView',
        authority: 'agentgraph',
        mentionCount: 1,
        properties: { receivingRole: view.receivingRole || null },
      });
      if (assignmentNodeId && nodes.has(assignmentNodeId)) {
        const edgeId = `${assignmentNodeId}:SELECTS:${viewNodeId}`;
        edges.set(edgeId, {
          id: edgeId,
          source: assignmentNodeId,
          target: viewNodeId,
          predicate: 'SELECTS_VIEW',
          mentionCount: 1,
        });
      }
    }
  }

  const nodeIdFor = (authority: string, nativeId: string) => `${authority}:${nativeId}`;
  for (const record of delivered?.manifest.records || []) {
    const layer = normalizeContextLayer(record.authority);
    if (!layer || !visible.has(layer) || record.kind !== 'node') continue;
    const nodeId = nodeIdFor(record.authority, record.nativeId);
    nodes.set(nodeId, {
      id: nodeId,
      canonicalId: record.nativeId,
      label: record.representation || record.nativeId,
      type: 'ContextRecord',
      authority: layer,
      mentionCount: 1,
      properties: {
        nativeRevision: record.nativeRevision || null,
        required: record.required,
        deliveryOrder: record.deliveryOrder,
        representation: record.representation,
      },
      provenance: { sourceAuthority: record.authority },
    });
    if (assignmentNodeId && nodes.has(assignmentNodeId)) {
      const edgeId = `${assignmentNodeId}:CONTEXT:${nodeId}`;
      edges.set(edgeId, {
        id: edgeId,
        source: assignmentNodeId,
        target: nodeId,
        predicate: 'DELIVERS_CONTEXT',
        mentionCount: 1,
      });
    }
  }

  for (const record of delivered?.manifest.records || []) {
    const layer = normalizeContextLayer(record.authority);
    if (!layer || !visible.has(layer) || record.kind !== 'edge') continue;
    const source = record.sourceId ? nodeIdFor(record.authority, record.sourceId) : null;
    const target = record.targetId ? nodeIdFor(record.authority, record.targetId) : null;
    if (!source || !target) continue;
    for (const [nodeId, nativeId] of [[source, record.sourceId], [target, record.targetId]] as const) {
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          canonicalId: nativeId || nodeId,
          label: nativeId || nodeId,
          type: 'ContextReference',
          authority: layer,
          mentionCount: 1,
          properties: { deliveredByEdge: record.nativeId },
        });
      }
    }
    edges.set(`${record.authority}:${record.nativeId}`, {
      id: `${record.authority}:${record.nativeId}`,
      source,
      target,
      predicate: record.predicate || 'RELATES_TO',
      mentionCount: 1,
      properties: {
        required: record.required,
        deliveryOrder: record.deliveryOrder,
        representation: record.representation,
      },
      provenance: { sourceAuthority: record.authority },
    });
  }

  return {
    schemaVersion: 'agentgraph.assignment-context.projection.v1',
    authority: 'agentgraph',
    projectId,
    revision: delivered?.manifest.manifestHash,
    counts: { nodes: nodes.size, edges: edges.size },
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

export type AgentManagerLocalConfig = {
  runtime_binding?: RuntimeBinding | null;
  runtime_type?: AgentCardRuntimeType | null;
  runtime_options?: AgentCardRuntimeOptions | null;
  parent_graph_id?: string | null;
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | '' | null;
  model_key?: string | null;
  temperature?: number | null;
  max_tokens?: number | null;
  prompt_template?: string | null;
  tools?: unknown[];
  knowledge_sources?: unknown[];
  response_format?: any | null;
};

function parsePromptTemplate(template: string): {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
} {
  if (!template || template.trim() === '') {
    return { role: '', goal: '', constraints: '', ioSchema: '', memoryPolicy: '' };
  }
  const normalizedTemplate = template.replace(/\r\n/g, '\n');

  if (!normalizedTemplate.includes('[ROLE]')) {
    return {
      role: template,
      goal: '',
      constraints: '',
      ioSchema: '',
      memoryPolicy: '',
    };
  }

  const parsed = {
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  };
  const tagRegex = /\[(ROLE|GOAL|CONSTRAINTS|IO_SCHEMA|MEMORY_POLICY)\]/gi;
  const tags: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(normalizedTemplate)) !== null) {
    tags.push({
      key: String(match[1] || '').toUpperCase(),
      start: match.index,
      end: tagRegex.lastIndex,
    });
  }
  for (let index = 0; index < tags.length; index += 1) {
    const current = tags[index];
    const next = tags[index + 1];
    const value = normalizedTemplate
      .slice(current.end, next ? next.start : normalizedTemplate.length)
      .trim();
    if (current.key === 'ROLE') parsed.role = value;
    else if (current.key === 'GOAL') parsed.goal = value;
    else if (current.key === 'CONSTRAINTS') parsed.constraints = value;
    else if (current.key === 'IO_SCHEMA') parsed.ioSchema = value;
    else if (current.key === 'MEMORY_POLICY') parsed.memoryPolicy = value;
  }

  return parsed;
}

function serializePromptFields(fields: {
  role: string;
  goal: string;
  constraints: string;
  ioSchema: string;
  memoryPolicy: string;
}): string {
  return `# LIQUIDAITY_PROMPT_V1
[ROLE]
${fields.role}

[GOAL]
${fields.goal}

[CONSTRAINTS]
${fields.constraints}

[IO_SCHEMA]
${fields.ioSchema}

[MEMORY_POLICY]
${fields.memoryPolicy}`;
}

function parseListText(value: string): string[] {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  } catch {
    // fall back to newline/comma parsing
  }
  return text
    .split(/[\r\n,]+/)
    .map((entry) => entry.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
}

function parseJsonValue(value: string): any | null {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function buildActiveAgentManagerLocalConfig(input: {
  runtimeBinding: RuntimeBinding | '';
  provider: 'openai' | 'openrouter' | '';
  modelKey: string;
  temperature: number | '';
  maxTokens: number | '';
  promptTemplate: string;
  toolsText: string;
  knowledgeText: string;
  responseFormatText: string;
}): AgentManagerLocalConfig {
  return {
    runtime_binding: input.runtimeBinding || null,
    provider: input.provider,
    model_key: input.modelKey || null,
    temperature: typeof input.temperature === 'number' ? input.temperature : null,
    max_tokens: typeof input.maxTokens === 'number' ? input.maxTokens : null,
    prompt_template: input.promptTemplate,
    tools: parseListText(input.toolsText),
    knowledge_sources: parseListText(input.knowledgeText),
    response_format: parseJsonValue(input.responseFormatText),
  };
}

export function AgentManager({
  projectId = '',
  cardId = '',
  activeTab,
  promptTestInput,
  onChangePromptTestInput,
  onRunPromptTest,
  promptTestBusy = false,
  promptTestDisabled = false,
  localConfig,
  onSaveLocalConfig,
  runContext,
  runContextLoading = false,
  runContextError = null,
}: AgentManagerProps) {
  const isLocalConfigMode = Boolean(localConfig && onSaveLocalConfig);
  const [runtimeBinding, setRuntimeBinding] = useState<RuntimeBinding | ''>('');
  const [provider, setProvider] = useState<'openai' | 'openrouter' | ''>('');
  const [modelKey, setModelKey] = useState('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [maxTokens, setMaxTokens] = useState<number | ''>('');
  const [promptText, setPromptText] = useState('');
  const [promptParts, setPromptParts] = useState({
    role: '',
    goal: '',
    constraints: '',
    ioSchema: '',
    memoryPolicy: '',
  });
  const [promptPartsTouched, setPromptPartsTouched] = useState(false);
  const [toolsText, setToolsText] = useState('');
  const [knowledgeText, setKnowledgeText] = useState('');
  const [responseFormatText, setResponseFormatText] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [capabilityCatalog, setCapabilityCatalog] = useState<CardCapability[]>([]);
  const [capabilityCatalogError, setCapabilityCatalogError] = useState<string | null>(null);
  const [capabilityCatalogLoading, setCapabilityCatalogLoading] = useState(true);
  const [knowledgeToolSearch, setKnowledgeToolSearch] = useState('');
  const [ordinaryToolSearch, setOrdinaryToolSearch] = useState('');
  const [visibleGraphLayers, setVisibleGraphLayers] = useState<KnowledgeGraphLayer[]>([]);
  const [coderAuthority, setCoderAuthority] = useState<'direct_main_audit' | 'mag_one_execution'>('direct_main_audit');
  const [effectiveToolSnapshot, setEffectiveToolSnapshot] = useState<EffectiveCoderToolSnapshot | null>(null);
  const [codexRuntimeState, setCodexRuntimeState] = useState<Record<string, unknown> | null>(null);
  const [codexSteerInput, setCodexSteerInput] = useState('');
  const [codexRuntimeBusy, setCodexRuntimeBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setCapabilityCatalogLoading(true);
    setCapabilityCatalogError(null);
    void loadCardCapabilityCatalog()
      .then((tools) => {
        if (!active) return;
        setCapabilityCatalog(tools);
        setCapabilityCatalogLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setCapabilityCatalog([]);
        setCapabilityCatalogError(error instanceof Error ? error.message : String(error));
        setCapabilityCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId || !cardId) {
      setEffectiveToolSnapshot(null);
      return;
    }
    let active = true;
    const params = new URLSearchParams({ projectId, cardId, authority: coderAuthority });
    void fetch(`/api/coder/tool-library?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok || !payload.snapshot) {
          throw new Error(String(payload?.error || `Effective tools unavailable (HTTP ${response.status})`));
        }
        if (active) setEffectiveToolSnapshot(payload.snapshot as EffectiveCoderToolSnapshot);
      })
      .catch((error) => {
        if (!active) return;
        setEffectiveToolSnapshot(null);
        setCapabilityCatalogError(error instanceof Error ? error.message : String(error));
      });
    return () => { active = false; };
  }, [projectId, cardId, coderAuthority]);

  useEffect(() => {
    if (!isLocalConfigMode || !localConfig) return;
    setRuntimeBinding(localConfig.runtime_binding || '');
    setProvider(
      localConfig.provider === 'openai' || localConfig.provider === 'openrouter'
        ? localConfig.provider
        : '',
    );
    setModelKey(localConfig.model_key || '');
    setTemperature(typeof localConfig.temperature === 'number' ? localConfig.temperature : '');
    setMaxTokens(typeof localConfig.max_tokens === 'number' ? localConfig.max_tokens : '');
    setPromptText(localConfig.prompt_template || '');
    setPromptParts(parsePromptTemplate(localConfig.prompt_template || ''));
    setPromptPartsTouched(false);
    setToolsText(
      Array.isArray(localConfig.tools)
        ? localConfig.tools
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
    setKnowledgeText(
      Array.isArray(localConfig.knowledge_sources)
        ? localConfig.knowledge_sources
            .filter((entry): entry is string => typeof entry === 'string')
            .join('\n')
        : '',
    );
    setResponseFormatText(
      localConfig.response_format ? JSON.stringify(localConfig.response_format, null, 2) : '',
    );
    setSaveMessage(null);
  }, [isLocalConfigMode, localConfig]);

  const availableGraphLayers = useMemo(() => contextGraphLayers(runContext), [runContext]);
  const availableGraphLayerKey = availableGraphLayers.join('|');

  useEffect(() => {
    setVisibleGraphLayers(
      availableGraphLayerKey
        ? availableGraphLayerKey.split('|') as KnowledgeGraphLayer[]
        : [],
    );
  }, [availableGraphLayerKey]);

  const savedTools = useMemo(() => parseListText(toolsText), [toolsText]);
  const capabilityByName = useMemo(
    () => new Map(capabilityCatalog.map((tool) => [tool.name, tool])),
    [capabilityCatalog],
  );
  const selectedKnowledgeTools = useMemo(
    () => savedTools.filter((name) => capabilityByName.get(name)?.capability.surface === 'knowledge'),
    [capabilityByName, savedTools],
  );
  const selectedOrdinaryTools = useMemo(
    () => savedTools.filter((name) => capabilityByName.get(name)?.capability.surface !== 'knowledge'),
    [capabilityByName, savedTools],
  );
  const knowledgeToolChoices = useMemo(() => {
    const query = knowledgeToolSearch.trim().toLowerCase();
    return capabilityCatalog
      .filter((tool) => tool.capability.cardAssignable && tool.capability.surface === 'knowledge')
      .filter((tool) => !savedTools.includes(tool.name))
      .filter((tool) => !query || `${tool.name} ${tool.title || ''} ${tool.description || ''}`.toLowerCase().includes(query))
      .slice(0, 20);
  }, [capabilityCatalog, knowledgeToolSearch, savedTools]);
  const ordinaryToolChoices = useMemo(() => {
    const query = ordinaryToolSearch.trim().toLowerCase();
    return capabilityCatalog
      .filter((tool) => tool.capability.cardAssignable && tool.capability.surface === 'tools')
      .filter((tool) => !savedTools.includes(tool.name))
      .filter((tool) => !query || `${tool.name} ${tool.title || ''} ${tool.description || ''}`.toLowerCase().includes(query))
      .slice(0, 20);
  }, [capabilityCatalog, ordinaryToolSearch, savedTools]);
  const contextProjection = useMemo(
    () => buildAssignmentContextProjection(runContext, projectId, visibleGraphLayers),
    [projectId, runContext, visibleGraphLayers],
  );

  const addSavedTool = (name: string) => {
    if (savedTools.includes(name)) return;
    setToolsText([...savedTools, name].join('\n'));
    setSaveMessage(null);
  };

  const removeSavedTool = (name: string) => {
    setToolsText(savedTools.filter((tool) => tool !== name).join('\n'));
    setSaveMessage(null);
  };

  const moveSavedTool = (name: string, direction: -1 | 1) => {
    const index = savedTools.indexOf(name);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= savedTools.length) return;
    const next = [...savedTools];
    [next[index], next[target]] = [next[target], next[index]];
    setToolsText(next.join('\n'));
    setSaveMessage(null);
  };

  const callCodexCard = async (operation: 'inspect' | 'start' | 'stop' | 'steer') => {
    if (!cardId || !projectId) return;
    setCodexRuntimeBusy(true);
    try {
      const isInspect = operation === 'inspect';
      const response = await fetch(`/api/coder/codex-app-server/cards/${encodeURIComponent(cardId)}/${operation}${isInspect ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {
        method: isInspect ? 'GET' : 'POST',
        headers: isInspect ? undefined : { 'Content-Type': 'application/json' },
        body: isInspect ? undefined : JSON.stringify({
          projectId,
          ...(operation === 'start' ? { assignment: promptTestInput || 'Inspect the assigned repository question and report the result.' } : {}),
          ...(operation === 'steer' ? { input: codexSteerInput } : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      setCodexRuntimeState(payload || { ok: false, error: `HTTP ${response.status}` });
      if (response.ok && operation === 'steer') setCodexSteerInput('');
    } finally {
      setCodexRuntimeBusy(false);
    }
  };

  const save = () => {
    if (!onSaveLocalConfig) return;
    const editedConfig = buildActiveAgentManagerLocalConfig({
        runtimeBinding,
        provider,
        modelKey,
        temperature,
        maxTokens,
        promptTemplate: promptPartsTouched ? serializePromptFields(promptParts) : promptText,
        toolsText,
        knowledgeText,
        responseFormatText,
      });
    void onSaveLocalConfig({
      ...localConfig,
      ...editedConfig,
      provider:
        provider ||
        (localConfig?.provider === 'local_openai_compatible'
          ? 'local_openai_compatible'
          : editedConfig.provider),
    });
    setSaveMessage('Saved.');
  };

  const sectionBody = (() => {
    if (activeTab === 'Prompt') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Role
            </label>
            <textarea
              value={promptParts.role}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, role: event.target.value }));
                setPromptPartsTouched(true);
                setSaveMessage(null);
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Goal
            </label>
            <textarea
              value={promptParts.goal}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, goal: event.target.value }));
                setPromptPartsTouched(true);
                setSaveMessage(null);
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Constraints
            </label>
            <textarea
              value={promptParts.constraints}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, constraints: event.target.value }));
                setPromptPartsTouched(true);
                setSaveMessage(null);
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              IO Schema
            </label>
            <textarea
              value={promptParts.ioSchema}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, ioSchema: event.target.value }));
                setPromptPartsTouched(true);
                setSaveMessage(null);
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
              Memory Policy
            </label>
            <textarea
              value={promptParts.memoryPolicy}
              onChange={(event) => {
                setPromptParts((current) => ({ ...current, memoryPolicy: event.target.value }));
                setPromptPartsTouched(true);
                setSaveMessage(null);
              }}
              rows={5}
              style={{
                width: '100%',
                padding: 10,
                background: '#2B2B2B',
                color: '#FFF',
                border: '1px solid #3A3A3A',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontSize: 13,
                resize: 'vertical',
              }}
            />
          </div>

          {onChangePromptTestInput && onRunPromptTest && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <label style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
                Test Input
              </label>
              <textarea
                value={promptTestInput || ''}
                onChange={(event) => onChangePromptTestInput(event.target.value)}
                rows={6}
                style={{
                  width: '100%',
                  padding: 10,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  resize: 'vertical',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={onRunPromptTest}
                  disabled={promptTestDisabled || promptTestBusy || !String(promptTestInput || '').trim()}
                  style={{
                    padding: '10px 12px',
                    background: promptTestBusy ? '#3A3A3A' : '#4FA2AD',
                    color: '#FFF',
                    border: 'none',
                    borderRadius: 8,
                    cursor:
                      promptTestDisabled || promptTestBusy || !String(promptTestInput || '').trim()
                        ? 'not-allowed'
                        : 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {promptTestBusy ? 'Running...' : 'Run Test'}
                </button>
              </div>
              </div>
          )}
          <div style={{ borderTop: '1px solid #3A3A3A', paddingTop: 12 }}>
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Current task / PromptSpec
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#B9C7CC', fontSize: 11 }}>
              {runContextLoading
                ? 'Loading canonical AgentGraph assignment…'
                : runContextError
                  ? runContextError
                  : runContext?.assignment?.instruction || 'No assignment has been delivered to this card.'}
            </pre>
            <div style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
              Graph context delivered after the task
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#91A9B8', fontSize: 10, maxHeight: 240, overflow: 'auto' }}>
              {runContext?.deliveredContext?.manifest.records.length
                ? runContext.deliveredContext.manifest.records
                    .map((record) => record.representation)
                    .join('\n')
                : 'No graph records delivered.'}
            </pre>
          </div>
        </div>
      );
    }

    if (activeTab === 'Knowledge') {
      if (runtimeBinding === 'openai_coder') {
        return (
          <div style={{ color: '#91A9B8', fontSize: 11 }}>
            External/General Codex baseline: no automatic Knowledge Assignment, GraphView hydration, CBM, or Engraphis tools.
          </div>
        );
      }
      const assignment = runContext?.assignment;
      const delivered = runContext?.deliveredContext;
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {runContextLoading ? <div style={{ color: '#91A9B8' }}>Loading canonical AgentGraph context…</div> : null}
          {runContextError ? <div role="alert" style={{ color: '#FFB0A6' }}>{runContextError}</div> : null}
          {!runContextLoading && !runContextError && !assignment ? (
            <div style={{ color: '#91A9B8' }}>This card has no delivered assignment yet.</div>
          ) : null}
          <section>
            <div style={{ color: '#E0DED5', fontWeight: 600 }}>Context graph layers</div>
            <div style={{ color: '#91A9B8', fontSize: 11, marginTop: 4 }}>
              These pills change which materialized authority layers are visible. They do not fetch, replace, or execute context.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>
              {availableGraphLayers.map((layer) => {
                const active = visibleGraphLayers.includes(layer);
                return (
                  <button
                    key={layer}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setVisibleGraphLayers((current) => (
                      current.includes(layer)
                        ? current.filter((entry) => entry !== layer)
                        : [...current, layer]
                    ))}
                    style={{
                      border: `1px solid ${active ? '#77C8C4' : '#46545A'}`,
                      borderRadius: 999,
                      background: active ? 'rgba(79, 162, 173, 0.22)' : '#252A2C',
                      color: active ? '#C8F3F0' : '#91A9B8',
                      padding: '5px 10px',
                      cursor: 'pointer',
                      fontSize: 11,
                    }}
                  >
                    {GRAPH_LAYER_LABELS[layer]}
                  </button>
                );
              })}
              {availableGraphLayers.length === 0 ? (
                <span style={{ color: '#91A9B8', fontSize: 11 }}>No graph layer has materialized for this card yet.</span>
              ) : null}
            </div>
          </section>

          <section>
            <div style={{ color: '#E0DED5', fontWeight: 600 }}>Assigned context</div>
            <div style={{ color: '#91A9B8', fontSize: 11, marginTop: 4 }}>
              AgentGraph retains this assignment context until the card receives a newer assignment.
            </div>
            {contextProjection?.nodes.length ? (
              <div style={{ height: 380, minHeight: 380, marginTop: 8, overflow: 'hidden', border: '1px solid #344247', borderRadius: 8 }}>
                <NativeThinkGraphSurface
                  projection={contextProjection}
                  status="ready"
                  error={null}
                  authority="agentgraph"
                />
              </div>
            ) : (
              <div style={{ color: '#91A9B8', fontSize: 11, marginTop: 8 }}>
                The latest assignment has no visible materialized graph records.
              </div>
            )}
          </section>

          <section>
            <div style={{ color: '#E0DED5', fontWeight: 600 }}>Context delivery</div>
            <div style={{ marginTop: 7, padding: 8, border: '1px solid #344247', borderRadius: 6, color: '#B9C7CC', fontSize: 11 }}>
              {assignment
                ? `Assignment ${assignment.assignmentId} · ${assignment.state}`
                : 'No AgentGraph assignment materialized.'}
            </div>
            {(delivered?.graphViews || []).map((view) => (
              <div key={view.viewId} style={{ marginTop: 6, padding: 8, border: '1px solid #344247', borderRadius: 6, color: '#B9C7CC', fontSize: 11 }}>
                GraphView {view.displayLabel || view.viewId} · {view.receivingRole || 'receiver unavailable'}
              </div>
            ))}
          </section>

          <section>
            <div style={{ color: '#E0DED5', fontWeight: 600 }}>Callable graph and memory operations</div>
            <div style={{ color: '#91A9B8', fontSize: 11, marginTop: 4 }}>
              These are callable grants. They are separate from the context shown above.
            </div>
            <input
              type="search"
              value={knowledgeToolSearch}
              onChange={(event) => setKnowledgeToolSearch(event.target.value)}
              placeholder="Search graph operations"
              style={{ width: '100%', marginTop: 8, padding: 8, background: '#252A2C', color: '#FFF', border: '1px solid #3A3A3A', borderRadius: 6 }}
            />
            {selectedKnowledgeTools.map((name) => {
              const tool = capabilityByName.get(name);
              return (
                <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 7, padding: 8, border: '1px solid #3A4A4F', borderRadius: 6 }}>
                  <div>
                    <div style={{ color: '#D5E4E8', fontSize: 11 }}>{name}</div>
                    <div style={{ color: '#80969F', fontSize: 10 }}>{tool?.description || 'Saved graph operation'}</div>
                  </div>
                  <button type="button" onClick={() => removeSavedTool(name)} style={{ background: 'transparent', color: '#FFB0A6', border: '1px solid #614A49', borderRadius: 5, cursor: 'pointer' }}>Remove</button>
                </div>
              );
            })}
            {knowledgeToolChoices.map((tool) => (
              <div key={tool.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 7, padding: 8, border: '1px solid #303B3F', borderRadius: 6 }}>
                <div>
                  <div style={{ color: '#B9C7CC', fontSize: 11 }}>{tool.name}</div>
                  <div style={{ color: '#71868E', fontSize: 10 }}>{tool.description || tool.capability.recommendedUse}</div>
                </div>
                <button type="button" onClick={() => addSavedTool(tool.name)} style={{ background: '#2C4A4E', color: '#C8F3F0', border: '1px solid #4F7F84', borderRadius: 5, cursor: 'pointer' }}>Add</button>
              </div>
            ))}
            {capabilityCatalogLoading ? <div style={{ color: '#91A9B8', fontSize: 11, marginTop: 8 }}>Loading canonical MCP catalog…</div> : null}
            {capabilityCatalogError ? <div role="alert" style={{ color: '#FFB0A6', fontSize: 11, marginTop: 8 }}>{capabilityCatalogError}</div> : null}
          </section>

          {assignment ? (
            <details>
              <summary style={{ color: '#B9D9DC', cursor: 'pointer', fontSize: 11 }}>Assignment, provenance, and result details</summary>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#D5E4E8', fontSize: 11 }}>{assignment.instruction}</pre>
              <div style={{ color: '#91A9B8', fontSize: 11 }}>
                {delivered
                  ? `${delivered.manifest.records.length} records · manifest ${delivered.manifest.manifestHash.slice(0, 12)}`
                  : 'No GraphView attached.'}
              </div>
              {(delivered?.manifest.records || []).map((record) => (
                <details key={`${record.authority}:${record.kind}:${record.nativeId}`} style={{ marginTop: 8 }}>
                  <summary style={{ color: '#B9D9DC', cursor: 'pointer', fontSize: 11 }}>
                    {record.deliveryOrder}. {record.authority} {record.kind} · {record.nativeId}{record.required ? ' · required' : ''}
                  </summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: '#91A9B8', fontSize: 10 }}>{record.representation}</pre>
                </details>
              ))}
              {(delivered?.manifest.unresolvedReferences || []).map((reference) => (
                <div key={`${reference.referenceType}:${reference.referenceId}`} style={{ color: '#FFB0A6', fontSize: 11 }}>
                  Unavailable: {reference.referenceType}:{reference.referenceId} · {reference.reason}
                </div>
              ))}
              <div style={{ color: '#91A9B8', fontSize: 11, marginTop: 8 }}>
                {assignment.runTrace.provider || 'provider unavailable'} · {assignment.runTrace.providerModelId || assignment.runTrace.modelKey || 'model unavailable'}
              </div>
              {assignment.result ? (
                <pre style={{ whiteSpace: 'pre-wrap', color: assignment.result.status === 'failed' ? '#FFB0A6' : '#D5E4E8', fontSize: 11 }}>
                  {assignment.result.output || assignment.result.errorDetail || assignment.result.summary || assignment.result.status}
                </pre>
              ) : (
                <div style={{ color: '#91A9B8', fontSize: 11 }}>Pending; no durable result yet.</div>
              )}
            </details>
          ) : null}
        </div>
      );
    }

    if (activeTab === 'Runtime') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {runtimeBinding === 'openai_coder' ? (
            <div style={{ padding: 10, border: '1px solid #3A4A4F', borderRadius: 8, background: '#202729' }}>
              <div style={{ color: '#D5E4E8', fontSize: 12, fontWeight: 600 }}>External/General · Codex app-server console</div>
              <div style={{ color: '#91A9B8', fontSize: 10, marginTop: 4 }}>Managed account/model inspection does not start a model turn. Main normally supplies the assignment; Steer is a human override for the active turn. Start, Stop, and Steer are bound to this card only.</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="button" disabled={codexRuntimeBusy} onClick={() => void callCodexCard('inspect')}>Inspect account/models</button>
                <button type="button" disabled={codexRuntimeBusy || !promptTestInput?.trim()} onClick={() => void callCodexCard('start')}>Start</button>
                <button type="button" disabled={codexRuntimeBusy} onClick={() => void callCodexCard('stop')}>Stop</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input value={codexSteerInput} onChange={(event) => setCodexSteerInput(event.target.value)} placeholder="Steer active Codex turn" style={{ flex: 1, padding: 7, background: '#171C1E', color: '#FFF', border: '1px solid #3A3A3A', borderRadius: 6 }} />
                <button type="button" disabled={codexRuntimeBusy || !codexSteerInput.trim()} onClick={() => void callCodexCard('steer')}>Steer</button>
              </div>
              {codexRuntimeState ? <pre style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', color: '#B9C7CC', fontSize: 10 }}>{JSON.stringify(codexRuntimeState, null, 2)}</pre> : null}
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Provider
              </label>
              <select
                value={provider}
                onChange={(event) => {
                  setProvider(event.target.value as 'openai' | 'openrouter' | '');
                  setSaveMessage(null);
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              >
                <option value="">Unset</option>
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Model
              </label>
              <div
                aria-label="OpenRouter GPT model presets"
                style={{ display: 'flex', gap: 6, marginBottom: 6 }}
              >
                {GPT_CARD_MODEL_PRESETS.map((preset) => (
                  <button
                    key={preset.modelKey}
                    type="button"
                    onClick={() => {
                      setProvider('openrouter');
                      setModelKey(preset.modelKey);
                      setSaveMessage(null);
                    }}
                    style={{
                      flex: 1,
                      padding: '5px 7px',
                      background:
                        provider === 'openrouter' && modelKey === preset.modelKey
                          ? '#435B64'
                          : '#2B2B2B',
                      color: '#FFF',
                      border: '1px solid #3A3A3A',
                      borderRadius: 7,
                      cursor: 'pointer',
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={modelKey}
                onChange={(event) => {
                  setModelKey(event.target.value);
                  setSaveMessage(null);
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              />
              <div style={{ color: '#91A9B8', fontSize: 10, marginTop: 4 }}>
                Presets use the saved OpenRouter card runtime. You can still enter another registered model key.
              </div>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Temperature
              </label>
              <input
                type="number"
                value={temperature}
                onChange={(event) => {
                  const next = event.target.value;
                  setTemperature(next === '' ? '' : Number(next));
                  setSaveMessage(null);
                }}
                step="0.1"
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 6, color: '#E0DED5', fontSize: 12 }}>
                Max Tokens
              </label>
              <input
                type="number"
                value={maxTokens}
                onChange={(event) => {
                  const next = event.target.value;
                  setMaxTokens(next === '' ? '' : Number(next));
                  setSaveMessage(null);
                }}
                style={{
                  width: '100%',
                  padding: 8,
                  background: '#2B2B2B',
                  color: '#FFF',
                  border: '1px solid #3A3A3A',
                  borderRadius: 8,
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === 'Tools') {
      if (runtimeBinding === 'openai_coder') {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#D5E4E8', fontSize: 12, fontWeight: 600 }}>Codex-native tools only</div>
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              This baseline receives the native tool set reported by its Codex app-server runtime. Its LiquidAIty assigned-tool array must remain empty; CBM, Engraphis, and hidden system tools are not injected.
            </div>
          </div>
        );
      }
      const effectiveQuery = ordinaryToolSearch.trim().toLowerCase();
      const effectiveRows = (effectiveToolSnapshot?.tools || []).filter((tool) =>
        !effectiveQuery || `${tool.displayName} ${tool.canonicalName} ${tool.description} ${tool.group}`.toLowerCase().includes(effectiveQuery),
      );
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => setCoderAuthority('direct_main_audit')} aria-pressed={coderAuthority === 'direct_main_audit'}>Audit</button>
            <button type="button" onClick={() => setCoderAuthority('mag_one_execution')} aria-pressed={coderAuthority === 'mag_one_execution'}>Implementation</button>
          </div>
          {effectiveToolSnapshot ? (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>
              Saved {effectiveToolSnapshot.counts.saved} · enabled {effectiveToolSnapshot.counts.enabled} · callable {effectiveToolSnapshot.counts.callable} · unavailable {effectiveToolSnapshot.counts.unavailable} · permission {effectiveToolSnapshot.permissionMode} · shell {effectiveToolSnapshot.allowsShell ? 'yes' : 'no'} · writes {effectiveToolSnapshot.allowsWrite ? 'yes' : 'no'} · network {effectiveToolSnapshot.allowsNetwork ? 'yes' : 'no'} · paid {effectiveToolSnapshot.hasPaidTools ? 'possible' : 'no'}
            </div>
          ) : null}
          <label style={{ color: '#E0DED5', fontSize: 12, fontWeight: 600 }}>
            Ordinary callable tools
          </label>
          <div style={{ color: '#91A9B8', fontSize: 11 }}>
            The saved array remains the runtime grant authority. Graph and memory operations are managed in Knowledge.
          </div>
          <input
            type="search"
            value={ordinaryToolSearch}
            onChange={(event) => setOrdinaryToolSearch(event.target.value)}
            placeholder="Search effective and available tools"
            style={{ width: '100%', padding: 8, background: '#252A2C', color: '#FFF', border: '1px solid #3A3A3A', borderRadius: 6 }}
          />
          {effectiveRows.map((tool) => (
            <div key={`effective:${tool.source}:${tool.canonicalName}`} style={{ padding: 8, border: `1px solid ${tool.enabled ? '#3A4A4F' : '#5A4642'}`, borderRadius: 6 }}>
              <div style={{ color: tool.enabled ? '#D5E4E8' : '#B6958F', fontSize: 11 }}>
                {tool.displayName} <span style={{ color: '#71868E' }}>({tool.canonicalName})</span>
              </div>
              <div style={{ color: '#80969F', fontSize: 10 }}>{tool.group} · {tool.source} · {tool.risk} · {tool.callable ? 'callable' : 'not callable'}</div>
              <div style={{ color: '#91A9B8', fontSize: 10 }}>{tool.description}</div>
              <div style={{ color: tool.enabled ? '#76A89F' : '#C08B82', fontSize: 10 }}>{tool.reason}</div>
            </div>
          ))}
          {selectedOrdinaryTools.map((name) => {
            const tool = capabilityByName.get(name);
            const globalIndex = savedTools.indexOf(name);
            return (
              <div key={name} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: 8, alignItems: 'center', padding: 8, border: `1px solid ${tool ? '#3A4A4F' : '#6A4C45'}`, borderRadius: 6 }}>
                <span style={{ color: '#71868E', fontSize: 10 }}>{globalIndex + 1}</span>
                <div>
                  <div style={{ color: '#D5E4E8', fontSize: 11 }}>{name}</div>
                  <div style={{ color: tool ? '#80969F' : '#FFB0A6', fontSize: 10 }}>
                    {tool?.description || 'Saved grant is not in the current public MCP catalog.'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" aria-label={`Move ${name} earlier`} onClick={() => moveSavedTool(name, -1)} disabled={globalIndex <= 0}>↑</button>
                  <button type="button" aria-label={`Move ${name} later`} onClick={() => moveSavedTool(name, 1)} disabled={globalIndex >= savedTools.length - 1}>↓</button>
                  <button type="button" onClick={() => removeSavedTool(name)} style={{ color: '#A44A43' }}>Remove</button>
                </div>
              </div>
            );
          })}
          {ordinaryToolChoices.map((tool) => (
            <div key={tool.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, padding: 8, border: '1px solid #303B3F', borderRadius: 6 }}>
              <div>
                <div style={{ color: '#B9C7CC', fontSize: 11 }}>{tool.name}</div>
                <div style={{ color: '#71868E', fontSize: 10 }}>{tool.description || tool.capability.recommendedUse}</div>
              </div>
              <button type="button" onClick={() => addSavedTool(tool.name)} style={{ background: '#2C4A4E', color: '#C8F3F0', border: '1px solid #4F7F84', borderRadius: 5, cursor: 'pointer' }}>Add</button>
            </div>
          ))}
          {capabilityCatalogLoading ? <div style={{ color: '#91A9B8', fontSize: 11 }}>Loading canonical MCP catalog…</div> : null}
          {capabilityCatalogError ? <div role="alert" style={{ color: '#FFB0A6', fontSize: 11 }}>{capabilityCatalogError}</div> : null}
          {runContext?.assignment?.result?.toolEvidence?.length ? (
            <pre style={{ whiteSpace: 'pre-wrap', color: '#B9C7CC', fontSize: 10 }}>
              {JSON.stringify(runContext.assignment.result.toolEvidence, null, 2)}
            </pre>
          ) : (
            <div style={{ color: '#91A9B8', fontSize: 11 }}>No tool evidence recorded for the current assignment.</div>
          )}
        </div>
      );
    }

    return null;
  })();

  if (!isLocalConfigMode || !localConfig || !onSaveLocalConfig) {
    return (
      <div
        style={{
          padding: '12px 14px',
          borderRadius: 8,
          border: '1px solid #3A3A3A',
          background: '#1F1F1F',
          color: '#E0DED5',
          fontSize: 12,
        }}
      >
        Legacy Agent Manager has been disconnected from the active Builder runtime.
      </div>
    );
  }

  if (!sectionBody) {
    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sectionBody}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={save}
          style={{
            padding: '10px 12px',
            background: '#4FA2AD',
            color: '#FFF',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Save Card
        </button>
        {saveMessage && <div style={{ color: '#4FA2AD', fontSize: 12 }}>{saveMessage}</div>}
      </div>
    </div>
  );
}
