import type {
  ProjectKnowledgeSeed,
  SeedEntity,
  SeedPattern,
  SeedProvenance,
  SeedRelationship,
  SeedTruth,
} from '../types';

function asIso(value: Date): string {
  return value.toISOString();
}

function id(prefix: string, value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${prefix}:${slug}`;
}

function makeRelationship(from: string, to: string, type: string, summary?: string): SeedRelationship {
  return {
    id: id('rel', `${from}:${type}:${to}`),
    from,
    to,
    type,
    summary,
    confidence: 0.86,
  };
}

export function buildProjectSelfSeed(projectId: string, now = new Date()): ProjectKnowledgeSeed {
  const generatedAt = asIso(now);

  const entities: SeedEntity[] = [
    {
      id: 'surface:chat',
      kind: 'Surface',
      name: 'Chat',
      summary: 'Primary human-facing intelligence surface.',
      status: 'current',
      confidence: 0.98,
    },
    {
      id: 'surface:agents',
      kind: 'Surface',
      name: 'Agents',
      summary: 'Execution surface for card-based orchestration and runtime flow.',
      status: 'current',
      confidence: 0.96,
    },
    {
      id: 'surface:knowledge',
      kind: 'Surface',
      name: 'Knowledge',
      summary: 'Evidence and relationship surface for graph-backed context.',
      status: 'current',
      confidence: 0.95,
    },
    {
      id: 'agent:magentic_one',
      kind: 'Agent',
      name: 'Magentic-One',
      summary: 'Top visible orchestrator in the current runtime architecture.',
      status: 'current',
      confidence: 0.9,
      metadata: { visibilityTier: 'public', primarySurface: 'Chat' },
    },
    {
      id: 'agent:research_agent',
      kind: 'Agent',
      name: 'Research Agent',
      summary: 'Specialist agent for grounded research and evidence retrieval.',
      status: 'current',
      confidence: 0.83,
      metadata: { visibilityTier: 'system' },
    },
    {
      id: 'agent:knowgraph_agent',
      kind: 'Agent',
      name: 'KnowGraph Agent',
      summary: 'Specialist agent for graph extraction and ingest workflows.',
      status: 'current',
      confidence: 0.83,
      metadata: { visibilityTier: 'system' },
    },
    {
      id: 'framework:react_flow',
      kind: 'Framework',
      name: 'React Flow',
      summary: 'Visual graph/canvas framework for Agents and Plan mission canvases.',
      status: 'current',
      confidence: 0.94,
    },
    {
      id: 'framework:postgresql',
      kind: 'RuntimePlatform',
      name: 'PostgreSQL',
      summary: 'Primary persistence layer.',
      status: 'current',
      confidence: 0.8,
    },
    {
      id: 'framework:apache_age',
      kind: 'Dependency',
      name: 'Apache AGE',
      summary: 'Graph extension used by graph query paths.',
      status: 'current',
      confidence: 0.8,
    },
    {
      id: 'file:client_agentbuilder',
      kind: 'File',
      name: 'client/src/pages/agentbuilder.tsx',
      summary: 'Primary state owner for workspace surfaces and selected object editing.',
      status: 'current',
      confidence: 0.97,
    },
    {
      id: 'file:backend_deck_runtime',
      kind: 'File',
      name: 'apps/backend/src/v3/runtime/deckRuntime.ts',
      summary: 'Deck runtime orchestration and run persistence assembly.',
      status: 'current',
      confidence: 0.95,
    },
    {
      id: 'file:backend_cards_runtime',
      kind: 'File',
      name: 'apps/backend/src/v3/cards/runtime.ts',
      summary: 'Card runtime, including Magentic-One chooser path.',
      status: 'current',
      confidence: 0.93,
    },
    {
      id: 'file:backend_decks_route',
      kind: 'Route',
      name: 'apps/backend/src/v3/routes/decks.routes.ts',
      summary: 'Deck run route; receives workspaceContext in POST /:projectId/decks/run.',
      status: 'current',
      confidence: 0.95,
    },
    {
      id: 'type:deck_workspace_context',
      kind: 'TypeContract',
      name: 'DeckWorkspaceContext',
      summary: 'Typed workspace focus contract transported from AgentBuilder to runtime.',
      status: 'current',
      confidence: 0.95,
    },
    {
      id: 'truth:shell_baseline_preserved',
      kind: 'CurrentTruth',
      name: 'Shell baseline preserved',
      summary: 'Rail/chat/workspace shell baseline is a protected constraint.',
      status: 'current',
      confidence: 0.98,
    },
    {
      id: 'truth:workspace_context_live',
      kind: 'CurrentTruth',
      name: 'Workspace context transported and consumed',
      summary: 'workspaceContext is carried in deck run and consumed by Magentic-One chooser path.',
      status: 'current',
      confidence: 0.93,
    },
    {
      id: 'future:focus_depth_routing',
      kind: 'FutureDirection',
      name: 'Chat focus-depth routing',
      summary: 'Chat should follow selected context depth across Plan/Agents/Knowledge.',
      status: 'planned',
      confidence: 0.85,
    },
  ];

  const relationships: SeedRelationship[] = [
    makeRelationship('surface:chat', 'surface:plan', 'FOLLOWS', 'Chat should align with active plan focus when selected.'),
    makeRelationship('surface:chat', 'surface:agents', 'FOLLOWS', 'Chat should align with selected agent object context.'),
    makeRelationship('surface:chat', 'surface:knowledge', 'FOLLOWS', 'Chat should align with selected knowledge focus context.'),
    makeRelationship('agent:magentic_one', 'surface:chat', 'VISIBLE_IN', 'Magentic-One is the primary visible orchestrator.'),
    makeRelationship('agent:research_agent', 'surface:knowledge', 'OPERATES_ON_SURFACE'),
    makeRelationship('agent:knowgraph_agent', 'surface:knowledge', 'OPERATES_ON_SURFACE'),
    makeRelationship('file:client_agentbuilder', 'type:deck_workspace_context', 'IMPLEMENTS'),
    makeRelationship('file:backend_decks_route', 'type:deck_workspace_context', 'PASSES_CONTEXT_TO'),
    makeRelationship('file:backend_deck_runtime', 'type:deck_workspace_context', 'USES_TYPE'),
    makeRelationship('file:backend_cards_runtime', 'type:deck_workspace_context', 'USES_TYPE'),
    makeRelationship('framework:react_flow', 'surface:plan', 'ENABLES'),
    makeRelationship('framework:react_flow', 'surface:agents', 'ENABLES'),
    makeRelationship('truth:shell_baseline_preserved', 'surface:chat', 'SHOULD_PRESERVE'),
    makeRelationship('truth:shell_baseline_preserved', 'surface:agents', 'SHOULD_PRESERVE'),
    makeRelationship('truth:workspace_context_live', 'agent:magentic_one', 'CURRENTLY_TRUE'),
    makeRelationship('truth:plan_react_flow_foundation', 'surface:plan', 'CURRENTLY_TRUE'),
    makeRelationship('future:focus_depth_routing', 'surface:chat', 'PLANNED_FOR'),
  ];

  const truths: SeedTruth[] = [
    {
      id: 'truth.platform.chat_main_surface',
      statement: 'Chat is the main visible intelligence surface.',
      scope: 'platform',
      status: 'current',
      confidence: 0.99,
      sourceKind: 'design_chat',
      sourceRef: 'Project architecture direction',
    },
    {
      id: 'truth.runtime.workspace_context_consumed',
      statement: 'workspaceContext is transported in deck run requests and consumed by runtime routing logic.',
      scope: 'runtime',
      status: 'current',
      confidence: 0.93,
      sourceKind: 'code',
      sourceRef: 'apps/backend/src/v3/runtime/deckRuntime.ts + cards/runtime.ts',
    },
    {
      id: 'truth.ui.shell_baseline_constraint',
      statement: 'Shell baseline and object drawer semantics are stable constraints and should be preserved.',
      scope: 'ui',
      status: 'current',
      confidence: 0.97,
      sourceKind: 'codex_report',
      sourceRef: 'Recent AgentBuilder patch reports',
    },
  ];

  const patterns: SeedPattern[] = [
    {
      id: 'pattern:goal_tasks_output',
      name: 'Goal -> Tasks -> Output',
      summary: 'Canonical mission flow from goal definition to executable tasks and concrete output.',
      nodeTypes: ['Goal', 'Task', 'Output'],
      edgeTypes: ['FLOWS_TO'],
      confidence: 0.94,
    },
    {
      id: 'pattern:research_synthesize_decide',
      name: 'Research -> Synthesize -> Decide',
      nodeTypes: ['Research', 'Note', 'Decision'],
      edgeTypes: ['FLOWS_TO'],
      confidence: 0.9,
    },
    {
      id: 'pattern:branch_compare_choose',
      name: 'Branch -> Compare -> Choose',
      nodeTypes: ['Decision', 'Task', 'Milestone'],
      edgeTypes: ['FLOWS_TO'],
      confidence: 0.88,
    },
    {
      id: 'pattern:task_approval_execute',
      name: 'Task -> Approval -> Execute',
      nodeTypes: ['Task', 'Approval', 'AgentAssignment', 'Output'],
      edgeTypes: ['REQUIRES_APPROVAL', 'FLOWS_TO'],
      confidence: 0.92,
    },
  ];

  const provenance: SeedProvenance[] = [
    {
      id: 'prov:code_agentbuilder',
      sourceKind: 'code',
      sourceRef: 'client/src/pages/agentbuilder.tsx',
      summary: 'Surface ownership and workspace context transport.',
      confidence: 0.95,
      capturedAt: generatedAt,
    },
    {
      id: 'prov:code_runtime',
      sourceKind: 'code',
      sourceRef: 'apps/backend/src/v3/runtime/deckRuntime.ts; apps/backend/src/v3/cards/runtime.ts',
      summary: 'Runtime context consumption path.',
      confidence: 0.92,
      capturedAt: generatedAt,
    },
    {
      id: 'prov:design_strategy',
      sourceKind: 'design_chat',
      sourceRef: 'Project self-seeding strategy',
      summary: 'Intended architecture truths and planned directions.',
      confidence: 0.84,
      capturedAt: generatedAt,
    },
  ];

  return {
    schemaVersion: 'project_knowledge_seed/v1',
    projectId,
    generatedAt,
    entities,
    relationships,
    truths,
    patterns,
    provenance,
  };
}

export function toSeedTriples(seed: ProjectKnowledgeSeed): Array<{
  source: string;
  relationship: string;
  target: string;
  properties?: Record<string, unknown>;
}> {
  return seed.relationships.map((edge) => ({
    source: edge.from,
    relationship: edge.type,
    target: edge.to,
    properties: {
      id: edge.id,
      confidence: edge.confidence ?? null,
      summary: edge.summary ?? null,
      source_kind: 'manual_seed',
      schema_version: seed.schemaVersion,
      generated_at: seed.generatedAt,
    },
  }));
}
